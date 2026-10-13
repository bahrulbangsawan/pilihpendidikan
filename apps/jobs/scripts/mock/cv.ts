// Mock api routes for the CV tab, the render page and email drafts (08, 09):
// variants with diffs and files, render tickets (the two calls of PLAN C8),
// multipart uploads with the sha256 / %PDF- checks, file content (a real,
// small PDF), and email drafts → approval → hand-off.

import { createHash, randomBytes } from "node:crypto";
import type { BoardCard } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationRecord,
  ApprovalRecord,
  CvVariantRecord,
  EmailApplicationRecord,
} from "@pilihpendidikan/jobs-contracts/records";
import { DAY, fixtureId, NOW } from "../../src/test/fixtures";
import { sampleTailoredCv } from "../../src/test/fixtures-cv";
import {
  makeApproval,
  makeCvVariant,
  makeEmail,
  makeFileView,
} from "../../src/test/fixtures-rest";
import {
  applicationOf,
  cardByCompany,
  detailExtras,
  fresh,
  state,
} from "./state";
import type { MockRequest, MockRoute, Reply } from "./types";
import { apiError, match, NOT_FOUND, ok, revisionConflict } from "./types";

const HOUR = 3_600_000;
const PDF_SPECIAL_RE = /[\\()]/g;
const NON_PRINTABLE_RE = /[^\x20-\x7e]/g;
const BOUNDARY_RE = /boundary=("?)([^";]+)\1/;
const PART_NAME_RE = /name="([^"]+)"/;
const VARIANT_RE = /^\/api\/v1\/cv-variants\/([^/]+)$/;
const TICKET_RE = /^\/api\/v1\/cv-variants\/([^/]+)\/render-ticket$/;
const DECIDE_RE = /^\/api\/v1\/cv-variants\/([^/]+)\/(approve|reject)$/;
const CREATE_VARIANT_RE = /^\/api\/v1\/applications\/([^/]+)\/cv-variants$/;
const FILE_RE = /^\/api\/v1\/files\/([^/]+)$/;
const FILE_CONTENT_RE = /^\/api\/v1\/files\/([^/]+)\/content$/;
const CREATE_EMAIL_RE = /^\/api\/v1\/applications\/([^/]+)\/emails$/;
const EMAIL_ACTION_RE = /^\/api\/v1\/emails\/([^/]+)\/(approve|handed-off)$/;

/** A one-page A4 PDF with a few lines of Helvetica (valid xref). */
export function minimalPdf(lines: readonly string[]): Uint8Array {
  const pdfText = (text: string) =>
    text
      .replace(PDF_SPECIAL_RE, (char) => `\\${char}`)
      .replace(NON_PRINTABLE_RE, "?");
  const content = [
    "BT",
    "/F1 20 Tf",
    "56 770 Td",
    ...lines.flatMap((line, index) => [
      index === 0 ? "" : "0 -28 Td",
      `(${pdfText(line)}) Tj`,
      index === 0 ? "/F1 12 Tf" : "",
    ]),
    "ET",
  ]
    .filter(Boolean)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface StoredFile {
  bytes: Uint8Array;
  view: ReturnType<typeof makeFileView>;
}

const files = new Map<string, StoredFile>();
const variants = new Map<string, CvVariantRecord>();
const emails = new Map<string, EmailApplicationRecord>();
const emailApprovals = new Map<string, ApprovalRecord>();
const tickets = new Map<
  string,
  { cvvId: string; readUsed: boolean; uploadUsed: boolean; expiresAt: number }
>();

function storeFile(bytes: Uint8Array, name: string, kind = "cv_pdf" as const) {
  const view = fresh(
    makeFileView({
      id: fixtureId("fil"),
      kind,
      size_bytes: bytes.length,
      sha256: sha256(bytes),
      original_name: name,
      created_at: NOW - HOUR,
    })
  );
  files.set(view.id, { bytes, view });
  return view;
}

function seed(): void {
  const traveloka = cardByCompany("Traveloka");
  if (traveloka) {
    const pdf = storeFile(
      minimalPdf([
        "Rina Wulandari",
        "Frontend Engineer - tailored for Traveloka",
        "Experience: Belajar Bersama, Toko Kita",
        "Skills: React, TypeScript, Accessibility, Testing",
      ]),
      "rina-wulandari-t-k3m9q4x1d7.pdf"
    );
    const draft = fresh(
      makeCvVariant({
        application_id: traveloka.id,
        status: "draft",
        file_id: pdf.id,
        created_at: NOW - 2 * HOUR,
        updated_at: NOW - HOUR,
      })
    );
    variants.set(draft.id, draft);
  }
  const gojek = cardByCompany("Gojek");
  if (gojek) {
    const generating = fresh(
      makeCvVariant({
        application_id: gojek.id,
        status: "generating",
        file_id: null,
        tailored_cv_id: "rina-wulandari-t-9q4x1d7k3m",
        created_at: NOW - 5 * 60_000,
        updated_at: NOW - 60_000,
      })
    );
    variants.set(generating.id, generating);
  }
  const acme = cardByCompany("Acme");
  if (acme) {
    const pdf = storeFile(
      minimalPdf(["Rina Wulandari", "Frontend Engineer - tailored for Acme"]),
      "rina-wulandari-t-acme7k2m9q.pdf"
    );
    const approved = fresh(
      makeCvVariant({
        application_id: acme.id,
        status: "approved",
        file_id: pdf.id,
        tailored_cv_id: "rina-wulandari-t-acme7k2m9q",
        approved_at: NOW - DAY,
        created_at: NOW - 2 * DAY,
        updated_at: NOW - DAY,
      })
    );
    variants.set(approved.id, approved);
    const record = applicationOf(acme);
    state.applications.set(acme.id, {
      ...record,
      cv_variant_id: approved.id,
      base_cv_id: "rina-wulandari",
    });
    const email = fresh(
      makeEmail(acme.id, {
        status: "approved",
        attachment_file_ids: [pdf.id],
        approved_at: NOW - 2 * HOUR,
        updated_at: NOW - 2 * HOUR,
      })
    );
    emails.set(email.id, email);
  }
}

seed();

function variantsOf(appId: string): CvVariantRecord[] {
  return [...variants.values()].filter(
    (variant) => variant.application_id === appId
  );
}

function emailsOf(appId: string): EmailApplicationRecord[] {
  return [...emails.values()].filter((email) => email.application_id === appId);
}

detailExtras.push((card: BoardCard, detail) => ({
  ...detail,
  application: state.applications.get(card.id) ?? detail.application,
  cv_variants: [...detail.cv_variants, ...variantsOf(card.id)],
  emails: [...detail.emails, ...emailsOf(card.id)],
  approvals: [
    ...detail.approvals,
    ...[...emailApprovals.values()].filter(
      (approval) => approval.application_id === card.id
    ),
  ],
}));

function variantDetail(variant: CvVariantRecord, withData: boolean) {
  return {
    cv_variant: variant,
    file: variant.file_id ? (files.get(variant.file_id)?.view ?? null) : null,
    ...(withData && variant.tailored_cv_id
      ? { tailored_cv: sampleTailoredCv() }
      : {}),
    edited_after_approval: false,
  };
}

function updateVariant(
  variant: CvVariantRecord,
  changes: Partial<CvVariantRecord>
): CvVariantRecord {
  const next = {
    ...variant,
    ...changes,
    revision: variant.revision + 1,
    updated_at: Date.now(),
  };
  variants.set(next.id, next);
  return next;
}

/** Parts of a multipart/form-data body (enough for the mock). */
function multipartParts(
  request: MockRequest
): Map<string, { headers: string; body: Buffer }> | null {
  const type = request.header("content-type") ?? "";
  const boundary = BOUNDARY_RE.exec(type)?.[2];
  if (!boundary) {
    return null;
  }
  const parts = new Map<string, { headers: string; body: Buffer }>();
  const delimiter = Buffer.from(`--${boundary}`);
  let at = request.raw.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (request.raw.subarray(start, start + 2).toString() === "--") {
      break;
    }
    const next = request.raw.indexOf(delimiter, start);
    if (next === -1) {
      break;
    }
    const chunk = request.raw.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    const headers = chunk.subarray(0, split).toString("utf8");
    const name = PART_NAME_RE.exec(headers)?.[1] ?? "";
    parts.set(name, { headers, body: chunk.subarray(split + 4) });
    at = next;
  }
  return parts;
}

function uploadWithTicket(request: MockRequest, cvvId: string): Reply {
  const parts = multipartParts(request);
  const meta = parts?.get("meta");
  const file = parts?.get("file");
  if (!(meta && file)) {
    return apiError(400, "invalid_request", "Expected meta then file.");
  }
  const parsed = JSON.parse(meta.body.toString("utf8")) as {
    kind: string;
    sha256: string;
    size_bytes: number;
    original_name?: string;
    links: { cv_variant_id?: string };
  };
  const bytes = new Uint8Array(file.body);
  if (parsed.kind !== "cv_pdf" || parsed.links.cv_variant_id !== cvvId) {
    return apiError(401, "invalid_token", "Ticket not valid for this upload.");
  }
  if (sha256(bytes) !== parsed.sha256 || bytes.length !== parsed.size_bytes) {
    return apiError(422, "policy_violation", "sha256 mismatch");
  }
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
    return apiError(422, "policy_violation", "not a PDF");
  }
  const variant = variants.get(cvvId);
  if (!(variant && ["generating", "draft"].includes(variant.status))) {
    return apiError(422, "invalid_state", "Variant does not take a PDF.");
  }
  const view = storeFile(bytes, parsed.original_name ?? "cv.pdf");
  updateVariant(variant, { file_id: view.id, status: "draft" });
  return ok({ file: view }, 201);
}

/** The two calls a render ticket authorizes (PLAN C8). */
export function ticketRoute(request: MockRequest): Reply | null {
  const ticket = tickets.get(request.header("x-render-ticket") ?? "");
  if (!ticket || ticket.expiresAt < Date.now()) {
    return null;
  }
  const read = match(request, "GET", VARIANT_RE);
  if (
    read &&
    read[0] === ticket.cvvId &&
    request.url.searchParams.get("include") === "cv_data" &&
    !ticket.readUsed
  ) {
    ticket.readUsed = true;
    const variant = variants.get(ticket.cvvId);
    return variant ? ok(variantDetail(variant, true)) : NOT_FOUND;
  }
  if (
    request.method === "POST" &&
    request.path === "/api/v1/files" &&
    !ticket.uploadUsed
  ) {
    ticket.uploadUsed = true;
    return uploadWithTicket(request, ticket.cvvId);
  }
  return null;
}

function pdfReply(stored: StoredFile): Reply {
  return {
    status: 200,
    raw: stored.bytes,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(stored.bytes.length),
      "Content-Disposition": `attachment; filename="${stored.view.original_name ?? "cv.pdf"}"`,
      ETag: `"${stored.view.sha256}"`,
    },
  };
}

function emailApprovalFor(email: EmailApplicationRecord): ApprovalRecord {
  return fresh(
    makeApproval(
      {
        type: "email_submit",
        email_application_id: email.id,
        to: email.to_address,
        cc: [],
        subject: email.subject,
        body_text: email.body_text,
        attachments: email.attachment_file_ids.map((id) => ({
          file_id: id,
          sha256: files.get(id)?.view.sha256 ?? "0".repeat(64),
          name: files.get(id)?.view.original_name ?? "cv.pdf",
        })),
        ai_drafted: false,
        recipient_confirmed: true,
      },
      {
        application_id: email.application_id,
        payload_hash: sha256(
          new TextEncoder().encode(
            JSON.stringify([email.to_address, email.subject, email.body_text])
          )
        ),
        created_at: NOW,
        expires_at: NOW + DAY,
      }
    )
  );
}

export const routes: MockRoute[] = [
  (request) => {
    const found = match(request, "GET", VARIANT_RE);
    if (!found) {
      return null;
    }
    const variant = variants.get(found[0] ?? "");
    return variant
      ? ok(
          variantDetail(
            variant,
            request.url.searchParams.get("include") === "cv_data"
          )
        )
      : NOT_FOUND;
  },
  (request) => {
    const found = match(request, "POST", TICKET_RE);
    if (!found) {
      return null;
    }
    const cvvId = found[0] ?? "";
    if (!variants.has(cvvId)) {
      return NOT_FOUND;
    }
    const ticket = randomBytes(32).toString("base64url");
    tickets.set(ticket, {
      cvvId,
      readUsed: false,
      uploadUsed: false,
      expiresAt: Date.now() + 120_000,
    });
    return ok({
      ticket,
      url: `http://localhost:4007/render/cv/${cvvId}?ticket=${ticket}`,
      expires_in: 120,
    });
  },
  (request) => {
    const found = match(request, "POST", DECIDE_RE);
    if (!found) {
      return null;
    }
    const [cvvId = "", action] = found;
    const variant = variants.get(cvvId);
    if (!variant) {
      return NOT_FOUND;
    }
    if (request.body.base_revision !== variant.revision) {
      return revisionConflict(variant);
    }
    if (variant.status !== "draft" || !variant.file_id) {
      return apiError(422, "invalid_state", "Only a rendered draft.");
    }
    if (action === "reject") {
      return ok({ cv_variant: updateVariant(variant, { status: "rejected" }) });
    }
    const approved = updateVariant(variant, {
      status: "approved",
      approved_at: Date.now(),
    });
    const card = [...state.board.columns.flatMap((c) => c.cards)].find(
      (entry) => entry.id === variant.application_id
    );
    let application: ApplicationRecord | null = null;
    if (card) {
      const current = applicationOf(card);
      application = {
        ...current,
        cv_variant_id: approved.id,
        revision: current.revision + 1,
        updated_at: Date.now(),
      };
      state.applications.set(card.id, application);
    }
    return ok({ cv_variant: approved, application });
  },
  (request) => {
    const found = match(request, "POST", CREATE_VARIANT_RE);
    if (!found) {
      return null;
    }
    const variant = makeCvVariant({
      application_id: found[0] ?? null,
      base_cv_id: String(request.body.base_cv_id ?? "rina-wulandari"),
      template: request.body.template as CvVariantRecord["template"],
      status: "generating",
      tailored_cv_id: `rina-wulandari-t-${randomBytes(5).toString("hex")}`,
      file_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    variants.set(variant.id, variant);
    return ok({ cv_variant: variant }, 202);
  },
  (request) => {
    const found = match(request, "GET", FILE_RE);
    if (!found) {
      return null;
    }
    const stored = files.get(found[0] ?? "");
    return stored ? ok({ file: stored.view }) : NOT_FOUND;
  },
  (request) => {
    const found = match(request, "GET", FILE_CONTENT_RE);
    if (!found) {
      return null;
    }
    const stored = files.get(found[0] ?? "");
    return stored ? pdfReply(stored) : NOT_FOUND;
  },
  (request) => {
    const found = match(request, "POST", CREATE_EMAIL_RE);
    if (!found) {
      return null;
    }
    const body = request.body as {
      to: string;
      subject: string;
      body_text: string;
      attachment_file_ids: string[];
      delivery: "local_handoff" | "server_send";
    };
    const email = makeEmail(found[0] ?? "", {
      to_address: body.to,
      subject: body.subject,
      body_text: body.body_text,
      attachment_file_ids: body.attachment_file_ids,
      delivery: body.delivery,
      status: "draft",
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    emails.set(email.id, email);
    const approval = emailApprovalFor(email);
    emailApprovals.set(approval.id, approval);
    return ok({ email }, 201);
  },
  (request) => {
    const found = match(request, "POST", EMAIL_ACTION_RE);
    if (!found) {
      return null;
    }
    const [emlId = "", action] = found;
    const email = emails.get(emlId);
    if (!email) {
      return NOT_FOUND;
    }
    const card = state.board.columns
      .flatMap((column) => column.cards)
      .find((entry) => entry.id === email.application_id);
    if (!card) {
      return NOT_FOUND;
    }
    const current = applicationOf(card);
    if (action === "approve") {
      const approval = [...emailApprovals.values()].find(
        (entry) =>
          entry.payload.type === "email_submit" &&
          entry.payload.email_application_id === emlId &&
          entry.state === "pending"
      );
      if (!approval || approval.payload_hash !== request.body.payload_hash) {
        return apiError(409, "payload_mismatch", "The draft changed.");
      }
      const decided = {
        ...approval,
        state: "approved" as const,
        decided_at: Date.now(),
        decided_via: "web" as const,
      };
      emailApprovals.set(approval.id, decided);
      const next = {
        ...email,
        status: "approved" as const,
        approved_at: Date.now(),
        revision: email.revision + 1,
        updated_at: Date.now(),
      };
      emails.set(emlId, next);
      const application = {
        ...current,
        submission_status: "in_progress" as const,
        revision: current.revision + 1,
        updated_at: Date.now(),
      };
      state.applications.set(card.id, application);
      return ok({
        email: next,
        approval: decided,
        application,
        evidence: null,
      });
    }
    const sent = request.body.sent_confirmed === true;
    const next = sent
      ? {
          ...email,
          status: "handed_off" as const,
          sent_at: Number(request.body.sent_at ?? Date.now()),
          revision: email.revision + 1,
          updated_at: Date.now(),
        }
      : email;
    emails.set(emlId, next);
    const application = {
      ...current,
      submission_status: sent
        ? ("submitted_unverified" as const)
        : ("failed" as const),
      stage: sent ? ("applied" as const) : current.stage,
      submitted_at: sent ? Date.now() : current.submitted_at,
      submission_method: sent ? ("email" as const) : current.submission_method,
      revision: current.revision + 1,
      updated_at: Date.now(),
    };
    state.applications.set(card.id, application);
    return ok({ email: next, application, evidence: null });
  },
];
