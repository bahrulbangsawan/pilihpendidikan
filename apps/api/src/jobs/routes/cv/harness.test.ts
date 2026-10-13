// Shared set-up of the CV and files route tests. No tests of its own: it is a
// `.test.ts` so the Worker build and tsconfig.json never see it.
// It wires a real test env (both D1s, KV, R2, queue) with a scripted AI
// provider and helpers for the 08 flow: base CV, application, tailoring,
// render tickets and PDF uploads.

import type { Database } from "bun:sqlite";
import { CV_TAILORING_PATCH_JSON_SCHEMA } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import type { CvVariantRecord } from "@pilihpendidikan/jobs-contracts/records";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import type {
  FakeClock,
  TestEnv,
  V1Client,
  V1Response,
  V1Session,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedPosting,
  seedUserJob,
} from "../../../../test/seed-jobs";
import { createCvDocument } from "../../../documents/cv-create";
import type { AiProvider } from "../../ai/provider";
import type {
  StructuredRequest,
  StructuredResponse,
} from "../../ai/primitives";
import { AiProviderError, usageOf } from "../../ai/primitives";
import {
  BAIT_POSTING,
  BASE_CV_ID,
  pdfBytes,
  sampleCv,
  sha256Of,
} from "../../services/cv/tailoring/fixtures";

export const EMAIL = "rahma@example.com";
export const OTHER_EMAIL = "budi@example.com";

/** One scripted structured output: a patch, a refusal or a thrown error. */
export type Scripted =
  | { patch: unknown }
  | { refusal: string }
  | { error: "rate_limited" | "bad_request" | "invalid_output" };

export interface ScriptedAi {
  /** Inputs of every structured call, in order. */
  inputs: string[];
  provider: AiProvider;
  queue: Scripted[];
}

/** A provider whose `structured` answers from `queue` (then the fake's own). */
export function scriptedAi(queue: Scripted[] = []): ScriptedAi {
  const state: ScriptedAi = {
    inputs: [],
    queue,
    provider: null as unknown as AiProvider,
  };
  state.provider = {
    id: "fake",
    structured<T>(
      request: StructuredRequest<T>
    ): Promise<StructuredResponse<T>> {
      state.inputs.push(request.input);
      const model = request.model ?? "gpt-6.1-sol";
      const usage = usageOf(model, 1500, 600);
      const next = state.queue.shift();
      if (next && "error" in next) {
        return Promise.reject(
          new AiProviderError(next.error, `scripted ${next.error}`)
        );
      }
      if (next && "refusal" in next) {
        return Promise.resolve({
          model,
          output: null,
          refusal: next.refusal,
          usage,
        });
      }
      const candidate = next ? next.patch : request.fake?.();
      const parsed = request.validator.safeParse(candidate);
      if (!parsed.success) {
        return Promise.reject(new AiProviderError("invalid_output", "schema"));
      }
      return Promise.resolve({
        model,
        output: parsed.data,
        refusal: null,
        usage,
      });
    },
  } as unknown as AiProvider;
  return state;
}

export interface Harness {
  ai: ScriptedAi;
  app: { id: string; posting_id: string; user_job_id: string };
  client: V1Client;
  clock: FakeClock;
  drain(): Promise<void>;
  t: TestEnv;
  userId: string;
  web: V1Session;
}

export function grantAiConsent(
  sqlite: Database,
  userId: string,
  now: number
): void {
  sqlite
    .query(
      "INSERT INTO user_settings (user_id, ai_consent_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET ai_consent_at = excluded.ai_consent_at"
    )
    .run(userId, now, now);
}

/** A test env with Rahma's base CV, AI consent and a saved application. */
export async function harness(
  options: {
    appOverrides?: Record<string, string | number | null>;
    consent?: boolean;
    script?: Scripted[];
  } = {}
): Promise<Harness> {
  const t = createTestEnv();
  const clock = createFakeClock();
  const ai = scriptedAi(options.script ?? []);
  const client = createV1Client(t, { clock, ai: () => ai.provider });
  const web = await client.browserSession(EMAIL);
  const userId = web.userId as string;
  await createCvDocument(t.env, { email: EMAIL }, BASE_CV_ID, sampleCv());
  if (options.consent !== false) {
    grantAiConsent(t.jobsSqlite, userId, clock.now());
  }
  const posting = seedPosting(t.jobsSqlite, {
    title: BAIT_POSTING.title,
    company_name: BAIT_POSTING.company_name,
    seniority: BAIT_POSTING.seniority,
    description_text: BAIT_POSTING.description_text,
    requirements: JSON.stringify(BAIT_POSTING.requirements),
  });
  const userJob = seedUserJob(t.jobsSqlite, userId, { posting_id: posting.id });
  const app = seedApplication(t.jobsSqlite, userId, {
    user_job_id: userJob.id,
    stage: "saved",
    mode: "approval",
    ...options.appOverrides,
  });
  return {
    t,
    clock,
    ai,
    client,
    web,
    userId,
    app: { ...app, posting_id: posting.id },
    drain: async () => {
      await t.queue.drain(t.env, { deps: { clock, ai: () => ai.provider } });
    },
  };
}

export function variantRow(sqlite: Database, id: string): CvVariantRecord {
  const row = sqlite
    .query("SELECT * FROM cv_variants WHERE id = ?")
    .get(id) as Record<string, unknown>;
  return {
    ...row,
    diff: JSON.parse(row.diff as string),
  } as unknown as CvVariantRecord;
}

/** POST …/cv-variants and run the consumer; returns the variant id. */
export async function createVariant(
  h: Harness,
  body: { base_cv_id?: string; template?: string; tailor?: boolean } = {},
  session: V1Session = h.web
): Promise<string> {
  const res = await session.post<{ cv_variant: CvVariantRecord }>(
    `/api/v1/applications/${h.app.id}/cv-variants`,
    { base_cv_id: BASE_CV_ID, template: "harvard", tailor: true, ...body }
  );
  if (res.status !== 202) {
    throw new Error(`create variant: ${res.status} ${res.text}`);
  }
  await h.drain();
  return res.body.cv_variant.id;
}

/** A multipart body with a fixed boundary (deterministic for idempotency). */
export function multipartBody(
  meta: unknown,
  bytes: Uint8Array,
  options: { boundary?: string; filename?: string; metaFirst?: boolean } = {}
): { body: Uint8Array; contentType: string } {
  const boundary = options.boundary ?? "pilihBoundary7MA4YWxkTrZu0gW";
  const enc = new TextEncoder();
  const metaPart = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n`
  );
  const fileHead = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? "cv.pdf"}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const parts =
    options.metaFirst === false
      ? [fileHead, bytes, enc.encode("\r\n"), metaPart, tail.slice(2)]
      : [metaPart, fileHead, bytes, tail];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** A ReadableStream delivering `bytes` in chunks of `size` (streaming tests). */
export function chunked(
  bytes: Uint8Array,
  size: number
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

export interface UploadOptions {
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
}

/** POST /api/v1/files with a cv_pdf (or `meta` overrides). */
export async function uploadFile(
  session: V1Session,
  options: UploadOptions = {}
): Promise<V1Response<{ file: Record<string, unknown> }>> {
  const bytes = options.bytes ?? pdfBytes();
  const meta = {
    kind: "cv_pdf",
    sha256: await sha256Of(bytes),
    content_type: "application/pdf",
    size_bytes: bytes.length,
    links: {},
    ...options.meta,
  };
  const { body, contentType } = multipartBody(meta, bytes);
  return await session.call("POST", "/api/v1/files", {
    rawBody: body,
    headers: { "Content-Type": contentType, ...options.headers },
    idempotencyKey: options.idempotencyKey,
  });
}

/** Uploads a rendered PDF for a variant (web bearer). */
export async function renderVariant(
  h: Harness,
  cvvId: string,
  bytes: Uint8Array = pdfBytes(),
  session: V1Session = h.web
): Promise<V1Response<{ file: Record<string, unknown> }>> {
  return await uploadFile(session, {
    bytes,
    meta: { links: { cv_variant_id: cvvId } },
  });
}

export const PATCH_SCHEMA_NAME = CV_TAILORING_PATCH_JSON_SCHEMA.name;
