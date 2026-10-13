// An agent world for the AI proxy tests: a CLI device with a live lease on an
// apply task, AI consent, facts and answers, and observation builders.
import { newId } from "@pilihpendidikan/jobs-contracts/ids";
import type {
  ObservedControl,
  ObservedField,
  PageObservation,
} from "@pilihpendidikan/jobs-contracts/agent";
import type { Env } from "../../../env";
import type { FakeAiOptions } from "../../ai/fake";
import type { DecisionRequest, StructuredRequest } from "../../ai/primitives";
import type { AiProvider } from "../../ai/provider";
import { getAiProvider } from "../../ai/provider";
import type {
  FakeClock,
  TestEnv,
  V1Client,
  V1Session,
} from "../../../../test/fakes";
import {
  createFakeClock,
  createTestEnv,
  createV1Client,
} from "../../../../test/fakes";
import {
  seedApplication,
  seedAttempt,
  seedTask,
} from "../../../../test/seed-jobs";
import { forgetObservations } from "../../services/ai-proxy/observations";
import { insertFact, setConsent } from "../scoring/fixtures.test";

export const EMAIL = "agent-user@example.com";

export interface AgentWorld {
  cli: V1Session;
  client: V1Client;
  clock: FakeClock;
  decides: DecisionRequest[];
  leaseRef: { lease_id: string; task_id: string };
  structureds: StructuredRequest<unknown>[];
  t: TestEnv;
  userId: string;
}

export interface AgentWorldOptions {
  ai?: (env: Env) => AiProvider;
  consent?: boolean;
  fake?: FakeAiOptions;
  mode?: "assisted" | "approval" | "auto";
  settings?: Record<string, number | string>;
}

export async function agentWorld(
  options: AgentWorldOptions = {}
): Promise<AgentWorld> {
  forgetObservations();
  const t = createTestEnv();
  const clock = createFakeClock();
  const decides: DecisionRequest[] = [];
  const structureds: StructuredRequest<unknown>[] = [];
  const ai =
    options.ai ??
    ((env: Env) =>
      getAiProvider(env, {
        fake: {
          ...options.fake,
          onDecide: (request) => {
            decides.push(request);
          },
          onStructured: (request) => {
            structureds.push(request);
          },
        },
      }));
  const client = createV1Client(t, { clock, ai });
  const cli = await client.cliSession(EMAIL);
  const userId = cli.userId as string;
  const now = clock.now();
  if (options.consent !== false) {
    setConsent(t, userId, now, options.settings ?? {});
  }
  const app = seedApplication(t.jobsSqlite, userId, { stage: "ready" });
  const leaseId = newId("lse", now);
  const task = seedTask(t.jobsSqlite, userId, {
    application_id: app.id,
    state: "running",
    lease_id: leaseId,
    lease_device_id: cli.deviceId,
    lease_expires_at: now + 120_000,
    attempt_count: 1,
    payload: JSON.stringify({ mode: options.mode ?? "approval" }),
  });
  seedAttempt(t.jobsSqlite, userId, {
    task_id: task.id,
    lease_id: leaseId,
    device_id: cli.deviceId as string,
  });
  return {
    t,
    clock,
    client,
    cli,
    userId,
    decides,
    structureds,
    leaseRef: { task_id: task.id, lease_id: leaseId },
  };
}

let refs = 0;

export function field(overrides: Partial<ObservedField> = {}): ObservedField {
  refs += 1;
  return {
    ref: `f${refs}`,
    signature: `sig${String(refs).padStart(13, "0")}`,
    kind: "text",
    label: "Field",
    label_sources: ["label"],
    description: "",
    required: false,
    options: [],
    options_dynamic: false,
    accept: null,
    multiple: false,
    has_value: false,
    user_touched: false,
    invalid: false,
    validation_message: null,
    section: null,
    ...overrides,
  };
}

export function control(
  overrides: Partial<ObservedControl> = {}
): ObservedControl {
  refs += 1;
  return {
    ref: `c${refs}`,
    kind: "button",
    text: "Continue",
    role_hint: "next",
    enabled: true,
    in_viewport: true,
    ...overrides,
  };
}

export function option(label: string, value = label) {
  return { label, value, selected: false, disabled: false };
}

export function observation(
  overrides: Partial<PageObservation> = {}
): PageObservation {
  refs += 1;
  return {
    observation_id: newId("obs"),
    attempt_id: newId("att"),
    step: 1,
    url: "https://boards.greenhouse.io/acme/jobs/123",
    origin: "https://boards.greenhouse.io",
    registrable_domain: "greenhouse.io",
    allowlisted: true,
    title: "Apply for Backend Engineer",
    http_status: 200,
    aria_snapshot: "main\n  form",
    visible_text_excerpt: "Apply for this job",
    fields: [],
    controls: [],
    errors: [],
    opaque_regions: [],
    challenge: { detected: false, kind: null },
    form_hash: "a".repeat(64),
    screenshot_jpeg_b64: null,
    ...overrides,
  };
}

/** A tiny but valid-looking base64 JPEG (starts with FF D8 FF). */
export const JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP////8=";

export function insertAnswer(
  world: Pick<AgentWorld, "t" | "userId" | "clock">,
  answer: {
    answer: string;
    answer_kind?: string;
    auto_use?: string;
    patterns?: string[];
    question_key: string;
    sensitivity?: string;
  }
): string {
  const now = world.clock.now();
  const id = newId("ans", now);
  world.t.jobsSqlite
    .query(
      "INSERT INTO screening_answers (id, user_id, question_key, match_patterns, answer, answer_kind, sensitivity, auto_use, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      world.userId,
      answer.question_key,
      JSON.stringify(answer.patterns ?? []),
      answer.answer,
      answer.answer_kind ?? "text",
      answer.sensitivity ?? "none",
      answer.auto_use ?? "always",
      now,
      now
    );
  return id;
}

export function factOf(
  world: Pick<AgentWorld, "t" | "userId" | "clock">,
  key: string,
  value: unknown
): void {
  insertFact(world.t, world.userId, key, value, world.clock.now());
}

/** Text of every Decisions request (input + questions). */
export function decisionText(request: DecisionRequest): string {
  const input =
    typeof request.input === "string"
      ? request.input
      : request.input
          .flatMap((m) => m.content)
          .map((part) =>
            part.type === "input_text"
              ? part.text
              : `[image ${part.image_url.slice(0, 30)}]`
          )
          .join("\n");
  return `${input}\n${JSON.stringify(request.questions)}`;
}

export function usageOf(world: Pick<AgentWorld, "t" | "userId">) {
  return world.t.jobsSqlite
    .query(
      "SELECT purpose, calls, input_tokens, output_tokens, cost_micro_usd FROM ai_usage WHERE user_id = ?"
    )
    .all(world.userId);
}

export function attemptCalls(
  world: Pick<AgentWorld, "t" | "leaseRef">
): number {
  return (
    world.t.jobsSqlite
      .query("SELECT ai_calls FROM automation_attempts WHERE lease_id = ?")
      .get(world.leaseRef.lease_id) as { ai_calls: number }
  ).ai_calls;
}
