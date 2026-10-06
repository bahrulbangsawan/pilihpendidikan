// JSON body parser with a hard size cap. Wraps `request.json()` and
// validates `Content-Length` before reading so a 200MB attacker request
// can't OOM the isolate. Multipart upload paths use formData() — they
// already enforce their own per-field caps and must NOT route through
// here.

const DEFAULT_MAX_BYTES = 262_144; // 256 KB — generous for any control-plane JSON

class JsonBodyTooLargeError extends Error {
  status = 413;
  constructor(message = "Request body exceeds size limit.") {
    super(message);
    this.name = "JsonBodyTooLargeError";
  }
}

class JsonBodyInvalidError extends Error {
  status = 400;
  constructor(message = "Request body is not valid JSON.") {
    super(message);
    this.name = "JsonBodyInvalidError";
  }
}

export interface ReadJsonBodyOptions {
  maxBytes?: number;
}

// Reads + parses the body. Throws `JsonBodyTooLargeError` if Content-Length
// exceeds the cap (or, when no header is present, after streaming past the
// cap). Throws `JsonBodyInvalidError` on parse failure. Returns the parsed
// JSON value as `unknown` — callers should zod-validate.
export async function readJsonBody(
  request: Request,
  options: ReadJsonBodyOptions = {}
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lenHeader = request.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > maxBytes) {
      throw new JsonBodyTooLargeError();
    }
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new JsonBodyTooLargeError();
  }
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new JsonBodyInvalidError();
  }
}
