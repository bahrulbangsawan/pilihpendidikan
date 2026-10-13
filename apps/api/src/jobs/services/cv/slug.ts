// The slug of a tailored CV document (08 §5, 14 §6): `<base>-t-<10 chars>`,
// the 10 characters being lowercase Crockford base32 of the first 50 bits of
// HMAC-SHA256(server key, cv_variant_id). Deterministic per variant, so a
// retried `tailor_cv` message rewrites the same document instead of leaving
// a second one; unguessable without the key (50 bits) as defence in depth on
// top of D-25 privacy.
//
// The HMAC key is a random 256-bit server secret kept in AUTH_KV under
// `jobs:cv-slug-key`, created on first use and cached per isolate. Nothing
// about it is derivable from public data.

import type { Env } from "../../../env";
import { toHex } from "./canonical";

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const SUFFIX_CHARS = 10;
const KEY_NAME = "jobs:cv-slug-key";
const KEY_BYTES = 32;
const HEX_KEY_RE = /^[0-9a-f]{64}$/;
const TAILORED_SUFFIX_RE = /-t-[0-9a-hjkmnp-tv-z]{10}$/;
const STEM_MAX = 80;

const keyCache = new WeakMap<KVNamespace, Promise<CryptoKey>>();

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function loadKeyMaterial(kv: KVNamespace): Promise<string> {
  const existing = await kv.get(KEY_NAME);
  if (existing && HEX_KEY_RE.test(existing)) {
    return existing;
  }
  const fresh = toHex(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
  await kv.put(KEY_NAME, fresh);
  // Converge with a concurrent first writer: whatever KV kept wins.
  const stored = await kv.get(KEY_NAME);
  return stored && HEX_KEY_RE.test(stored) ? stored : fresh;
}

function slugKey(env: Pick<Env, "AUTH_KV">): Promise<CryptoKey> {
  let key = keyCache.get(env.AUTH_KV);
  if (!key) {
    key = loadKeyMaterial(env.AUTH_KV).then((hex) =>
      crypto.subtle.importKey(
        "raw",
        fromHex(hex),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      )
    );
    key.catch(() => keyCache.delete(env.AUTH_KV));
    keyCache.set(env.AUTH_KV, key);
  }
  return key;
}

/** The first `chars × 5` bits of `bytes` in lowercase Crockford base32. */
export function crockfordBase32(bytes: Uint8Array, chars: number): string {
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
    if (bits.length >= chars * 5) {
      break;
    }
  }
  let out = "";
  for (let i = 0; i + 5 <= bits.length && out.length < chars; i += 5) {
    out += CROCKFORD[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

/** The base slug without an earlier `-t-<suffix>` (re-tailoring a variant). */
export function slugStem(baseCvId: string): string {
  return baseCvId.replace(TAILORED_SUFFIX_RE, "").slice(0, STEM_MAX) || "cv";
}

/** `<base>-t-<10 base32>` for a variant (deterministic per cv_variant_id). */
export async function tailoredCvSlug(
  env: Pick<Env, "AUTH_KV">,
  baseCvId: string,
  cvVariantId: string
): Promise<string> {
  const key = await slugKey(env);
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(cvVariantId))
  );
  return `${slugStem(baseCvId)}-t-${crockfordBase32(mac, SUFFIX_CHARS)}`;
}
