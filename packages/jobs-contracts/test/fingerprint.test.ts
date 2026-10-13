import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import urlVectors from "../test-vectors/canonical-url.json" with {
  type: "json",
};
import fpVectors from "../test-vectors/fingerprint.json" with { type: "json" };
import domainVectors from "../test-vectors/registrable-domain.json" with {
  type: "json",
};
import type { FingerprintInput } from "../src/fingerprint";
import {
  asciiHost,
  canonicalUrl,
  contentHash,
  dedupeGroup,
  dedupeGroupKey,
  fingerprint,
  fingerprintKey,
  legacyFingerprint,
  normalizeText,
  primaryLocation,
  publicSuffix,
  registrableDomain,
  sha256Hex,
} from "../src/fingerprint";
import {
  PSL_COMMIT,
  PSL_ICANN_RULES,
  PSL_PRIVATE_RULES,
  PSL_VERSION,
} from "../src/psl-data";

const ASCII_RULE = /^(!|\*\.)?[a-z0-9.-]+$/;

const nodeSha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("fp1 fingerprint (03 §4.2)", () => {
  test("TC-FP vectors cover every stable source kind and both key kinds", () => {
    const kinds = new Set(fpVectors.cases.map((c) => c.input.source_kind));
    for (const kind of [
      "greenhouse",
      "lever",
      "ashby",
      "smartrecruiters",
      "workable",
      "workday",
    ]) {
      expect(
        fpVectors.cases.some((c) => c.key.startsWith(`src|${kind}|`))
      ).toBe(true);
    }
    expect(kinds.has("career_page")).toBe(true);
    expect(
      fpVectors.cases.filter((c) => c.key.startsWith("gen|")).length
    ).toBeGreaterThan(15);
    expect(fpVectors.cases.length).toBeGreaterThanOrEqual(30);
  });

  test.each(fpVectors.cases.map((c) => [c.name, c] as const))(
    "TC-FP %s",
    async (_name, c) => {
      const input = c.input as FingerprintInput;
      expect(fingerprintKey(input)).toBe(c.key);
      expect(await fingerprint(input)).toBe(c.fingerprint);
      expect(c.fingerprint).toBe(`fp1:${nodeSha256(c.key)}`);
    }
  );

  test.each(
    fpVectors.normalize_text.map((c) => [JSON.stringify(c.input), c] as const)
  )("TC-FP normalizeText %s", (_label, c) => {
    expect(normalizeText(c.input)).toBe(c.output);
    expect(normalizeText(c.output)).toBe(c.output);
  });

  test("TC-FP content hash = sha256(normalize(title) \\n normalize(description))", async () => {
    for (const c of fpVectors.content_hash) {
      expect(await contentHash(c.title, c.description)).toBe(c.content_hash);
      expect(c.content_hash).toBe(nodeSha256(c.normalized));
    }
    // Whitespace and case edits do not change the hash; content does.
    expect(fpVectors.content_hash[0]?.content_hash).toBe(
      fpVectors.content_hash[1]?.content_hash
    );
  });

  test("TC-FP dedupe group uses company domain, normalized title and primary location", async () => {
    for (const c of fpVectors.dedupe_group) {
      expect(dedupeGroupKey(c.input)).toBe(c.key);
      expect(await dedupeGroup(c.input)).toBe(c.dedupe_group);
    }
  });

  test("TC-FP legacy fingerprint is fp1 over legacy|<user_id>|<id>", async () => {
    for (const c of fpVectors.legacy) {
      expect(await legacyFingerprint(c.user_id, c.legacy_id)).toBe(
        c.fingerprint
      );
    }
  });

  test("TC-FP gen keys change with content, src keys do not", () => {
    const base: FingerprintInput = {
      source_kind: "career_page",
      company_domain: "acme.com",
      title: "Engineer",
      apply_url: "https://acme.com/jobs/1",
    };
    expect(fingerprintKey(base)).not.toBe(
      fingerprintKey({ ...base, title: "Designer" })
    );
    const src: FingerprintInput = {
      ...base,
      source_kind: "lever",
      source_org: "acme",
      source_job_ref: "7",
    };
    expect(fingerprintKey(src)).toBe(
      fingerprintKey({ ...src, title: "Designer" })
    );
  });

  test("TC-FP WebCrypto sha256 matches node:crypto", async () => {
    for (const text of ["", "abc", "src|lever|acme|1", "ünïcødé ✓"]) {
      expect(await sha256Hex(text)).toBe(nodeSha256(text));
    }
  });

  test("TC-FP primaryLocation is locations[0].raw", () => {
    expect(primaryLocation([{ raw: "Jakarta" }, { raw: "Bandung" }])).toBe(
      "Jakarta"
    );
    expect(primaryLocation([])).toBe("");
    expect(primaryLocation(null)).toBe("");
  });
});

describe("canonical_url (03 §4.2)", () => {
  test("TC-URL vectors cover tracking params, ports, fragments, IDN and refusals", () => {
    expect(urlVectors.cases.length).toBeGreaterThanOrEqual(20);
    expect(urlVectors.cases.some((c) => c.output === null)).toBe(true);
  });

  test.each(urlVectors.cases.map((c) => [c.name, c] as const))(
    "TC-URL %s",
    (_name, c) => {
      expect(canonicalUrl(c.input)).toBe(c.output);
      if (c.output !== null) {
        // Idempotent.
        expect(canonicalUrl(c.output)).toBe(c.output);
      }
    }
  );
});

describe("registrable domain (vendored Public Suffix List)", () => {
  test("TC-PSL generated data matches the vendored list header", () => {
    const dat = readFileSync(
      join(import.meta.dir, "..", "psl", "public_suffix_list.dat"),
      "utf8"
    );
    expect(dat).toContain(`// VERSION: ${PSL_VERSION}`);
    expect(dat).toContain(`// COMMIT: ${PSL_COMMIT}`);
    expect(domainVectors.psl_version).toBe(PSL_VERSION);
    const icann = PSL_ICANN_RULES.split(" ");
    const priv = PSL_PRIVATE_RULES.split(" ");
    expect(icann.length).toBeGreaterThan(5000);
    expect(priv.length).toBeGreaterThan(1000);
    expect(icann).toContain("*.ck");
    expect(icann).toContain("!www.ck");
    expect(icann).toContain("xn--55qx5d.cn");
    expect(priv).toContain("github.io");
    for (const rule of [...icann, ...priv]) {
      expect(rule).toMatch(ASCII_RULE);
    }
  });

  test.each(
    domainVectors.cases.map(
      (c) =>
        [`${c.input}${c.include_private ? "" : " (ICANN only)"}`, c] as const
    )
  )("TC-PSL %s", (_label, c) => {
    const options = { includePrivate: c.include_private };
    expect(registrableDomain(c.input, options)).toBe(c.registrable_domain);
    expect(publicSuffix(c.input, options)).toBe(c.public_suffix);
  });

  test("TC-PSL asciiHost normalizes hosts and URLs", () => {
    expect(asciiHost("WWW.Acme.COM.")).toBe("www.acme.com");
    expect(asciiHost("https://Jobs.Acme.com/x?y")).toBe("jobs.acme.com");
    expect(asciiHost("bücher.de")).toBe("xn--bcher-kva.de");
    expect(asciiHost("")).toBeNull();
    expect(asciiHost("not a host")).toBeNull();
  });
});
