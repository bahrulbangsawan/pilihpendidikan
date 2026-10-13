// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"disableIframePageLoading": true}}
import { TooltipProvider } from "@rulisme/ui/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import { buildDiffModel } from "@/lib/cv-diff";
import { makeApplication } from "@/test/fixtures";
import { sampleTailoredCv } from "@/test/fixtures-cv";
import {
  makeCvVariant,
  makeCvVariantDetail,
  makeDiff,
  makeFileView,
} from "@/test/fixtures-rest";
import { byText, click, render } from "@/test/render";

const WEB_KEY_RE = /^web:/;
const renderOnce = vi.fn();
vi.mock("@/lib/render-cv", () => ({
  renderCvVariantOnce: (...args: unknown[]) => renderOnce(...args),
}));

const { CvDiffView } = await import("./cv-diff-view");
const { CvVariantPanel } = await import("./cv-variant-panel");

const ok = (data: unknown): BffResult => ({
  ok: true,
  status: 200,
  data: data as JsonValue,
  etag: null,
  notModified: false,
  replayed: false,
});

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

afterEach(() => {
  setBffTransport(null);
  renderOnce.mockReset();
  document.body.replaceChildren();
});

describe("TW-CVDIFF the side-by-side diff (08 §7)", () => {
  it("TW-CVDIFF shows each tailored bullet next to its sources and marks them on hover and focus", async () => {
    const { container } = render(
      wrap(
        <CvDiffView model={buildDiffModel(makeDiff(), sampleTailoredCv())} />
      )
    );
    const rewritten = container.querySelector<HTMLElement>(
      '[data-bullet-key="exp-1:1"]'
    );
    expect(rewritten?.textContent).toContain("accessible component library");
    expect(rewritten?.className).toContain("bg-highlight");
    const source = container.querySelector<HTMLElement>(
      '[data-source-id="experience:exp-1:2"]'
    );
    expect(source?.className).not.toContain("bg-highlight");
    await act(async () => {
      rewritten?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      rewritten?.focus();
      await Promise.resolve();
    });
    expect(source?.className).toContain("bg-highlight");
    expect(rewritten?.tagName).toBe("BUTTON");
    expect(rewritten?.getAttribute("aria-pressed")).toBe("true");
    // Screen readers hear the source with the line (sr-only text).
    expect(rewritten?.textContent).toContain(
      "Derived from: Created a component library"
    );
  });

  it("TW-CVDIFF strikes excluded entries through and shows notes_for_user as warnings, not CV text", () => {
    const { container } = render(
      wrap(<CvDiffView model={buildDiffModel(makeDiff())} />)
    );
    const del = container.querySelector("del");
    expect(del?.textContent).toBe("Old portfolio site");
    expect(del?.className).toContain("line-through");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Check before approving");
    expect(alert?.textContent).toContain("GraphQL");
    expect(container.textContent).toContain("Rephrased");
    expect(container.textContent).toContain("Merged");
  });
});

describe("TW-CVDIFF the variant panel (08 §7)", () => {
  it("TW-CVDIFF previews the PDF inline from the BFF content route and approves after confirming", async () => {
    const file = makeFileView();
    const variant = makeCvVariant({
      status: "draft",
      file_id: file.id,
      revision: 4,
    });
    const application = makeApplication();
    const requests: BffRequest[] = [];
    setBffTransport((request) => {
      requests.push(request);
      if (request.route === "GET /api/v1/cv-variants/{cvv_id}") {
        return Promise.resolve(
          ok(makeCvVariantDetail({ cv_variant: variant, file }))
        );
      }
      return Promise.resolve(
        ok({
          cv_variant: { ...variant, status: "approved" },
          application: null,
        })
      );
    });
    const onApprovable = vi.fn();
    const { container } = render(
      wrap(
        <CvVariantPanel
          application={application}
          company="Acme"
          onApprovableChange={onApprovable}
          onRegenerate={() => undefined}
          variant={variant}
        />
      )
    );
    await flush();
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe?.getAttribute("src")).toBe(
      `/download/files/${file.id}/content?inline=1`
    );
    expect(
      container.querySelector(`a[href="/download/files/${file.id}/content"]`)
    ).not.toBeNull();
    expect(onApprovable).toHaveBeenLastCalledWith(true);
    // Y opens the confirmation; nothing is sent before it is confirmed.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));
      await Promise.resolve();
    });
    expect(requests.some((r) => r.route.endsWith("/approve"))).toBe(false);
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Acme");
    await click(
      [...(dialog?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Approve"
      )
    );
    await flush();
    const approve = requests.find((r) =>
      r.route.endsWith("/cv-variants/{cvv_id}/approve")
    );
    expect(approve?.params).toEqual({ cvv_id: variant.id });
    expect(approve?.body).toEqual({ base_revision: 4 });
    expect(approve?.idempotency_key).toMatch(WEB_KEY_RE);
  });

  it("TW-RENDER renders a generating variant in this tab (08 §6.2) and offers a retry on failure", async () => {
    const variant = makeCvVariant({
      status: "generating",
      file_id: null,
      tailored_cv_id: "rina-t-abc",
    });
    setBffTransport(() =>
      Promise.resolve(ok(makeCvVariantDetail({ cv_variant: variant })))
    );
    renderOnce.mockResolvedValue({
      status: "error",
      code: "render_failed",
      message: "The PDF could not be rendered.",
    });
    const { container } = render(
      wrap(
        <CvVariantPanel
          application={makeApplication()}
          company="Acme"
          onApprovableChange={() => undefined}
          onRegenerate={() => undefined}
          variant={variant}
        />
      )
    );
    await flush();
    expect(renderOnce).toHaveBeenCalledWith(variant.id, null);
    expect(container.textContent).toContain("The PDF couldn't be rendered");
    renderOnce.mockResolvedValue({
      status: "done",
      file_id: "fil_X",
      sha256: "a".repeat(64),
    });
    await click(byText(container, "Retry"));
    await flush();
    expect(renderOnce).toHaveBeenCalledTimes(2);
  });
});
