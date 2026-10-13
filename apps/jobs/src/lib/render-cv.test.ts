import { describe, expect, it, vi } from "vitest";
import { sampleTailoredCv } from "@/test/fixtures-cv";
import {
  makeCvVariant,
  makeCvVariantDetail,
  makeFileView,
} from "@/test/fixtures-rest";
import type { BffResult, JsonValue } from "./bff";
import type { RenderDeps } from "./render-cv";
import { renderCvVariant, renderCvVariantOnce } from "./render-cv";
import { sha256Hex } from "./render-bff";

const TICKET = "tKt_0123456789abcdefghijklmnopqrstuvwxyzABCD";
const FILE_ID_RE = /^fil_/;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\nrendered\n%%EOF\n");

const ok = (data: unknown, status = 200): BffResult => ({
  ok: true,
  status,
  data: data as JsonValue,
  etag: null,
  notModified: false,
  replayed: false,
});

function deps(overrides: Partial<RenderDeps> = {}) {
  const variant = makeCvVariant({ status: "generating", template: "harvard" });
  const uploads: FormData[] = [];
  const reads: { cvv_id: string; ticket: string }[] = [];
  const renders: { style: string }[] = [];
  const base: RenderDeps = {
    mintTicket: vi.fn(async () => await Promise.resolve(TICKET)),
    read: async (input) => {
      reads.push(input);
      return await Promise.resolve(
        ok(
          makeCvVariantDetail({
            cv_variant: { ...variant, id: input.cvv_id },
            tailored_cv: sampleTailoredCv() as unknown as Record<
              string,
              unknown
            >,
          })
        )
      );
    },
    renderPdf: async (_data, style) => {
      renders.push({ style });
      return await Promise.resolve(
        new Blob([PDF_BYTES], { type: "application/pdf" })
      );
    },
    upload: async (form) => {
      uploads.push(form);
      return await Promise.resolve(
        ok(
          {
            file: makeFileView({
              sha256: String(form.get("sha256")),
              size_bytes: PDF_BYTES.length,
            }),
          },
          201
        )
      );
    },
  };
  return { variant, uploads, reads, renders, deps: { ...base, ...overrides } };
}

describe("TW-RENDER render flow (08 §6.1–§6.2)", () => {
  it("TW-RENDER uses the ticket from the URL, renders with the variant template and uploads the PDF with its SHA-256", async () => {
    const harness = deps();
    const outcome = await renderCvVariant(
      harness.variant.id,
      TICKET,
      harness.deps
    );
    const sha = await sha256Hex(PDF_BYTES);
    expect(outcome).toEqual({
      status: "done",
      file_id: expect.stringMatching(FILE_ID_RE),
      sha256: sha,
    });
    expect(harness.deps.mintTicket).not.toHaveBeenCalled();
    expect(harness.reads).toEqual([
      { cvv_id: harness.variant.id, ticket: TICKET },
    ]);
    expect(harness.renders).toEqual([{ style: "harvard" }]);
    const form = harness.uploads[0];
    expect(form?.get("cvv_id")).toBe(harness.variant.id);
    expect(form?.get("ticket")).toBe(TICKET);
    expect(form?.get("sha256")).toBe(sha);
    expect(form?.get("file")).toBeInstanceOf(Blob);
  });

  it("TW-RENDER mints a ticket through the session when the URL has none", async () => {
    const harness = deps();
    const outcome = await renderCvVariant(
      harness.variant.id,
      null,
      harness.deps
    );
    expect(harness.deps.mintTicket).toHaveBeenCalledWith(harness.variant.id);
    expect(outcome.status).toBe("done");
  });

  it("TW-RENDER reports errors as {status: error, message} codes", async () => {
    const noTicket = deps({
      mintTicket: async () => await Promise.reject(new Error("401")),
    });
    expect(
      await renderCvVariant(noTicket.variant.id, null, noTicket.deps)
    ).toMatchObject({ status: "error", code: "no_ticket" });

    const rejected = deps({
      read: async () =>
        await Promise.resolve({
          ok: false,
          status: 401,
          error: { error: "invalid_token", message: "used" },
        }),
    });
    expect(
      await renderCvVariant(rejected.variant.id, TICKET, rejected.deps)
    ).toMatchObject({ status: "error", code: "ticket_rejected" });

    const invalid = deps({
      read: async (input) =>
        await Promise.resolve(
          ok(
            makeCvVariantDetail({
              cv_variant: makeCvVariant({ id: input.cvv_id }),
              tailored_cv: { personalInfo: "nope" },
            })
          )
        ),
    });
    expect(
      await renderCvVariant(invalid.variant.id, TICKET, invalid.deps)
    ).toMatchObject({ status: "error", code: "invalid_cv" });

    const broken = deps({
      renderPdf: async () => await Promise.reject(new Error("yoga")),
    });
    const outcome = await renderCvVariant(
      broken.variant.id,
      TICKET,
      broken.deps
    );
    expect(outcome).toMatchObject({ status: "error", code: "render_failed" });
    expect(outcome.status === "error" && outcome.message.length).toBeTruthy();
    expect(broken.uploads).toHaveLength(0);
  });

  it("TW-RENDER renders a variant once at a time (the single-use ticket is never spent twice)", async () => {
    const harness = deps();
    const [first, second] = await Promise.all([
      renderCvVariantOnce(harness.variant.id, TICKET, harness.deps),
      renderCvVariantOnce(harness.variant.id, TICKET, harness.deps),
    ]);
    expect(first).toEqual(second);
    expect(harness.reads).toHaveLength(1);
    expect(harness.uploads).toHaveLength(1);
  });
});
