// The export ZIP writer (11 §10): TP-EXPORT format checks — CRC-32 vectors,
// a byte-exact STORED layout that `unzip` accepts, one put for a small zip
// and an equal-part multipart upload for a large one.

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeR2 } from "../../../../test/fakes";
import { crc32, R2ZipSink, ZipWriter } from "./zip";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemorySink {
  readonly chunks: Uint8Array[] = [];
  write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk.slice());
    return Promise.resolve();
  }
  bytes(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

function entriesOf(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06_05_4b_50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    );
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, decoder.decode(data));
    offset += 46 + nameLength;
  }
  return out;
}

describe("TP-EXPORT zip writer", () => {
  it("TP-EXPORT crc32 matches the IEEE check value", () => {
    expect(crc32(encoder.encode("123456789"))).toBe(0xcb_f4_39_26);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(
      crc32(encoder.encode("The quick brown fox jumps over the lazy dog"))
    ).toBe(0x41_4f_a3_39);
  });

  it("TP-EXPORT writes a STORED archive that round-trips (and unzip -t accepts)", async () => {
    const sink = new MemorySink();
    const zip = new ZipWriter(sink, new Date(Date.UTC(2026, 9, 12, 8, 30, 10)));
    await zip.addFile("README.txt", "hello\n");
    await zip.addFile("data/applications.json", '[{"id":"app_1"}]\n');
    await zip.addFile("cvs/ünïcode-cv.json", "{}");
    await zip.addFile(
      "files/cv_pdf/fil_1.pdf",
      new Uint8Array([37, 80, 68, 70])
    );
    await expect(zip.addFile("README.txt", "again")).rejects.toThrow(
      "duplicate zip entry"
    );
    const done = await zip.finish();
    const bytes = sink.bytes();
    expect(done).toEqual({ bytes: bytes.length, entries: 4 });
    const entries = entriesOf(bytes);
    expect([...entries.keys()]).toEqual([
      "README.txt",
      "data/applications.json",
      "cvs/ünïcode-cv.json",
      "files/cv_pdf/fil_1.pdf",
    ]);
    expect(entries.get("data/applications.json")).toBe('[{"id":"app_1"}]\n');
    expect(entries.get("files/cv_pdf/fil_1.pdf")).toBe("%PDF");
    const probe = spawnSync("unzip", ["-v"]);
    if (probe.status === 0) {
      const dir = mkdtempSync(join(tmpdir(), "pilih-zip-"));
      try {
        const file = join(dir, "export.zip");
        writeFileSync(file, bytes);
        const result = spawnSync("unzip", ["-t", file]);
        expect(result.status).toBe(0);
        expect(result.stdout.toString()).toContain("No errors detected");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("TP-EXPORT a small zip goes to R2 with one put", async () => {
    const r2 = createFakeR2();
    const sink = new R2ZipSink(r2.bucket, "u/usr_x/export/exp_x.zip", {
      httpMetadata: { contentType: "application/zip" },
    });
    const zip = new ZipWriter(sink, new Date(0));
    await zip.addFile("a.txt", "a");
    await zip.finish();
    await sink.close();
    const stored = r2.objects.get("u/usr_x/export/exp_x.zip");
    expect(stored?.httpMetadata.contentType).toBe("application/zip");
    expect(entriesOf(stored?.body ?? new Uint8Array()).get("a.txt")).toBe("a");
  });

  it("TP-EXPORT a large zip streams as a multipart upload of equal parts", async () => {
    const r2 = createFakeR2();
    const parts: number[] = [];
    let completed = false;
    let aborted = false;
    const bucket = {
      put: r2.bucket.put.bind(r2.bucket),
      createMultipartUpload(key: string, options?: R2MultipartOptions) {
        const uploaded: Uint8Array[] = [];
        return Promise.resolve({
          uploadPart(n: number, value: Uint8Array) {
            parts.push(value.length);
            uploaded[n - 1] = value.slice();
            return Promise.resolve({ partNumber: n, etag: `etag-${n}` });
          },
          async complete(list: R2UploadedPart[]) {
            completed = true;
            expect(list.map((p) => p.partNumber)).toEqual(
              uploaded.map((_, i) => i + 1)
            );
            const total = uploaded.reduce((n, c) => n + c.length, 0);
            const joined = new Uint8Array(total);
            let at = 0;
            for (const chunk of uploaded) {
              joined.set(chunk, at);
              at += chunk.length;
            }
            return await r2.bucket.put(key, joined, options);
          },
          abort() {
            aborted = true;
            return Promise.resolve();
          },
        });
      },
    } as unknown as R2Bucket;
    const partSize = 1024;
    const sink = new R2ZipSink(bucket, "big.zip", {}, partSize);
    const zip = new ZipWriter(sink, new Date(0));
    const blob = new Uint8Array(3000).fill(65);
    await zip.addFile("one.bin", blob);
    await zip.addFile("two.bin", blob);
    const done = await zip.finish();
    await sink.close();
    expect(completed).toBe(true);
    expect(aborted).toBe(false);
    expect(parts.slice(0, -1).every((size) => size === partSize)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(done.bytes);
    const entries = entriesOf(
      r2.objects.get("big.zip")?.body ?? new Uint8Array()
    );
    expect(entries.get("two.bin")?.length).toBe(3000);
  });
});
