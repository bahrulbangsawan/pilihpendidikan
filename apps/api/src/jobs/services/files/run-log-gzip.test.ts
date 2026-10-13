import { describe, expect, it } from "bun:test";
import { FILE_UPLOAD_MAX_BYTES } from "@pilihpendidikan/jobs-contracts/api";
import { rowsOf } from "../../../../test/seed-jobs";
import { EMAIL, harness, uploadFile } from "../../routes/cv/harness.test";
import {
  extensionOfKey,
  FILE_KIND_RULES,
  magicMatches,
  safeDownloadName,
  typeRuleFor,
} from "./policy";

// 19 §11.1: the CLI uploads its redacted step log as `run_log`,
// `application/gzip` (`steps.jsonl.gz`, gzip with the `1f 8b` magic).

const enc = new TextEncoder();
const STEP_LOG =
  '{"ts":"2026-10-11T09:14:03.412Z","step":1,"event":"attempt_started"}\n{"step":2,"event":"attempt_finished"}\n';

async function gzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

describe("TFIX-RUNLOG-GZIP run_log accepts a gzip step log (19 §11)", () => {
  it("TFIX-RUNLOG-GZIP policy: application/gzip with the 1f 8b 08 magic, capped on the compressed size", async () => {
    const rule = typeRuleFor("run_log", "application/gzip");
    expect(rule).toEqual({ ext: ".jsonl.gz", magic: "gzip" });
    expect(typeRuleFor("run_log", "Application/GZIP; charset=binary")).toEqual(
      rule
    );
    // The existing run_log types stay accepted.
    expect(typeRuleFor("run_log", "application/x-ndjson")?.magic).toBe("jsonl");
    expect(typeRuleFor("run_log", "text/plain")?.magic).toBe("jsonl");
    // gzip is a run_log format only.
    expect(typeRuleFor("attachment", "application/gzip")).toBeNull();
    expect(typeRuleFor("cover_letter", "application/gzip")).toBeNull();
    // The kind cap applies to the uploaded (compressed) bytes.
    expect(FILE_KIND_RULES.run_log.maxBytes).toBe(FILE_UPLOAD_MAX_BYTES);

    const real = await gzip(enc.encode(STEP_LOG));
    expect(magicMatches("gzip", real.subarray(0, 8))).toBe(true);
    expect(magicMatches("gzip", enc.encode(STEP_LOG))).toBe(false);
    expect(magicMatches("gzip", new Uint8Array([0x1f, 0x8b]))).toBe(false);
    expect(magicMatches("gzip", new Uint8Array([0x1f, 0x8b, 0x07, 0]))).toBe(
      false
    );
    expect(magicMatches("gzip", enc.encode("PK\u0003\u0004"))).toBe(false);
    // A gzip body is not JSONL text either.
    expect(magicMatches("jsonl", real.subarray(0, 8))).toBe(false);

    expect(extensionOfKey("u/usr_1/run_log/fil_2.jsonl.gz")).toBe(".jsonl.gz");
    expect(extensionOfKey("u/usr_1/run_log/fil_2.jsonl")).toBe(".jsonl");
    expect(extensionOfKey("u/usr_1/run_log/fil_2.gz")).toBe(".gz");
    expect(safeDownloadName("steps.jsonl.gz", "fil_2", ".jsonl.gz")).toBe(
      "steps.jsonl.gz"
    );
    expect(safeDownloadName(null, "fil_2", ".jsonl.gz")).toBe("fil_2.jsonl.gz");
  });

  it("TFIX-RUNLOG-GZIP POST /api/v1/files stores a real gzip run_log from the CLI", async () => {
    const h = await harness();
    const cli = await h.client.cliSession(EMAIL);
    const bytes = await gzip(enc.encode(STEP_LOG));
    const res = await uploadFile(cli, {
      bytes,
      meta: {
        kind: "run_log",
        content_type: "application/gzip",
        original_name: "steps.jsonl.gz",
        links: { application_id: h.app.id },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.file).toMatchObject({
      kind: "run_log",
      status: "ready",
      content_type: "application/gzip",
      size_bytes: bytes.length,
      original_name: "steps.jsonl.gz",
      retention_until: h.clock.now() + 30 * 86_400_000,
    });
    const [row] = rowsOf(h.t.jobsSqlite, "files", h.userId);
    expect(row.r2_key).toBe(
      `u/${h.userId}/run_log/${res.body.file.id as string}.jsonl.gz`
    );
    const object = h.t.r2.objects.get(row.r2_key as string);
    expect(object?.httpMetadata).toMatchObject({
      contentType: "application/gzip",
      contentDisposition: "attachment",
    });
    // Stored as uploaded: still the compressed body, never inflated.
    expect(object?.body).toEqual(bytes);
    expect(await gunzip(object?.body as Uint8Array)).toBe(STEP_LOG);

    const download = await cli.call(
      "GET",
      `/api/v1/files/${res.body.file.id as string}/content`
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toContain(
      'filename="steps.jsonl.gz"'
    );
  });

  it("TFIX-RUNLOG-GZIP refuses a body declared application/gzip that is not gzip", async () => {
    const h = await harness();
    const cli = await h.client.cliSession(EMAIL);
    const plain = await uploadFile(cli, {
      bytes: enc.encode(STEP_LOG),
      meta: { kind: "run_log", content_type: "application/gzip" },
    });
    expect(plain.status).toBe(422);
    expect(plain.body).toMatchObject({
      error: "policy_violation",
      details: { reason: "magic_mismatch" },
    });
    const truncatedHeader = await uploadFile(cli, {
      bytes: new Uint8Array([0x1f, 0x8b, 0x00, 0x00, 0x7b, 0x7d]),
      meta: { kind: "run_log", content_type: "application/gzip" },
    });
    expect(truncatedHeader.status).toBe(422);
    expect(rowsOf(h.t.jobsSqlite, "files", h.userId)).toEqual([]);
    expect(h.t.r2.objects.size).toBe(0);
    // Other kinds still refuse the gzip type outright.
    const attachment = await uploadFile(cli, {
      bytes: await gzip(enc.encode(STEP_LOG)),
      meta: { kind: "attachment", content_type: "application/gzip" },
    });
    expect(attachment.status).toBe(400);
    expect(attachment.body).toMatchObject({ error: "invalid_request" });
  });
});
