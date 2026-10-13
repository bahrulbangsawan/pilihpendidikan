// Helpers of the account area (05 §10a, 11 §10).

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { JobsAiMessage } from "@pilihpendidikan/jobs-contracts/queue";
import { parseQueueMessage } from "@pilihpendidikan/jobs-contracts/queue";
import type { ResolvedCaller } from "../../../auth";
import { normalizeEmail } from "../../../auth";
import type { Env } from "../../../env";
import { idsOwnedBy, listAllKeys, namespaceFor } from "../../../ownership";
import { apiError } from "../../core/http";
import type { UserScope } from "../../core/scope";
import type { JobsDb } from "../../repo/core/db";
import { getUserSettings } from "../../repo/core/settings";

const DEFAULT_JOBS_APP_ORIGIN = "https://jobs.pilihpendidikan.com";
const TRAILING_SLASH_RE = /\/+$/;

/**
 * Account export and deletion are for a signed-in person in the web app
 * (05 §10a "browser session only"): CLI, MCP and personal tokens are refused
 * even when they carry `jobs:write`.
 */
export function requireBrowserSession(caller: ResolvedCaller): void {
  if (caller.credentialKind !== "browser_session") {
    throw apiError(
      "insufficient_scope",
      "Account export and deletion are only available from a signed-in browser session (the Job Tracker web app).",
      {
        scope: "jobs:write",
        details: { required_credential: "browser_session" },
      }
    );
  }
}

/** The dashboard origin (emailed links), without a trailing slash. */
export function jobsAppOrigin(env: Pick<Env, "JOBS_APP_ORIGIN">): string {
  return (env.JOBS_APP_ORIGIN || DEFAULT_JOBS_APP_ORIGIN).replace(
    TRAILING_SLASH_RE,
    ""
  );
}

/** The user's locale for emails (settings, lazily created). */
export async function userLocale(
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<Locale> {
  try {
    return (await getUserSettings(db, scope, now)).locale;
  } catch {
    return "en";
  }
}

/**
 * Ids of the documents of one kind (`cv` → CV_KV `cv:{id}`, `jobs` → the
 * legacy JOBS_KV `job:{id}`) stamped to `email`, sorted.
 */
export async function ownedDocumentIds(
  env: Env,
  kind: "cv" | "jobs",
  email: string
): Promise<string[]> {
  const prefix = kind === "cv" ? "cv:" : "job:";
  const keys = await listAllKeys(namespaceFor(env, kind), prefix);
  const ids = keys.map((key) => key.name.slice(prefix.length));
  const owned = await idsOwnedBy(env, kind, normalizeEmail(email), ids);
  return ids.filter((id) => owned.has(id)).sort();
}

/** Sends one validated `jobs-ai` message. */
export async function sendJobsMessage(
  env: Pick<Env, "JOBS_AI_QUEUE">,
  message: JobsAiMessage
): Promise<void> {
  await env.JOBS_AI_QUEUE.send(parseQueueMessage(message));
}
