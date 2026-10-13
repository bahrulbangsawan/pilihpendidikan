import { describe, expect, it } from "vitest";
import { makeApplication, makeDetail, makePosting } from "@/test/fixtures";
import { makeEmail, makeFileView } from "@/test/fixtures-rest";
import { matchDownloadPath } from "./download";
import type { EmlDownloadDeps } from "./eml-download";
import { buildEmlDownload } from "./eml-download";
import { sha256Hex } from "./render-bff";

const BEARER = "bearer-SECRET-0123456789abcdef0123456789";
const PDF = new TextEncoder().encode("%PDF-1.4\nthe approved cv\n%%EOF");

async function harness(
  options: {
    status?: "draft" | "approved" | "handed_off";
    sha?: string;
    facts?: { key: string; value: string }[];
  } = {}
) {
  const application = makeApplication();
  const file = makeFileView({
    sha256: options.sha ?? (await sha256Hex(PDF)),
    size_bytes: PDF.length,
    original_name: "Rina Wulandari - CV.pdf",
  });
  const email = makeEmail(application.id, {
    status: options.status ?? "approved",
    attachment_file_ids: [file.id],
  });
  const detail = makeDetail({
    application,
    posting: makePosting({ company_name: "Acme Indonesia" }),
    emails: [email],
  });
  const calls: { path: string; auth: string | null }[] = [];
  const facts = (
    options.facts ?? [
      { key: "contact.email", value: "rina.wulandari@example.com" },
      { key: "contact.full_name", value: "Rina Wulandari" },
    ]
  ).map((fact, index) => ({
    id: `fct_01JA00000000000000000000F${index}`,
    user_id: application.user_id,
    key: fact.key,
    value: fact.value,
    source: "user_entered",
    cv_id: null,
    cv_entry_id: null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
  }));
  const deps: EmlDownloadDeps = {
    fetchApi: async (path, init) => {
      calls.push({
        path,
        auth: new Headers(init.headers).get("Authorization"),
      });
      if (path === `/api/v1/applications/${application.id}`) {
        return Response.json(detail);
      }
      if (path === "/api/v1/profile/facts") {
        return Response.json({ facts, profile_version: 1 });
      }
      if (path === `/api/v1/files/${file.id}`) {
        return Response.json({ file });
      }
      if (path === `/api/v1/files/${file.id}/content`) {
        return await Promise.resolve(new Response(PDF));
      }
      return new Response("nope", { status: 404 });
    },
    now: () => Date.UTC(2026, 9, 12, 7, 0, 0),
    random: (size) => new Uint8Array(size).fill(7),
    sessionEmail: "rina@example.com",
  };
  return { application, email, file, calls, deps };
}

describe("TW-EML the BFF builds the .eml of an approved draft (09 §6.1)", () => {
  it("TW-EML fetches the draft, the sender and each attachment server-side and verifies its SHA-256", async () => {
    const { application, email, calls, deps } = await harness();
    const result = await buildEmlDownload(
      application.id,
      email.id,
      BEARER,
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.fileName).toBe("acme-indonesia-application.eml");
    const text = new TextDecoder().decode(result.bytes);
    expect(text).toContain("From: Rina Wulandari <rina.wulandari@example.com>");
    expect(text).toContain(`To: ${email.to_address}`);
    expect(text).toContain("X-Unsent: 1");
    expect(text).toContain('filename="Rina Wulandari - CV.pdf"');
    expect(text).not.toContain(BEARER);
    expect(calls.every((call) => call.auth === `Bearer ${BEARER}`)).toBe(true);
  });

  it("TW-EML aborts when an attachment does not match its SHA-256", async () => {
    const { application, email, deps } = await harness({ sha: "f".repeat(64) });
    expect(
      await buildEmlDownload(application.id, email.id, BEARER, deps)
    ).toMatchObject({ ok: false, status: 502 });
  });

  it("TW-EML refuses a draft that is not approved yet and an unknown draft", async () => {
    const draft = await harness({ status: "draft" });
    expect(
      await buildEmlDownload(
        draft.application.id,
        draft.email.id,
        BEARER,
        draft.deps
      )
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await buildEmlDownload(
        draft.application.id,
        "eml_01JA0000000000000000000000",
        BEARER,
        draft.deps
      )
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("TW-EML falls back to the signed-in address when the profile has no contact email", async () => {
    const { application, email, deps } = await harness({ facts: [] });
    const result = await buildEmlDownload(
      application.id,
      email.id,
      BEARER,
      deps
    );
    expect(result.ok && new TextDecoder().decode(result.bytes)).toContain(
      "From: rina@example.com"
    );
  });

  it("TW-EML only plain-id .eml paths reach the handler", () => {
    expect(matchDownloadPath("applications/app_1/emails/eml_2.eml")).toEqual({
      kind: "eml",
      appId: "app_1",
      emlId: "eml_2",
    });
    expect(matchDownloadPath("applications/../emails/eml_2.eml")).toBeNull();
    expect(matchDownloadPath("applications/app_1/emails/eml_2.txt")).toBeNull();
  });
});
