// A streaming `multipart/form-data` reader (RFC 7578) for `POST
// /api/v1/files` (05 §7, 14 §5.2). `request.formData()` would buffer the whole
// body (up to 25 MB) in memory; this reader never does:
//
//   const reader = MultipartReader.fromRequest(request);   // 400 on a bad type
//   const meta = await reader.nextPart();                 // headers of part 1
//   const text = await reader.readText(64 * 1024);        // small part, capped
//   const file = await reader.nextPart();
//   await bucket.put(key, reader.stream());              // streamed, never held
//   await reader.finish();                                // closing delimiter
//
// Only the bytes that might be the start of a delimiter (boundary length + 3)
// are ever held back between chunks; header blocks and small parts are capped.

const CRLF = new Uint8Array([0x0d, 0x0a]);
const DOUBLE_DASH = new Uint8Array([0x2d, 0x2d]);
const HEADER_END = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);
const HEADER_BLOCK_MAX = 8 * 1024;
const PREAMBLE_MAX = 4 * 1024;
const BOUNDARY_RE = /(?:^|;)\s*boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i;
const MULTIPART_RE = /^multipart\/form-data\s*(;|$)/i;
const DISPOSITION_NAME_RE = /(?:^|;)\s*name="([^"]*)"/i;
const DISPOSITION_FILENAME_RE = /(?:^|;)\s*filename="([^"]*)"/i;
const HEADER_LINE_RE = /^([^:]+):\s*(.*)$/;

export type MultipartErrorCode = "malformed" | "too_large" | "truncated";

export class MultipartError extends Error {
  readonly code: MultipartErrorCode;
  constructor(code: MultipartErrorCode, message: string) {
    super(message);
    this.name = "MultipartError";
    this.code = code;
  }
}

export interface PartHeaders {
  contentType: string | null;
  filename: string | null;
  name: string;
}

/** Index of `needle` in `haystack` at or after `from`, or -1. */
export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from = 0
): number {
  const first = needle[0];
  const last = haystack.length - needle.length;
  for (let i = haystack.indexOf(first, from); i !== -1 && i <= last; ) {
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) {
      j += 1;
    }
    if (j === needle.length) {
      return i;
    }
    i = haystack.indexOf(first, i + 1);
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) {
    return b;
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function equalsAt(buf: Uint8Array, at: number, bytes: Uint8Array): boolean {
  if (buf.length < at + bytes.length) {
    return false;
  }
  return bytes.every((byte, i) => buf[at + i] === byte);
}

/** The boundary of a `multipart/form-data` Content-Type, or null. */
export function boundaryOf(contentType: string | null): string | null {
  if (!(contentType && MULTIPART_RE.test(contentType.trim()))) {
    return null;
  }
  const match = BOUNDARY_RE.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function parseHeaders(block: string): PartHeaders {
  let disposition = "";
  let contentType: string | null = null;
  for (const line of block.split("\r\n")) {
    const match = HEADER_LINE_RE.exec(line);
    if (!match) {
      continue;
    }
    const name = match[1].trim().toLowerCase();
    if (name === "content-disposition") {
      disposition = match[2];
    } else if (name === "content-type") {
      contentType = match[2].trim();
    }
  }
  if (!disposition.toLowerCase().startsWith("form-data")) {
    throw new MultipartError(
      "malformed",
      "Every part needs Content-Disposition: form-data."
    );
  }
  const name = DISPOSITION_NAME_RE.exec(disposition)?.[1];
  if (name === undefined) {
    throw new MultipartError("malformed", "A part has no name.");
  }
  return {
    name,
    filename: DISPOSITION_FILENAME_RE.exec(disposition)?.[1] ?? null,
    contentType,
  };
}

type State = "start" | "headers" | "body" | "between" | "end";

export class MultipartReader {
  readonly #source: ReadableStreamDefaultReader<Uint8Array>;
  readonly #dashBoundary: Uint8Array;
  /** CRLF + "--" + boundary: what ends a part body. */
  readonly #delimiter: Uint8Array;
  #buf: Uint8Array = new Uint8Array(0);
  #eof = false;
  #state: State = "start";
  #streamError: MultipartError | null = null;

  constructor(body: ReadableStream<Uint8Array>, boundary: string) {
    this.#source = body.getReader();
    this.#dashBoundary = new TextEncoder().encode(`--${boundary}`);
    this.#delimiter = concat(CRLF, this.#dashBoundary);
  }

  /** A reader over a request body; throws `MultipartError` when it is not multipart. */
  static fromRequest(request: Request): MultipartReader {
    const boundary = boundaryOf(request.headers.get("content-type"));
    if (!boundary) {
      throw new MultipartError(
        "malformed",
        "Send multipart/form-data with a boundary (parts: meta, file)."
      );
    }
    if (!request.body) {
      throw new MultipartError("malformed", "The request has no body.");
    }
    return new MultipartReader(request.body, boundary);
  }

  // Appends the next chunk; false at the end of the body.
  async #fill(): Promise<boolean> {
    if (this.#eof) {
      return false;
    }
    const { done, value } = await this.#source.read();
    if (done) {
      this.#eof = true;
      return false;
    }
    if (value && value.length > 0) {
      this.#buf = concat(this.#buf, value);
    }
    return true;
  }

  async #ensure(bytes: number): Promise<void> {
    while (this.#buf.length < bytes) {
      if (!(await this.#fill())) {
        throw new MultipartError(
          "truncated",
          "The multipart body ended early."
        );
      }
    }
  }

  async #skipPreamble(): Promise<void> {
    for (;;) {
      const at = indexOfBytes(this.#buf, this.#dashBoundary);
      if (at !== -1 && (at === 0 || equalsAt(this.#buf, at - 2, CRLF))) {
        this.#buf = this.#buf.subarray(at + this.#dashBoundary.length);
        return;
      }
      if (this.#buf.length > PREAMBLE_MAX) {
        throw new MultipartError("malformed", "No multipart boundary found.");
      }
      if (!(await this.#fill())) {
        throw new MultipartError("truncated", "No multipart boundary found.");
      }
    }
  }

  /** After a boundary: "--" ends the body, CRLF starts the next part. */
  async #afterBoundary(): Promise<boolean> {
    await this.#ensure(2);
    if (equalsAt(this.#buf, 0, DOUBLE_DASH)) {
      this.#state = "end";
      return false;
    }
    if (!equalsAt(this.#buf, 0, CRLF)) {
      throw new MultipartError("malformed", "Malformed multipart delimiter.");
    }
    return true;
  }

  /** The headers of the next part, or null after the closing delimiter. */
  async nextPart(): Promise<PartHeaders | null> {
    if (this.#state === "start") {
      await this.#skipPreamble();
      this.#state = "between";
    }
    if (this.#state === "body") {
      throw new Error("read the current part before the next one");
    }
    if (this.#state === "end" || !(await this.#afterBoundary())) {
      return null;
    }
    // The CRLF after the boundary doubles as the start of the header block,
    // so an empty block is just CRLF CRLF.
    for (;;) {
      const end = indexOfBytes(this.#buf, HEADER_END);
      if (end !== -1) {
        const block = new TextDecoder().decode(
          this.#buf.subarray(2, Math.max(2, end))
        );
        this.#buf = this.#buf.subarray(end + HEADER_END.length);
        this.#state = "body";
        return parseHeaders(block);
      }
      if (this.#buf.length > HEADER_BLOCK_MAX) {
        throw new MultipartError("malformed", "Part headers are too large.");
      }
      if (!(await this.#fill())) {
        throw new MultipartError(
          "truncated",
          "The multipart body ended early."
        );
      }
    }
  }

  /**
   * The next slice of the current part's body (null once the delimiter was
   * consumed). Holds back at most `delimiter.length - 1` bytes.
   */
  async #nextBodyChunk(): Promise<Uint8Array | null> {
    if (this.#state !== "body") {
      return null;
    }
    for (;;) {
      const at = indexOfBytes(this.#buf, this.#delimiter);
      if (at !== -1) {
        const chunk = this.#buf.slice(0, at);
        this.#buf = this.#buf.subarray(at + this.#delimiter.length);
        this.#state = "between";
        return chunk;
      }
      const keep = this.#delimiter.length - 1;
      if (this.#buf.length > keep) {
        const chunk = this.#buf.slice(0, this.#buf.length - keep);
        this.#buf = this.#buf.subarray(this.#buf.length - keep);
        return chunk;
      }
      if (!(await this.#fill())) {
        throw new MultipartError(
          "truncated",
          "The multipart body ended inside a part."
        );
      }
    }
  }

  /** Reads the current part fully as UTF-8; `too_large` beyond `maxBytes`. */
  async readText(maxBytes: number): Promise<string> {
    let out: Uint8Array = new Uint8Array(0);
    for (;;) {
      const chunk = await this.#nextBodyChunk();
      if (chunk === null) {
        return new TextDecoder().decode(out);
      }
      if (out.length + chunk.length > maxBytes) {
        throw new MultipartError(
          "too_large",
          `This part exceeds ${maxBytes} bytes.`
        );
      }
      out = concat(out, chunk);
    }
  }

  /** The current part's body as a stream (pull-based: read as it is consumed). */
  stream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        // Skip empty slices so a consumer never sees a zero-length chunk.
        for (;;) {
          let chunk: Uint8Array | null;
          try {
            chunk = await this.#nextBodyChunk();
          } catch (err) {
            if (err instanceof MultipartError) {
              this.#streamError = err;
            }
            throw err;
          }
          if (chunk === null) {
            controller.close();
            return;
          }
          if (chunk.length > 0) {
            controller.enqueue(chunk);
            return;
          }
        }
      },
      cancel: async (reason) => {
        await this.#source.cancel(reason);
      },
    });
  }

  /**
   * Requires the closing delimiter after the last part read: another part
   * after the file is refused. The epilogue is ignored.
   */
  async finish(): Promise<void> {
    if (this.#state === "body") {
      throw new Error("read the current part before finishing");
    }
    if (this.#state !== "end" && (await this.#afterBoundary())) {
      throw new MultipartError("malformed", "Unexpected part after the file.");
    }
    await this.#source.cancel().catch(() => undefined);
  }

  /** The malformed / truncated body that broke `stream()`, if any. */
  get streamError(): MultipartError | null {
    return this.#streamError;
  }

  /** Stops reading the body (error paths). */
  async cancel(): Promise<void> {
    await this.#source.cancel().catch(() => undefined);
  }
}
