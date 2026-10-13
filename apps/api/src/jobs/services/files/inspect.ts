// The upload inspector (14 §5.2 step 4): a TransformStream the file part
// flows through on its way to R2. It
//   (a) computes SHA-256 incrementally — `crypto.DigestStream` in Workers,
//       the incremental ./sha256.ts where DigestStream does not exist (bun
//       test);
//   (b) counts bytes and errors the stream as soon as the cap is passed, so
//       an oversize upload stops instead of being stored;
//   (c) keeps the first 8 bytes for the magic-byte check.
// Nothing but those 8 bytes is retained: bytes pass straight through.
//
// `withKnownLength` wraps the result in a FixedLengthStream (Workers): R2 only
// accepts streams of known length, and a body that is shorter or longer than
// the declared `size_bytes` makes the put fail.

import { toHex } from "../cv/canonical";
import { MAGIC_HEAD_BYTES } from "./policy";
import { Sha256 } from "./sha256";

export class UploadTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`upload exceeds ${limit} bytes`);
    this.name = "UploadTooLargeError";
    this.limit = limit;
  }
}

interface Hasher {
  digest(): Promise<string>;
  update(chunk: Uint8Array): Promise<void>;
}

interface DigestStreamLike extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
}

type DigestStreamCtor = new (algorithm: string) => DigestStreamLike;

function createHasher(): Hasher {
  const DigestStream = (
    crypto as unknown as { DigestStream?: DigestStreamCtor }
  ).DigestStream;
  if (DigestStream) {
    const stream = new DigestStream("SHA-256");
    const writer = stream.getWriter();
    return {
      update: (chunk) => writer.write(chunk),
      async digest() {
        await writer.close();
        return toHex(await stream.digest);
      },
    };
  }
  const hash = new Sha256();
  return {
    update(chunk) {
      hash.update(chunk);
      return Promise.resolve();
    },
    digest: () => Promise.resolve(hash.hex()),
  };
}

export interface InspectionResult {
  bytes: number;
  /** The first bytes of the upload (≤ 8). */
  head: Uint8Array;
  sha256: string;
}

export interface UploadInspector {
  /** The inspection once the whole stream went through, else null. */
  completed(): InspectionResult | null;
  /** The size overrun that stopped the stream, else null. */
  failure(): UploadTooLargeError | null;
  /** Settles once the stream was fully read (rejects on a size overrun). */
  readonly result: Promise<InspectionResult>;
  readonly transform: TransformStream<Uint8Array, Uint8Array>;
}

/** An inspector that errors past `maxBytes`. */
export function createUploadInspector(maxBytes: number): UploadInspector {
  const hasher = createHasher();
  const head = new Uint8Array(MAGIC_HEAD_BYTES);
  let headLength = 0;
  let bytes = 0;
  let overrun: UploadTooLargeError | null = null;
  let done: InspectionResult | null = null;
  let settle!: (value: InspectionResult) => void;
  let fail!: (reason: unknown) => void;
  const result = new Promise<InspectionResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Callers await `result` only on the success path.
  result.catch(() => undefined);
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        overrun = new UploadTooLargeError(maxBytes);
        fail(overrun);
        controller.error(overrun);
        return;
      }
      if (headLength < MAGIC_HEAD_BYTES) {
        const take = chunk.subarray(0, MAGIC_HEAD_BYTES - headLength);
        head.set(take, headLength);
        headLength += take.length;
      }
      await hasher.update(chunk);
      controller.enqueue(chunk);
    },
    async flush() {
      done = {
        bytes,
        head: head.slice(0, headLength),
        sha256: await hasher.digest(),
      };
      settle(done);
    },
  });
  return {
    transform,
    result,
    completed: () => done,
    failure: () => overrun,
  };
}

interface FixedLengthStreamLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}
type FixedLengthCtor = new (length: number) => FixedLengthStreamLike;

/**
 * `stream` with a known length for R2 (Workers FixedLengthStream). Where the
 * runtime has none (bun test, whose fake R2 takes any stream) it is returned
 * as is. `piped` settles when the copy into the fixed-length stream ends.
 */
export function withKnownLength(
  stream: ReadableStream<Uint8Array>,
  length: number
): { piped: Promise<void>; stream: ReadableStream<Uint8Array> } {
  const Fixed = (globalThis as { FixedLengthStream?: FixedLengthCtor })
    .FixedLengthStream;
  if (!Fixed) {
    return { stream, piped: Promise.resolve() };
  }
  const fixed = new Fixed(length);
  const piped = stream.pipeTo(fixed.writable);
  piped.catch(() => undefined);
  return { stream: fixed.readable, piped };
}
