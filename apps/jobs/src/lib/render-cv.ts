// Renders a tailored CV variant to PDF in the browser and uploads it (08 §6):
// the one module behind both the chrome-free render page (§6.1, also driven
// by the CLI's headless browser, §6.3) and the in-place rendering on the
// application detail while a variant is `generating` (§6.2).
//
//   ticket (from ?ticket= or minted through the session) → read CVData with
//   the ticket → renderCvPdfBlob (cv-engine, Inter print cuts) → SHA-256
//   (crypto.subtle) → POST /api/v1/files with the ticket → {file_id, sha256}
//
// Everything is injected (RenderDeps) so the flow is testable without
// @react-pdf; defaultRenderDeps() loads the PDF engine with a dynamic import
// so it never enters the server bundle.

import type { CvVariantDetail } from "@pilihpendidikan/jobs-contracts/api";
import {
  CV_PDF_MAX_BYTES,
  CvVariantDetailSchema,
  FileResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import type { CVData, CVStyle } from "@pilihpendidikan/cv-engine/types";
import { CVDataSchema } from "@pilihpendidikan/cv-engine/schema";
import { api } from "./api-client";
import type { BffResult } from "./bff";
import { sha256Hex } from "./render-bff";

export type RenderErrorCode =
  | "no_ticket"
  | "ticket_rejected"
  | "no_cv_data"
  | "invalid_cv"
  | "render_failed"
  | "too_large"
  | "upload_failed";

/** `window.__PILIH_RENDER__` (PLAN C8) plus a code for the UI's message. */
export type RenderOutcome =
  | { status: "done"; file_id: string; sha256: string }
  | { status: "error"; code: RenderErrorCode; message: string };

export interface RenderDeps {
  /** A fresh ticket through the session (`POST …/render-ticket`). */
  mintTicket: (cvvId: string) => Promise<string>;
  read: (input: { cvv_id: string; ticket: string }) => Promise<BffResult>;
  renderPdf: (data: CVData, style: CVStyle) => Promise<Blob>;
  upload: (form: FormData) => Promise<BffResult>;
}

const MESSAGES: Record<RenderErrorCode, string> = {
  no_ticket: "No render ticket and no session.",
  ticket_rejected: "The render ticket was rejected or has expired.",
  no_cv_data: "This variant has no tailored CV to render.",
  invalid_cv: "The tailored CV data is invalid.",
  render_failed: "The PDF could not be rendered.",
  too_large: "The rendered PDF is over 5 MB.",
  upload_failed: "The PDF could not be uploaded.",
};

function error(code: RenderErrorCode): RenderOutcome {
  return { status: "error", code, message: MESSAGES[code] };
}

function readError(result: Extract<BffResult, { ok: false }>): RenderOutcome {
  if (result.status === 401 || result.status === 403) {
    return error("ticket_rejected");
  }
  if (result.error.error === "no_cv_data" || result.status === 422) {
    return error("no_cv_data");
  }
  return error("render_failed");
}

async function obtainTicket(
  cvvId: string,
  ticket: string | null,
  deps: RenderDeps
): Promise<string | null> {
  if (ticket) {
    return ticket;
  }
  try {
    return await deps.mintTicket(cvvId);
  } catch {
    return null;
  }
}

async function renderBlob(
  detail: CvVariantDetail,
  deps: RenderDeps
): Promise<Blob | RenderOutcome> {
  const parsed = CVDataSchema.safeParse(detail.tailored_cv);
  if (!parsed.success) {
    return error("invalid_cv");
  }
  // The variant's template is authoritative (08 §5: style = template).
  const data = parsed.data as CVData;
  try {
    return await deps.renderPdf(
      { ...data, style: detail.cv_variant.template },
      detail.cv_variant.template
    );
  } catch {
    return error("render_failed");
  }
}

/** Renders and uploads variant `cvvId`; never throws. */
export async function renderCvVariant(
  cvvId: string,
  ticketFromUrl: string | null,
  deps: RenderDeps
): Promise<RenderOutcome> {
  const ticket = await obtainTicket(cvvId, ticketFromUrl, deps);
  if (!ticket) {
    return error("no_ticket");
  }
  let read: BffResult;
  try {
    read = await deps.read({ cvv_id: cvvId, ticket });
  } catch {
    return error("render_failed");
  }
  if (!read.ok) {
    return readError(read);
  }
  const detail = CvVariantDetailSchema.safeParse(read.data);
  if (!detail.success) {
    return error("no_cv_data");
  }
  const blob = await renderBlob(detail.data, deps);
  if (!(blob instanceof Blob)) {
    return blob;
  }
  if (blob.size > CV_PDF_MAX_BYTES) {
    return error("too_large");
  }
  const sha256 = await sha256Hex(await blob.arrayBuffer());
  const form = new FormData();
  form.set("cvv_id", cvvId);
  form.set("ticket", ticket);
  form.set("sha256", sha256);
  form.set("name", `${detail.data.cv_variant.tailored_cv_id ?? cvvId}.pdf`);
  form.set("file", new Blob([blob], { type: "application/pdf" }), "cv.pdf");
  let uploaded: BffResult;
  try {
    uploaded = await deps.upload(form);
  } catch {
    return error("upload_failed");
  }
  if (!uploaded.ok) {
    return uploaded.status === 401
      ? error("ticket_rejected")
      : error("upload_failed");
  }
  const file = FileResponseSchema.safeParse(uploaded.data);
  if (!file.success) {
    return error("upload_failed");
  }
  return { status: "done", file_id: file.data.file.id, sha256 };
}

async function renderWithEngine(data: CVData, style: CVStyle): Promise<Blob> {
  const [{ renderCvPdfBlob }, { registerCvPrint }] = await Promise.all([
    import("@pilihpendidikan/cv-engine/pdf"),
    import("./pdf-fonts"),
  ]);
  return renderCvPdfBlob(data, style, { registerFonts: registerCvPrint });
}

export function defaultRenderDeps(): RenderDeps {
  return {
    mintTicket: async (cvvId) =>
      (
        await api("POST /api/v1/cv-variants/{cvv_id}/render-ticket", {
          params: { cvv_id: cvvId },
        })
      ).ticket,
    // Server-function stubs, loaded lazily so tests never pull the Worker glue.
    read: async (input) =>
      (await import("@/functions/render.functions")).readRenderVariant({
        data: input,
      }),
    upload: async (form) =>
      (await import("@/functions/render.functions")).uploadRenderedPdf({
        data: form,
      }),
    renderPdf: renderWithEngine,
  };
}

const inflight = new Map<string, Promise<RenderOutcome>>();

/**
 * One render per variant at a time: a re-mount (StrictMode), a poll that
 * still says `generating`, or a second tab in the same page share the
 * running attempt instead of spending the single-use ticket twice.
 */
export function renderCvVariantOnce(
  cvvId: string,
  ticket: string | null,
  deps: RenderDeps = defaultRenderDeps()
): Promise<RenderOutcome> {
  const running = inflight.get(cvvId);
  if (running) {
    return running;
  }
  const attempt = renderCvVariant(cvvId, ticket, deps).finally(() => {
    inflight.delete(cvvId);
  });
  inflight.set(cvvId, attempt);
  return attempt;
}
