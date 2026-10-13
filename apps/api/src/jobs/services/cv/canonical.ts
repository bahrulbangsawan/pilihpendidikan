// Canonical JSON and SHA-256 helpers for CV variants (08 §5, §7).
//
//   canonicalJson(value)   object keys sorted at every level, no whitespace,
//                          `undefined` members dropped (like JSON.stringify)
//   sha256Hex(text|bytes)  lowercase hex digest (WebCrypto)
//
// Two uses: the "edited after approval" fingerprint of a tailored CV document
// (sha256 of the canonical JSON of its normalized CVData) and the approval
// binding `payload_hash = sha256(file.sha256 + canonical diff JSON)`.

/** Lowercase hex of a byte buffer. */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of view) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** SHA-256 of a UTF-8 string or raw bytes, as lowercase hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deterministic JSON: keys sorted by UTF-16 code unit at every depth, no
 * insignificant whitespace. Arrays keep their order; `undefined` members are
 * omitted and `undefined` array items become `null` (JSON.stringify rules).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The approval binding of a CV variant (08 §7, 03 §8):
 * `sha256(file.sha256 + canonical diff JSON)`. A re-render changes the file
 * hash, so an approval recorded for the old PDF no longer matches.
 */
export function cvVariantPayloadHash(
  fileSha256: string,
  diff: unknown
): Promise<string> {
  return sha256Hex(`${fileSha256}${canonicalJson(diff)}`);
}
