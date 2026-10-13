// The BFF's `.eml` download (09 §6.1, web-only users): built server-side
// from the approved draft, with the attachments fetched from the api and
// checked against their SHA-256 before they go in (the 08 §8 integrity rule
// the CLI applies too; a mismatch aborts the hand-off, T9-05). The bearer is
// used only towards the api; the browser receives the message bytes.

import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import {
  ApplicationDetailSchema,
  FactSheetResponseSchema,
  FileResponseSchema,
} from "@pilihpendidikan/jobs-contracts/api";
import { EMAIL_LIMITS } from "@pilihpendidikan/jobs-contracts/email";
import type { BffDeps } from "./bff";
import { BFF_CLIENT } from "./bff";
import type { EmlAttachment } from "./eml";
import { asciiFileName, buildEml, emlBoundary, isAddrSpec } from "./eml";
import { sha256Hex } from "./render-bff";

/** Drafts the user approved (or already handed off) may be downloaded. */
const DOWNLOADABLE = new Set(["approved", "handed_off"]);
const MESSAGE_ID_HOST = "jobs.pilihpendidikan.com";

export interface EmlDownloadDeps {
  fetchApi: BffDeps["fetchApi"];
  now: () => number;
  random: (bytes: number) => Uint8Array;
  /** The signed-in address: the From when the profile has no contact email. */
  sessionEmail: string | null;
}

export type EmlDownloadResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; fileName: string }
  | { ok: false; status: number; message: string };

function fail(status: number, message: string): EmlDownloadResult {
  return { ok: false, status, message };
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getJson(
  deps: EmlDownloadDeps,
  bearer: string,
  path: string
): Promise<{ status: number; json: unknown } | null> {
  try {
    const response = await deps.fetchApi(path, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearer}`,
        "X-Pilih-Client": BFF_CLIENT,
      },
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    return null;
  }
}

async function getBytes(
  deps: EmlDownloadDeps,
  bearer: string,
  path: string
): Promise<Uint8Array | null> {
  try {
    const response = await deps.fetchApi(path, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Pilih-Client": BFF_CLIENT,
      },
    });
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** `{key, value}` pairs of a fact sheet; one odd fact never hides the rest. */
function factsOf(json: unknown): { key: string; value: unknown }[] {
  const sheet = FactSheetResponseSchema.safeParse(json);
  if (sheet.success) {
    return sheet.data.facts;
  }
  const list =
    typeof json === "object" && json !== null && "facts" in json
      ? (json as { facts: unknown }).facts
      : null;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((fact: unknown) =>
    typeof fact === "object" &&
    fact !== null &&
    "key" in fact &&
    typeof fact.key === "string" &&
    "value" in fact
      ? [{ key: fact.key, value: fact.value }]
      : []
  );
}

function factText(
  facts: readonly { key: string; value: unknown }[],
  key: string
): string | null {
  const value = facts.find((fact) => fact.key === key)?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sender(
  deps: EmlDownloadDeps,
  bearer: string
): Promise<{ address: string; name: string | null } | null> {
  const answer = await getJson(deps, bearer, "/api/v1/profile/facts");
  const facts = factsOf(answer?.json);
  const email = factText(facts, "contact.email");
  const name = factText(facts, "contact.full_name");
  const address =
    email && isAddrSpec(email) ? email : (deps.sessionEmail ?? null);
  return address && isAddrSpec(address) ? { address, name } : null;
}

async function attachmentsOf(
  deps: EmlDownloadDeps,
  bearer: string,
  fileIds: readonly string[]
): Promise<EmlAttachment[] | EmlDownloadResult> {
  const out: EmlAttachment[] = [];
  let total = 0;
  for (const fileId of fileIds) {
    const meta = await getJson(deps, bearer, `/api/v1/files/${fileId}`);
    const file = FileResponseSchema.safeParse(meta?.json);
    if (!file.success || file.data.file.status !== "ready") {
      return fail(502, "An attachment is unavailable.");
    }
    const bytes = await getBytes(
      deps,
      bearer,
      `/api/v1/files/${fileId}/content`
    );
    if (!bytes) {
      return fail(502, "An attachment could not be downloaded.");
    }
    if ((await sha256Hex(bytes)) !== file.data.file.sha256) {
      return fail(502, "An attachment failed its integrity check.");
    }
    total += bytes.length;
    if (total > EMAIL_LIMITS.attachmentBytesTotal) {
      return fail(413, "The attachments exceed 10 MB.");
    }
    out.push({
      bytes,
      contentType: file.data.file.content_type,
      fileName: file.data.file.original_name ?? `${fileId}.pdf`,
    });
  }
  return out;
}

/** `acme-application.eml`. */
export function emlFileName(detail: ApplicationDetail): string {
  const company = asciiFileName(detail.posting.company_name, "job")
    .toLowerCase()
    .replaceAll(" ", "-");
  return `${company}-application.eml`;
}

/**
 * Builds the `.eml` of email draft `emlId` of application `appId` for the
 * signed-in user, or explains why it cannot (404 not theirs, 409 not
 * approved yet, 502 an attachment failed its check).
 */
export async function buildEmlDownload(
  appId: string,
  emlId: string,
  bearer: string,
  deps: EmlDownloadDeps
): Promise<EmlDownloadResult> {
  const answer = await getJson(deps, bearer, `/api/v1/applications/${appId}`);
  if (!answer) {
    return fail(502, "The API could not be reached.");
  }
  if (answer.status === 404) {
    return fail(404, "Not found");
  }
  const detail = ApplicationDetailSchema.safeParse(answer.json);
  if (!detail.success) {
    return fail(502, "Unexpected application data.");
  }
  const email = detail.data.emails.find((entry) => entry.id === emlId);
  if (!email) {
    return fail(404, "Not found");
  }
  if (!DOWNLOADABLE.has(email.status)) {
    return fail(409, "Approve the draft first.");
  }
  const from = await sender(deps, bearer);
  if (!from) {
    return fail(422, "Add your email address to your profile first.");
  }
  const attachments = await attachmentsOf(
    deps,
    bearer,
    email.attachment_file_ids
  );
  if (!Array.isArray(attachments)) {
    return attachments;
  }
  const text = buildEml(
    {
      from,
      to: email.to_address,
      subject: email.subject,
      body: email.body_text,
      date: deps.now(),
      messageId: `${email.id.toLowerCase()}.${hex(deps.random(8))}@${MESSAGE_ID_HOST}`,
      attachments,
    },
    emlBoundary(deps.random(12))
  );
  return {
    ok: true,
    bytes: new TextEncoder().encode(text),
    fileName: emlFileName(detail.data),
  };
}
