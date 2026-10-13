// The render page's two ticket calls (PLAN C8, 08 §6): read the tailored
// CVData, upload the rendered PDF. They run with the single-use render ticket
// and never with the session bearer (src/lib/render-bff.ts), so the same page
// works for a signed-in user and for the CLI's headless browser. Both are
// POST server functions behind the edge's Origin gate (T11-CSRF).

import { createServerFn } from "@tanstack/react-start";
import type { BffResult } from "@/lib/bff";
import type { RenderReadInput } from "@/lib/render-bff";
import { readVariantWithTicket, uploadPdfWithTicket } from "@/lib/render-bff";
import { requestContext } from "@/server/runtime.server";
import { CV_PDF_MAX_BYTES } from "@pilihpendidikan/jobs-contracts/api";

const TOO_LARGE: BffResult = {
  ok: false,
  status: 413,
  error: { error: "payload_too_large", message: "The PDF is over 5 MB." },
};

const MALFORMED: BffResult = {
  ok: false,
  status: 400,
  error: { error: "invalid_request", message: "Malformed upload." },
};

export const readRenderVariant = createServerFn({ method: "POST" })
  .validator((input: RenderReadInput) => input)
  .handler(
    async ({ data }): Promise<BffResult> =>
      readVariantWithTicket(data, requestContext().deps)
  );

export const uploadRenderedPdf = createServerFn({ method: "POST" })
  .validator((input: FormData) => {
    if (!(input instanceof FormData)) {
      throw new Error("Expected form data.");
    }
    return input;
  })
  .handler(async ({ data }): Promise<BffResult> => {
    const file = data.get("file");
    const fields = ["cvv_id", "ticket", "sha256", "name"].map((name) =>
      data.get(name)
    );
    if (
      !(file instanceof Blob) ||
      fields.some((value) => typeof value !== "string")
    ) {
      return MALFORMED;
    }
    if (file.size > CV_PDF_MAX_BYTES) {
      return TOO_LARGE;
    }
    const [cvvId, ticket, sha256, name] = fields as string[];
    return uploadPdfWithTicket(
      {
        cvvId: cvvId ?? "",
        ticket: ticket ?? "",
        sha256: sha256 ?? "",
        name: name ?? "cv.pdf",
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      requestContext().deps
    );
  });
