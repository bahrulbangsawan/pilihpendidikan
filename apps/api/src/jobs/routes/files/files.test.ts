import { describe, expect, it } from "bun:test";
import { rowsOf, seedApplication } from "../../../../test/seed-jobs";
import {
  pdfBytes,
  pngBytes,
  sha256Of,
  uploadForm,
} from "../../services/cv/tailoring/fixtures";
import type { Harness } from "../cv/harness.test";
import {
  chunked,
  createVariant,
  EMAIL,
  harness,
  multipartBody,
  OTHER_EMAIL,
  renderVariant,
  uploadFile,
  variantRow,
} from "../cv/harness.test";

const KEY_RE = /^u\/usr_[0-9A-Z]{26}\/cv_pdf\/fil_[0-9A-Z]{26}\.pdf$/;

function fileRows(h: Harness) {
  return rowsOf(h.t.jobsSqlite, "files", h.userId);
}

function onlyObject(h: Harness) {
  const objects = [...h.t.r2.objects.values()];
  expect(objects).toHaveLength(1);
  return objects[0];
}

describe("TF-UPLOAD POST /api/v1/files", () => {
  it("TF-UPLOAD streams a cv_pdf to R2 under a server-built key and records it ready", async () => {
    const h = await harness();
    const bytes = pdfBytes(3000);
    const res = await uploadFile(h.web, {
      bytes,
      meta: { original_name: "Rahma CV.pdf" },
    });
    expect(res.status).toBe(201);
    const file = res.body.file;
    expect(file).toMatchObject({
      kind: "cv_pdf",
      status: "ready",
      size_bytes: 3000,
      sha256: await sha256Of(bytes),
      content_type: "application/pdf",
      original_name: "Rahma CV.pdf",
      retention_until: null,
      created_at: h.clock.now(),
    });
    expect(file).not.toHaveProperty("r2_key");
    const [row] = fileRows(h);
    expect(row.r2_key).toMatch(KEY_RE);
    expect(row.r2_key).toBe(`u/${h.userId}/cv_pdf/${file.id}.pdf`);
    const object = onlyObject(h);
    expect(object.key).toBe(row.r2_key as string);
    expect(object.body).toEqual(bytes);
    expect(object.customMetadata).toEqual({
      user_id: h.userId,
      file_id: file.id as string,
      sha256: await sha256Of(bytes),
      kind: "cv_pdf",
    });
    expect(object.httpMetadata).toMatchObject({
      contentType: "application/pdf",
      contentDisposition: "attachment",
    });
    const change = h.t.jobsSqlite
      .query("SELECT entity, op FROM change_log WHERE entity_id = ?")
      .all(file.id as string);
    expect(change).toEqual([{ entity: "file", op: "upsert" }]);
  });

  it("TF-UPLOAD parses a body that arrives in tiny chunks and a standard FormData client", async () => {
    const h = await harness();
    const bytes = pdfBytes(10_000, "z");
    const meta = {
      kind: "cv_pdf",
      sha256: await sha256Of(bytes),
      content_type: "application/pdf",
      size_bytes: bytes.length,
      links: {},
    };
    const { body, contentType } = multipartBody(meta, bytes, {
      boundary: "----chunky--boundary----with--dashes",
    });
    const res = await h.web.call("POST", "/api/v1/files", {
      rawBody: chunked(body, 7) as unknown as BodyInit,
      headers: { "Content-Type": contentType },
    });
    expect(res.status).toBe(201);
    expect(onlyObject(h).body).toEqual(bytes);
    const form = await uploadForm(pngBytes(300), {
      kind: "attachment",
      content_type: "image/png",
      original_name: "photo.png",
    });
    const viaForm = await h.web.call("POST", "/api/v1/files", {
      rawBody: form,
    });
    expect(viaForm.status).toBe(201);
    expect(viaForm.body).toMatchObject({
      file: { kind: "attachment", content_type: "image/png" },
    });
  });

  it("TF-UPLOAD never takes a key or path from the client and validates links (404 when not owned)", async () => {
    const h = await harness();
    const bytes = pngBytes(200);
    const res = await uploadFile(h.web, {
      bytes,
      meta: {
        kind: "attachment",
        content_type: "image/png",
        original_name: "../../u/usr_other/cv_pdf/evil.png",
        r2_key: "u/usr_other/attachment/evil.png",
        links: { application_id: h.app.id },
      },
    });
    expect(res.status).toBe(201);
    const [row] = fileRows(h);
    expect(row.r2_key).toBe(`u/${h.userId}/attachment/${res.body.file.id}.png`);
    const budi = await h.client.browserSession(OTHER_EMAIL);
    const theirApp = seedApplication(h.t.jobsSqlite, budi.userId as string);
    const foreign = await uploadFile(h.web, {
      bytes,
      meta: {
        kind: "attachment",
        content_type: "image/png",
        links: { application_id: theirApp.id },
      },
    });
    expect(foreign.status).toBe(404);
    expect(fileRows(h)).toHaveLength(1);
    expect(h.t.r2.objects.size).toBe(1);
  });

  it("TF-UPLOAD sets retention for evidence screenshots (user setting) and run logs (30 d)", async () => {
    const h = await harness();
    const shot = await uploadFile(h.web, {
      bytes: pngBytes(400),
      meta: { kind: "evidence_screenshot", content_type: "image/png" },
    });
    expect(shot.status).toBe(201);
    expect(shot.body.file.retention_until).toBe(
      h.clock.now() + 180 * 86_400_000
    );
    const log = new TextEncoder().encode(
      '{"step":1,"event":"started"}\n{"step":2}\n'
    );
    const run = await uploadFile(h.web, {
      bytes: log,
      meta: { kind: "run_log", content_type: "application/x-ndjson" },
    });
    expect(run.status).toBe(201);
    expect(run.body.file.retention_until).toBe(h.clock.now() + 30 * 86_400_000);
    expect(
      fileRows(h)
        .map((r) => r.r2_key as string)
        .at(-1)
    ).toEndWith(".jsonl");
  });

  it("TF-UPLOAD replays an idempotent upload without storing a second object", async () => {
    const h = await harness();
    const bytes = pdfBytes(1500);
    const first = await uploadFile(h.web, {
      bytes,
      idempotencyKey: "upload-1",
    });
    const again = await uploadFile(h.web, {
      bytes,
      idempotencyKey: "upload-1",
    });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(h.t.r2.objects.size).toBe(1);
  });

  it("TF-UPLOAD needs files:write; a read token is refused", async () => {
    const h = await harness();
    const reader = await h.client.personalToken(EMAIL, "read");
    expect((await uploadFile(reader)).status).toBe(403);
    expect((await uploadFile(h.client.anonymous())).status).toBe(401);
    expect(h.t.r2.objects.size).toBe(0);
  });

  it("TF-UPLOAD links a cv_pdf only to a renderable variant of the caller", async () => {
    const h = await harness();
    const id = await createVariant(h, { tailor: false });
    const attachment = await uploadFile(h.web, {
      bytes: pngBytes(100),
      meta: {
        kind: "attachment",
        content_type: "image/png",
        links: { cv_variant_id: id },
      },
    });
    expect(attachment.status).toBe(400);
    const budi = await h.client.browserSession(OTHER_EMAIL);
    expect((await renderVariant(h, id, pdfBytes(), budi)).status).toBe(404);
    expect((await renderVariant(h, id)).status).toBe(201);
    await h.web.post(`/api/v1/cv-variants/${id}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, id).revision,
    });
    const late = await renderVariant(h, id, pdfBytes(2048, "q"));
    expect(late.status).toBe(422);
    expect(late.body).toMatchObject({ error: "invalid_transition" });
    expect(h.t.r2.objects.size).toBe(1);
  });
});

describe("T8-09 upload integrity", () => {
  it("T8-09 a wrong sha256 is refused (422) and nothing is stored", async () => {
    const h = await harness();
    const res = await uploadFile(h.web, { meta: { sha256: "a".repeat(64) } });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "policy_violation",
      details: { reason: "sha256_mismatch" },
    });
    expect(h.t.r2.objects.size).toBe(0);
    expect(fileRows(h)).toEqual([]);
  });

  it("T8-09 a non-PDF declared as a PDF fails the magic-byte check and is deleted", async () => {
    const h = await harness();
    const res = await uploadFile(h.web, { bytes: pngBytes(800) });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ details: { reason: "magic_mismatch" } });
    expect(h.t.r2.objects.size).toBe(0);
    expect(fileRows(h)).toEqual([]);
    const docx = await uploadFile(h.web, {
      bytes: pdfBytes(300),
      meta: {
        kind: "cover_letter",
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    });
    expect(docx.status).toBe(422);
  });

  it("T8-09 oversize uploads are refused: declared over the cap, or more bytes than declared", async () => {
    const h = await harness();
    const declared = await uploadFile(h.web, {
      meta: { size_bytes: 5_242_881 },
    });
    expect(declared.status).toBe(413);
    expect(declared.body).toMatchObject({ error: "payload_too_large" });
    const bytes = pdfBytes(4000);
    const lying = await uploadFile(h.web, {
      bytes,
      meta: { size_bytes: 1000 },
    });
    expect(lying.status).toBe(413);
    const short = await uploadFile(h.web, {
      bytes,
      meta: { size_bytes: 4001 },
    });
    expect(short.status).toBe(422);
    expect(short.body).toMatchObject({ details: { reason: "size_mismatch" } });
    expect(h.t.r2.objects.size).toBe(0);
    expect(fileRows(h)).toEqual([]);
    const huge = await h.web.call("POST", "/api/v1/files", {
      rawBody: "x",
      headers: {
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": String(30 * 1024 * 1024),
      },
    });
    expect(huge.status).toBe(413);
  });

  it("T8-09 refuses types outside the kind's allowlist and malformed multipart bodies", async () => {
    const h = await harness();
    const png = await uploadFile(h.web, {
      bytes: pngBytes(100),
      meta: { content_type: "image/png" },
    });
    expect(png.status).toBe(400);
    const exe = await uploadFile(h.web, {
      bytes: pdfBytes(100),
      meta: { kind: "attachment", content_type: "application/x-msdownload" },
    });
    expect(exe.status).toBe(400);
    const json = await h.web.post("/api/v1/files", { kind: "cv_pdf" });
    expect(json.status).toBe(400);
    const bytes = pdfBytes(100);
    const fileFirst = multipartBody(
      {
        kind: "cv_pdf",
        sha256: await sha256Of(bytes),
        content_type: "application/pdf",
        size_bytes: 100,
        links: {},
      },
      bytes,
      { metaFirst: false }
    );
    const wrongOrder = await h.web.call("POST", "/api/v1/files", {
      rawBody: fileFirst.body,
      headers: { "Content-Type": fileFirst.contentType },
    });
    expect(wrongOrder.status).toBe(400);
    const badMeta = multipartBody({ kind: "cv_pdf" }, bytes);
    expect(
      (
        await h.web.call("POST", "/api/v1/files", {
          rawBody: badMeta.body,
          headers: { "Content-Type": badMeta.contentType },
        })
      ).status
    ).toBe(400);
    const { body, contentType } = multipartBody(
      {
        kind: "cv_pdf",
        sha256: await sha256Of(bytes),
        content_type: "application/pdf",
        size_bytes: 100,
        links: {},
      },
      bytes
    );
    const truncated = await h.web.call("POST", "/api/v1/files", {
      rawBody: body.slice(0, body.length - 30),
      headers: { "Content-Type": contentType },
    });
    expect(truncated.status).toBe(400);
    expect(h.t.r2.objects.size).toBe(0);
    expect(fileRows(h)).toEqual([]);
  });
});

describe("TF-DOWNLOAD GET /api/v1/files/{fil_id}[/content]", () => {
  it("TF-DOWNLOAD streams the owner's file with ETag = sha256, no-store and an attachment name", async () => {
    const h = await harness();
    const bytes = pdfBytes(2500);
    const up = await uploadFile(h.web, {
      bytes,
      meta: { original_name: "Rahma Putri – CV (final).pdf" },
    });
    const id = up.body.file.id as string;
    const res = await h.web.get(`/api/v1/files/${id}/content`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.response.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("ETag")).toBe(`"${await sha256Of(bytes)}"`);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe("2500");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Rahma Putri CV final.pdf"'
    );
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const cached = await h.web.get(`/api/v1/files/${id}/content`, {
      headers: { "If-None-Match": `"${await sha256Of(bytes)}"` },
    });
    expect(cached.status).toBe(304);
    const reader = await h.client.personalToken(EMAIL, "read");
    expect((await reader.get(`/api/v1/files/${id}/content`)).status).toBe(200);
    const budi = await h.client.browserSession(OTHER_EMAIL);
    expect((await budi.get(`/api/v1/files/${id}/content`)).status).toBe(404);
    expect((await budi.get(`/api/v1/files/${id}`)).status).toBe(404);
  });

  it("TF-DOWNLOAD serves byte ranges for evidence screenshots only", async () => {
    const h = await harness();
    const png = pngBytes(1000);
    const shot = await uploadFile(h.web, {
      bytes: png,
      meta: { kind: "evidence_screenshot", content_type: "image/png" },
    });
    const id = shot.body.file.id as string;
    const part = await h.web.get(`/api/v1/files/${id}/content`, {
      headers: { Range: "bytes=0-7" },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 0-7/1000");
    expect(new Uint8Array(await part.response.arrayBuffer())).toEqual(
      png.slice(0, 8)
    );
    const suffix = await h.web.get(`/api/v1/files/${id}/content`, {
      headers: { Range: "bytes=-10" },
    });
    expect(suffix.headers.get("Content-Range")).toBe("bytes 990-999/1000");
    const beyond = await h.web.get(`/api/v1/files/${id}/content`, {
      headers: { Range: "bytes=5000-" },
    });
    expect(beyond.status).toBe(416);
    const pdf = await uploadFile(h.web, { bytes: pdfBytes(900) });
    const whole = await h.web.get(`/api/v1/files/${pdf.body.file.id}/content`, {
      headers: { Range: "bytes=0-7" },
    });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Accept-Ranges")).toBe("none");
  });

  it("TF-DOWNLOAD metadata hides the R2 key; deleted or missing content is 404", async () => {
    const h = await harness();
    const up = await uploadFile(h.web);
    const id = up.body.file.id as string;
    const meta = await h.web.get<{ file: Record<string, unknown> }>(
      `/api/v1/files/${id}`
    );
    expect(meta.status).toBe(200);
    expect(meta.body.file).toEqual(up.body.file);
    h.t.r2.objects.clear();
    expect((await h.web.get(`/api/v1/files/${id}/content`)).status).toBe(404);
    expect(
      (await h.web.get("/api/v1/files/fil_01JA6V8M3W8Z1T6Q4Y2B7K9C0D")).status
    ).toBe(404);
  });
});

describe("TF-DELETE DELETE /api/v1/files/{fil_id}", () => {
  it("TF-DELETE marks an unreferenced file deleted and removes its R2 object", async () => {
    const h = await harness();
    const up = await uploadFile(h.web, {
      bytes: pngBytes(200),
      meta: { kind: "attachment", content_type: "image/png" },
    });
    const id = up.body.file.id as string;
    const res = await h.web.delete<{ file: Record<string, unknown> }>(
      `/api/v1/files/${id}`
    );
    expect(res.status).toBe(200);
    expect(res.body.file).toMatchObject({ id, status: "deleted" });
    expect(h.t.r2.objects.size).toBe(0);
    expect(fileRows(h)[0].status).toBe("deleted");
    const ops = h.t.jobsSqlite
      .query("SELECT op FROM change_log WHERE entity_id = ? ORDER BY seq")
      .all(id) as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["upsert", "delete"]);
    expect((await h.web.get(`/api/v1/files/${id}/content`)).status).toBe(404);
    const again = await h.web.delete(`/api/v1/files/${id}`);
    expect(again.status).toBe(200);
  });

  it("TF-DELETE keeps the R2 object of a file a live variant still references", async () => {
    const h = await harness();
    const cvv = await createVariant(h, { tailor: false });
    const up = await renderVariant(h, cvv);
    const res = await h.web.delete(`/api/v1/files/${up.body.file.id}`);
    expect(res.status).toBe(200);
    expect(h.t.r2.objects.size).toBe(1);
    // Approval then needs a fresh render.
    const approve = await h.web.post(`/api/v1/cv-variants/${cvv}/approve`, {
      base_revision: variantRow(h.t.jobsSqlite, cvv).revision,
    });
    expect(approve.status).toBe(422);
  });

  it("TF-DELETE is owner-only (404) and needs files:write", async () => {
    const h = await harness();
    const up = await uploadFile(h.web);
    const id = up.body.file.id as string;
    const budi = await h.client.browserSession(OTHER_EMAIL);
    expect((await budi.delete(`/api/v1/files/${id}`)).status).toBe(404);
    const reader = await h.client.personalToken(EMAIL, "read");
    expect((await reader.delete(`/api/v1/files/${id}`)).status).toBe(403);
    expect(h.t.r2.objects.size).toBe(1);
  });
});
