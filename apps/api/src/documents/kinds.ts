// The three document families the builder apps save (cv, invoice,
// portfolio) differ only in namespace, list metadata, payload check and
// download name. This table drives the shared REST handlers in ./handlers.ts.

import { CV_VISIBILITIES } from "@pilihpendidikan/cv-engine";
import type { Env } from "../env";
import type {
  CVMetadata,
  InvoiceMetadata,
  PortfolioMetadata,
} from "../helpers";
import { putCV, putInvoice, putPortfolio } from "../helpers";
import type { OwnedKind } from "../ownership";
import type { CVData, InvoiceData, PortfolioData } from "../types";

export type DocumentKind = "cv" | "invoice" | "portfolio";

const WHITESPACE_RE = /\s+/g;
const UNSAFE_FILENAME_RE = /[^\w\-.]/g;

export interface DocumentSpec {
  kind: DocumentKind & OwnedKind;
  label: string;
  prefix: string;
  namespace: (env: Env) => KVNamespace;
  // List row fields read from KV metadata.
  listRow: (metadata: Record<string, string> | undefined) => object;
  // Returns the normalized document, or null when the payload is malformed.
  validate: (body: unknown) => unknown | null;
  save: (kv: KVNamespace, id: string, data: unknown) => Promise<void>;
  downloadName: (data: unknown, id: string) => string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeFilename(name: string): string {
  return (
    name.replace(WHITESPACE_RE, "-").replace(UNSAFE_FILENAME_RE, "") || "file"
  );
}

const cvSpec: DocumentSpec = {
  kind: "cv",
  label: "CV",
  prefix: "cv:",
  namespace: (env) => env.CV_KV,
  listRow: (m) => ({
    fullName: (m as Partial<CVMetadata> | undefined)?.fullName ?? "",
    jobTitle: (m as Partial<CVMetadata> | undefined)?.jobTitle ?? "",
  }),
  // `visibility` (D-25) is optional; when present it must be a known value.
  validate: (body) =>
    isObject(body) &&
    isObject(body.personalInfo) &&
    Array.isArray(body.sectionOrder) &&
    (body.visibility === undefined ||
      (CV_VISIBILITIES as readonly unknown[]).includes(body.visibility))
      ? body
      : null,
  save: (kv, id, data) => putCV(kv, id, data as CVData),
  downloadName: (data, id) =>
    `CV-${safeFilename((data as CVData).personalInfo?.fullName || id)}`,
};

const invoiceSpec: DocumentSpec = {
  kind: "invoice",
  label: "Invoice",
  prefix: "invoice:",
  namespace: (env) => env.INVOICE_KV,
  listRow: (m) => ({
    invoiceNumber:
      (m as Partial<InvoiceMetadata> | undefined)?.invoiceNumber ?? "",
    client: (m as Partial<InvoiceMetadata> | undefined)?.client ?? "",
  }),
  validate: (body) => {
    if (!(isObject(body) && isObject(body.from) && Array.isArray(body.items))) {
      return null;
    }
    // Dates are ISO strings; a null / non-string date is stored as "".
    body.dateDue = typeof body.dateDue === "string" ? body.dateDue : "";
    body.dateOfIssue =
      typeof body.dateOfIssue === "string" ? body.dateOfIssue : "";
    return isObject(body.billTo) ? body : null;
  },
  save: (kv, id, data) => putInvoice(kv, id, data as InvoiceData),
  downloadName: (data, id) =>
    `Invoice-${safeFilename((data as InvoiceData).invoiceNumber || id)}`,
};

const portfolioSpec: DocumentSpec = {
  kind: "portfolio",
  label: "Portfolio",
  prefix: "portfolio:",
  namespace: (env) => env.PORTFOLIO_KV,
  listRow: (m) => ({
    fullName: (m as Partial<PortfolioMetadata> | undefined)?.fullName ?? "",
    headline: (m as Partial<PortfolioMetadata> | undefined)?.headline ?? "",
  }),
  validate: (body) =>
    isObject(body) && isObject(body.owner) && Array.isArray(body.projects)
      ? body
      : null,
  save: (kv, id, data) => putPortfolio(kv, id, data as PortfolioData),
  downloadName: (data, id) =>
    `Portfolio-${safeFilename((data as PortfolioData).owner?.fullName || id)}`,
};

export const DOCUMENT_SPECS: Readonly<Record<DocumentKind, DocumentSpec>> = {
  cv: cvSpec,
  invoice: invoiceSpec,
  portfolio: portfolioSpec,
};
