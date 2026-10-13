import { describe, expect, it } from "bun:test";
import { sha256Hex } from "../cv/canonical";
import { parseByteRange } from "./download";
import { createUploadInspector, UploadTooLargeError } from "./inspect";
import {
  boundaryOf,
  indexOfBytes,
  MultipartError,
  MultipartReader,
} from "./multipart";
import {
  initialRetention,
  magicMatches,
  r2KeyFor,
  safeDownloadName,
  typeRuleFor,
} from "./policy";
import { Sha256 } from "./sha256";

const enc = new TextEncoder();

function streamOf(
  bytes: Uint8Array,
  chunk: number
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

function body(boundary: string, file: Uint8Array): Uint8Array {
  const head = enc.encode(
    `preamble\r\n--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n{"a":1}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\nContent-Type: application/pdf\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\nepilogue`);
  const out = new Uint8Array(head.length + file.length + tail.length);
  out.set(head, 0);
  out.set(file, head.length);
  out.set(tail, head.length + file.length);
  return out;
}

async function readAll(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("streaming multipart reader", () => {
  it("TF-UPLOAD parses meta and file at every chunk size, delimiter look-alikes included", async () => {
    const boundary = "b0und4ry";
    // File content that contains partial delimiters and CRLFs.
    const file = enc.encode(
      `%PDF-1.7\r\n--b0und4\r\n\r\n--b0und4rx\r\n-${"x".repeat(300)}\r\n`
    );
    const raw = body(boundary, file);
    for (const size of [1, 2, 3, 7, 11, 64, 4096]) {
      const reader = new MultipartReader(streamOf(raw, size), boundary);
      const meta = await reader.nextPart();
      expect(meta).toEqual({ name: "meta", filename: null, contentType: null });
      expect(await reader.readText(1024)).toBe('{"a":1}');
      const part = await reader.nextPart();
      expect(part).toEqual({
        name: "file",
        filename: "x.bin",
        contentType: "application/pdf",
      });
      expect(await readAll(reader.stream())).toEqual(file);
      await reader.finish();
    }
  });

  it("TF-UPLOAD refuses truncated bodies, oversize parts and an extra part after the file", async () => {
    const boundary = "zz";
    const raw = body(boundary, enc.encode("%PDF-abc"));
    const cut = new MultipartReader(
      streamOf(raw.slice(0, raw.length - 20), 5),
      boundary
    );
    await cut.nextPart();
    await cut.readText(100);
    await cut.nextPart();
    await expect(readAll(cut.stream())).rejects.toBeInstanceOf(MultipartError);
    expect(cut.streamError?.code).toBe("truncated");

    const big = new MultipartReader(streamOf(raw, 3), boundary);
    await big.nextPart();
    await expect(big.readText(3)).rejects.toMatchObject({ code: "too_large" });

    const extra = enc.encode(
      `--zz\r\nContent-Disposition: form-data; name="file"\r\n\r\nA\r\n--zz\r\nContent-Disposition: form-data; name="more"\r\n\r\nB\r\n--zz--`
    );
    const reader = new MultipartReader(streamOf(extra, 4), "zz");
    await reader.nextPart();
    await readAll(reader.stream());
    await expect(reader.finish()).rejects.toMatchObject({ code: "malformed" });
  });

  it("finds boundaries and byte sequences", () => {
    expect(boundaryOf("multipart/form-data; boundary=abc")).toBe("abc");
    expect(boundaryOf('multipart/form-data; boundary="a b"')).toBe("a b");
    expect(boundaryOf("application/json")).toBeNull();
    expect(boundaryOf("multipart/form-data")).toBeNull();
    expect(indexOfBytes(enc.encode("aaab"), enc.encode("ab"))).toBe(2);
    expect(indexOfBytes(enc.encode("abc"), enc.encode("abcd"))).toBe(-1);
  });
});

describe("incremental SHA-256 and the upload inspector", () => {
  it("TF-UPLOAD matches WebCrypto for every split of the input", async () => {
    const data = new Uint8Array(1000).map((_, i) => (i * 31) % 256);
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 1000]) {
      const slice = data.slice(0, size);
      const hasher = new Sha256();
      for (let i = 0; i < slice.length; i += 13) {
        hasher.update(slice.subarray(i, i + 13));
      }
      expect(hasher.hex()).toBe(await sha256Hex(slice));
    }
  });

  it("TF-UPLOAD the inspector hashes, counts and keeps only the 8-byte head", async () => {
    const data = enc.encode(`%PDF-1.4${"y".repeat(5000)}`);
    const inspector = createUploadInspector(10_000);
    const out = await readAll(
      streamOf(data, 333).pipeThrough(inspector.transform)
    );
    expect(out).toEqual(data);
    const result = await inspector.result;
    expect(result.bytes).toBe(data.length);
    expect(result.sha256).toBe(await sha256Hex(data));
    expect(new TextDecoder().decode(result.head)).toBe("%PDF-1.4");
    expect(inspector.completed()).toEqual(result);
  });

  it("T8-09 the inspector stops a stream that passes its cap", async () => {
    const inspector = createUploadInspector(100);
    await expect(
      readAll(
        streamOf(new Uint8Array(500), 64).pipeThrough(inspector.transform)
      )
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(inspector.failure()?.limit).toBe(100);
    expect(inspector.completed()).toBeNull();
  });
});

describe("file policy", () => {
  it("T8-09 magic bytes per declared type", () => {
    expect(magicMatches("pdf", enc.encode("%PDF-1.7"))).toBe(true);
    expect(magicMatches("pdf", enc.encode("<html>"))).toBe(false);
    expect(
      magicMatches(
        "png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBe(true);
    expect(magicMatches("jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      true
    );
    expect(magicMatches("zip", enc.encode("PK\u0003\u0004"))).toBe(true);
    expect(magicMatches("jsonl", enc.encode('{"a":1}'))).toBe(true);
    expect(magicMatches("jsonl", enc.encode("%PDF-1.7"))).toBe(false);
    expect(magicMatches("text", enc.encode("Dear team"))).toBe(true);
    expect(magicMatches("text", new Uint8Array([0x41, 0x00, 0x42]))).toBe(
      false
    );
  });

  it("T8-09 the content-type allowlist is per kind", () => {
    expect(typeRuleFor("cv_pdf", "application/pdf")?.ext).toBe(".pdf");
    expect(typeRuleFor("cv_pdf", "Application/PDF; charset=binary")?.ext).toBe(
      ".pdf"
    );
    expect(typeRuleFor("cv_pdf", "image/png")).toBeNull();
    expect(typeRuleFor("evidence_screenshot", "image/jpeg")?.ext).toBe(".jpg");
    expect(typeRuleFor("evidence_screenshot", "application/pdf")).toBeNull();
    expect(typeRuleFor("run_log", "text/plain")?.magic).toBe("jsonl");
  });

  it("TF-UPLOAD keys, retention and safe download names", () => {
    expect(r2KeyFor("usr_1", "cv_pdf", "fil_2", ".pdf")).toBe(
      "u/usr_1/cv_pdf/fil_2.pdf"
    );
    expect(initialRetention("cv_pdf", 1000, 180)).toBeNull();
    expect(initialRetention("evidence_screenshot", 0, 30)).toBe(
      30 * 86_400_000
    );
    expect(initialRetention("run_log", 0, 180)).toBe(30 * 86_400_000);
    expect(safeDownloadName('a"b\r\n.pdf', "fil_1", ".pdf")).toBe("ab.pdf");
    expect(safeDownloadName("../../etc/passwd", "fil_1", ".pdf")).toBe(
      "etcpasswd.pdf"
    );
    expect(safeDownloadName("Résumé.pdf", "fil_1", ".pdf")).toBe("Resume.pdf");
    expect(safeDownloadName(null, "fil_1", ".png")).toBe("fil_1.png");
    expect(safeDownloadName("日本語", "fil_1", ".pdf")).toBe("fil_1.pdf");
  });

  it("TF-DOWNLOAD parses single byte ranges", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ offset: 0, length: 10 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({
      offset: 90,
      length: 10,
    });
    expect(parseByteRange("bytes=-5", 100)).toEqual({ offset: 95, length: 5 });
    expect(parseByteRange("bytes=0-999", 100)).toEqual({
      offset: 0,
      length: 100,
    });
    expect(parseByteRange("bytes=200-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseByteRange(null, 100)).toBeNull();
  });
});
