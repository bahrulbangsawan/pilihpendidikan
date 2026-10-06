// KV document accessors and MCP response helpers shared by the tools and the
// REST handlers. Each document lives at `<prefix>:{id}` with list metadata so
// listings never have to fetch every blob.

import { API_ORIGIN, APP_ORIGINS } from "./origins";
import type { CVData, InvoiceData, JobData, PortfolioData } from "./types";
import { normalizeJobData } from "./types";

export interface CVMetadata {
  fullName: string;
  jobTitle: string;
}

export interface InvoiceMetadata {
  invoiceNumber: string;
  client: string;
}

export interface PortfolioMetadata {
  fullName: string;
  headline: string;
}

// `owner` is a display hint only ("" on MCP writes); ownership is always read
// from the `owner:job:{id}` stamp.
export interface JobMetadata {
  title: string;
  status: string;
  updatedAt: string;
  interviewDate: string;
  company: string;
  owner: string;
}

const BULLET_RE = /^\s*[-•*]\s+/;
const LINKEDIN_HTTPS_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\//;
const LINKEDIN_WWW_RE = /^(www\.)?linkedin\.com\/in\//;
const TRAILING_SLASH_RE = /\/+$/;

export function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

export function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

export function cvEditUrl(cvId: string): string {
  return `${APP_ORIGINS.cv}/?id=${encodeURIComponent(cvId)}`;
}

export function pdfUrl(
  kind: "cv" | "invoice" | "portfolio",
  id: string
): string {
  return `${API_ORIGIN}/${kind}/${encodeURIComponent(id)}.pdf`;
}

export function saved(msg: string, cvId: string) {
  return text(
    `${msg}\n\nView CV: ${APP_ORIGINS.cv}/?cv=${encodeURIComponent(cvId)}\nDownload JSON: ${API_ORIGIN}/api/cv/${encodeURIComponent(cvId)}?download`
  );
}

export function getCV(kv: KVNamespace, cvId: string): Promise<CVData | null> {
  return kv.get<CVData>(`cv:${cvId}`, "json");
}

export async function putCV(kv: KVNamespace, cvId: string, data: CVData) {
  const metadata: CVMetadata = {
    fullName: data.personalInfo.fullName || "",
    jobTitle: data.personalInfo.jobTitle || "",
  };
  await kv.put(`cv:${cvId}`, JSON.stringify(data), { metadata });
}

export function getInvoice(
  kv: KVNamespace,
  invoiceId: string
): Promise<InvoiceData | null> {
  return kv.get<InvoiceData>(`invoice:${invoiceId}`, "json");
}

export async function putInvoice(
  kv: KVNamespace,
  invoiceId: string,
  data: InvoiceData
) {
  const metadata: InvoiceMetadata = {
    invoiceNumber: data.invoiceNumber,
    client: data.billTo.name,
  };
  await kv.put(`invoice:${invoiceId}`, JSON.stringify(data), { metadata });
}

export function getPortfolio(
  kv: KVNamespace,
  portfolioId: string
): Promise<PortfolioData | null> {
  return kv.get<PortfolioData>(`portfolio:${portfolioId}`, "json");
}

// Every persist bumps updatedAt; the builder shows it as "saved".
export async function putPortfolio(
  kv: KVNamespace,
  portfolioId: string,
  data: PortfolioData
) {
  data.updatedAt = new Date().toISOString();
  const metadata: PortfolioMetadata = {
    fullName: data.owner.fullName || "",
    headline: data.owner.headline || "",
  };
  await kv.put(`portfolio:${portfolioId}`, JSON.stringify(data), { metadata });
}

// Blobs written before newer fields shipped are backfilled on read.
export async function getJob(
  kv: KVNamespace,
  jobId: string
): Promise<JobData | null> {
  const raw = await kv.get<Partial<JobData>>(`job:${jobId}`, "json");
  return raw ? normalizeJobData(raw) : null;
}

export async function putJob(
  kv: KVNamespace,
  jobId: string,
  data: JobData,
  owner = ""
) {
  data.updatedAt = new Date().toISOString();
  const metadata: JobMetadata = {
    title: data.title,
    status: data.status,
    updatedAt: data.updatedAt,
    interviewDate: data.interviewDate ?? "",
    company: data.company ?? "",
    owner,
  };
  await kv.put(`job:${jobId}`, JSON.stringify(data), { metadata });
}

export function stripBulletMarkers(input: string): string {
  return input
    .split("\n")
    .map((line) => line.replace(BULLET_RE, ""))
    .join("\n");
}

export function normalizeLinkedIn(value: string): string {
  return value
    .replace(LINKEDIN_HTTPS_RE, "")
    .replace(LINKEDIN_WWW_RE, "")
    .replace(TRAILING_SLASH_RE, "");
}
