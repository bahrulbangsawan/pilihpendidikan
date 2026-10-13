import { CV_PDF_MAX_BYTES } from "@pilihpendidikan/jobs-contracts/api";
import { describe, expect, it } from "vitest";
import { sampleTailoredCv } from "@/test/fixtures-cv";
import {
  makeCvVariant,
  makeCvVariantDetail,
  makeFileView,
} from "@/test/fixtures-rest";
import type { BffDeps } from "./bff";
import {
  isPdf,
  multipartBody,
  readVariantWithTicket,
  safePdfName,
  sha256Hex,
  uploadPdfWithTicket,
} from "./render-bff";

const TICKET = "tKt_0123456789abcdefghijklmnopqrstuvwxyzABCD";
const MULTIPART_RE = /^multipart\/form-data; boundary=/;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

interface Call {
  init: RequestInit;
  path: string;
}

function fakeApi(respond: (path: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const deps: BffDeps = {
    fetchApi: async (path, init) => {
      calls.push({ path, init });
      return await Promise.resolve(respond(path, init));
    },
    clientIp: null,
  };
  return { calls, deps };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const header = (call: Call | undefined, name: string) =>
  new Headers(call?.init.headers).get(name);

describe("TW-RENDER BFF ticket mode (PLAN C8, 08 §6.4)", () => {
  it("TW-RENDER reads CVData with X-Render-Ticket, never a bearer, and validates the answer", async () => {
    const variant = makeCvVariant({ status: "generating" });
    const detail = makeCvVariantDetail({
      cv_variant: variant,
      tailored_cv: sampleTailoredCv() as unknown as Record<string, unknown>,
    });
    const { calls, deps } = fakeApi(() => json(detail));
    const result = await readVariantWithTicket(
      { cvv_id: variant.id, ticket: TICKET },
      deps
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(
      `/api/v1/cv-variants/${variant.id}?include=cv_data`
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(header(calls[0], "X-Render-Ticket")).toBe(TICKET);
    expect(header(calls[0], "Authorization")).toBeNull();
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(JSON.stringify(result)).not.toContain(TICKET);
  });

  it("TW-RENDER refuses a malformed ticket or variant id before calling the api", async () => {
    const { calls, deps } = fakeApi(() => json({}));
    expect(
      await readVariantWithTicket({ cvv_id: "cvv_nope", ticket: TICKET }, deps)
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await readVariantWithTicket(
        { cvv_id: makeCvVariant().id, ticket: "short" },
        deps
      )
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      await readVariantWithTicket(
        { cvv_id: makeCvVariant().id, ticket: "../../etc/passwd/../../.." },
        deps
      )
    ).toMatchObject({ ok: false, status: 401 });
    expect(calls).toHaveLength(0);
  });

  it("TW-RENDER passes a used or expired ticket through as 401 with the ticket scrubbed", async () => {
    const { deps } = fakeApi(() =>
      json(
        {
          error: "invalid_token",
          message: `unknown ticket ${TICKET}`,
          request_id: "r",
        },
        401
      )
    );
    const result = await readVariantWithTicket(
      { cvv_id: makeCvVariant().id, ticket: TICKET },
      deps
    );
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: { error: "invalid_token" },
    });
    expect(JSON.stringify(result)).not.toContain(TICKET);
  });

  it("TW-RENDER refuses a variant without CVData and an answer for another variant", async () => {
    const variant = makeCvVariant();
    const noData = fakeApi(() =>
      json(makeCvVariantDetail({ cv_variant: variant }))
    );
    expect(
      await readVariantWithTicket(
        { cvv_id: variant.id, ticket: TICKET },
        noData.deps
      )
    ).toMatchObject({ ok: false, status: 422, error: { error: "no_cv_data" } });
    const other = fakeApi(() =>
      json(
        makeCvVariantDetail({
          cv_variant: makeCvVariant(),
          tailored_cv: {},
        })
      )
    );
    expect(
      await readVariantWithTicket(
        { cvv_id: variant.id, ticket: TICKET },
        other.deps
      )
    ).toMatchObject({ ok: false, status: 502 });
  });

  it("TW-RENDER uploads meta then file as multipart with the ticket, cv_pdf and the variant link", async () => {
    const variant = makeCvVariant({ status: "generating" });
    const sha = await sha256Hex(PDF);
    const { calls, deps } = fakeApi(() =>
      json({ file: makeFileView({ sha256: sha, size_bytes: PDF.length }) }, 201)
    );
    const result = await uploadPdfWithTicket(
      {
        cvvId: variant.id,
        ticket: TICKET,
        sha256: sha,
        name: "Rina Wulandari / CV.pdf",
        bytes: PDF,
      },
      deps
    );
    expect(result).toMatchObject({ ok: true, status: 201 });
    const call = calls[0];
    expect(call?.path).toBe("/api/v1/files");
    expect(call?.init.method).toBe("POST");
    expect(header(call, "X-Render-Ticket")).toBe(TICKET);
    expect(header(call, "Authorization")).toBeNull();
    expect(header(call, "Idempotency-Key")).toContain(variant.id);
    const type = header(call, "Content-Type") ?? "";
    expect(type).toMatch(MULTIPART_RE);
    const body = new TextDecoder("latin1").decode(
      call?.init.body as Uint8Array
    );
    const metaAt = body.indexOf('name="meta"');
    const fileAt = body.indexOf('name="file"');
    expect(metaAt).toBeGreaterThan(-1);
    expect(fileAt).toBeGreaterThan(metaAt);
    const metaJson = body
      .slice(body.indexOf("\r\n\r\n", metaAt) + 4)
      .split("\r\n")[0];
    expect(JSON.parse(metaJson ?? "{}")).toEqual({
      kind: "cv_pdf",
      sha256: sha,
      content_type: "application/pdf",
      size_bytes: PDF.length,
      original_name: "Rina Wulandari - CV.pdf",
      links: { cv_variant_id: variant.id },
    });
    expect(body).toContain("%PDF-1.4");
  });

  it("TW-RENDER never forwards a non-PDF, an oversized file or bytes that don't match their SHA-256", async () => {
    const { calls, deps } = fakeApi(() => json({}));
    const base = {
      cvvId: makeCvVariant().id,
      ticket: TICKET,
      name: "cv.pdf",
    };
    const notPdf = new TextEncoder().encode("<html>nope</html>");
    expect(
      await uploadPdfWithTicket(
        { ...base, bytes: notPdf, sha256: await sha256Hex(notPdf) },
        deps
      )
    ).toMatchObject({ ok: false, status: 422 });
    const big = new Uint8Array(CV_PDF_MAX_BYTES + 1);
    big.set(PDF.subarray(0, 5));
    expect(
      await uploadPdfWithTicket(
        { ...base, bytes: big, sha256: "a".repeat(64) },
        deps
      )
    ).toMatchObject({ ok: false, status: 413 });
    expect(
      await uploadPdfWithTicket(
        { ...base, bytes: PDF, sha256: "b".repeat(64) },
        deps
      )
    ).toMatchObject({ ok: false, status: 422 });
    expect(calls).toHaveLength(0);
  });

  it("TW-RENDER helpers: PDF magic, safe file names, multipart framing", () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(new TextEncoder().encode("PDF-"))).toBe(false);
    expect(safePdfName("../../etc/passwd")).toBe("etc-passwd.pdf");
    expect(safePdfName("Rina\u0000\r\nCV.PDF")).toBe("Rina-CV.pdf");
    expect(safePdfName("")).toBe("cv.pdf");
    const body = new TextDecoder().decode(
      multipartBody(
        {
          kind: "cv_pdf",
          sha256: "a".repeat(64),
          content_type: "application/pdf",
          size_bytes: 3,
          links: {},
        },
        {
          name: "a.pdf",
          type: "application/pdf",
          bytes: new Uint8Array([1, 2, 3]),
        },
        "B0UND"
      )
    );
    expect(body.startsWith("--B0UND\r\n")).toBe(true);
    expect(body.endsWith("\r\n--B0UND--\r\n")).toBe(true);
  });
});
