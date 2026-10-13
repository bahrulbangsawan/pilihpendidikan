// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render";

const session = { signedIn: false, email: null, expiresAt: null, locale: "en" };
const renderOnce = vi.fn();

vi.mock("@/hooks/use-session", () => ({ useSession: () => session }));
vi.mock("@/lib/render-cv", () => ({
  renderCvVariantOnce: (...args: unknown[]) => renderOnce(...args),
}));

const { RenderCvPage, forgetPageRenders } = await import("./render-cv-page");

const CVV = "cvv_01JA0000000000000000000000";
const TICKET = "tKt_0123456789abcdefghijklmnopqrstuvwxyzABCD";

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    `/render/cv/${CVV}?ticket=${TICKET}&x=1`
  );
  window.__PILIH_RENDER__ = undefined;
  renderOnce.mockReset();
  forgetPageRenders();
});

afterEach(() => {
  document.body.replaceChildren();
  session.signedIn = false;
});

describe("TW-RENDER the render page (08 §6.1, PLAN C8)", () => {
  it("TW-RENDER removes the ticket from the URL first and publishes {status: done, file_id, sha256}", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    renderOnce.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { container, unmount } = render(<RenderCvPage cvvId={CVV} />);
    expect(window.location.search).toBe("?x=1");
    expect(window.location.href).not.toContain(TICKET);
    expect(renderOnce).toHaveBeenCalledWith(CVV, TICKET);
    // Headless callers wait for a status; nothing is published while working.
    expect(window.__PILIH_RENDER__).toBeUndefined();
    const { act } = await import("react");
    await act(async () => {
      resolve({ status: "done", file_id: "fil_X", sha256: "a".repeat(64) });
      await flush();
    });
    expect(window.__PILIH_RENDER__).toEqual({
      status: "done",
      file_id: "fil_X",
      sha256: "a".repeat(64),
    });
    expect(container.textContent).toContain("Rendered");
    unmount();
  });

  it("TW-RENDER publishes {status: error, message} and explains it", async () => {
    renderOnce.mockResolvedValue({
      status: "error",
      code: "ticket_rejected",
      message: "The render ticket was rejected or has expired.",
    });
    const { act } = await import("react");
    let mounted = null as ReturnType<typeof render> | null;
    await act(async () => {
      mounted = render(<RenderCvPage cvvId={CVV} />);
      await flush();
    });
    expect(window.__PILIH_RENDER__).toEqual({
      status: "error",
      message: "The render ticket was rejected or has expired.",
    });
    expect(mounted?.container.textContent).toContain("expired");
  });

  it("TW-RENDER without a ticket and without a session it fails fast and never calls the api", async () => {
    window.history.replaceState(null, "", `/render/cv/${CVV}`);
    const { act } = await import("react");
    await act(async () => {
      render(<RenderCvPage cvvId={CVV} />);
      await flush();
    });
    expect(renderOnce).not.toHaveBeenCalled();
    expect(window.__PILIH_RENDER__).toMatchObject({ status: "error" });
  });

  it("TW-RENDER a signed-in visitor without a ticket renders with a session-minted one", async () => {
    window.history.replaceState(null, "", `/render/cv/${CVV}`);
    session.signedIn = true;
    renderOnce.mockResolvedValue({
      status: "done",
      file_id: "fil_Y",
      sha256: "b".repeat(64),
    });
    const { act } = await import("react");
    await act(async () => {
      render(<RenderCvPage cvvId={CVV} />);
      await flush();
    });
    expect(renderOnce).toHaveBeenCalledWith(CVV, null);
    expect(window.__PILIH_RENDER__).toMatchObject({ status: "done" });
  });
});

describe("TW-RENDER re-mounts share the run", () => {
  it("TW-RENDER a second mount (StrictMode, hydration) joins the first run instead of losing the ticket", async () => {
    renderOnce.mockResolvedValue({
      status: "done",
      file_id: "fil_Z",
      sha256: "c".repeat(64),
    });
    const { act } = await import("react");
    let second = null as ReturnType<typeof render> | null;
    await act(async () => {
      const first = render(<RenderCvPage cvvId={CVV} />);
      first.unmount();
      second = render(<RenderCvPage cvvId={CVV} />);
      await flush();
    });
    expect(renderOnce).toHaveBeenCalledTimes(1);
    expect(second?.container.textContent).toContain("Rendered");
    expect(window.__PILIH_RENDER__).toMatchObject({ status: "done" });
  });
});
