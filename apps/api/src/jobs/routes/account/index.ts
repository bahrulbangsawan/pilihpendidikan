// Owner: leaf-2.8 — 05 §10a settings, account export/delete, telemetry.
//
//   GET   /api/v1/settings                      lazy row (04 §2.7), ETag
//   PATCH /api/v1/settings                      base_revision; effects below
//   POST  /api/v1/account/export                browser session only → 202
//   GET   /api/v1/account/exports/{export_id}   browser session only: the zip
//                                               (24 h; the emailed link goes
//                                               through the dashboard BFF)
//   POST  /api/v1/account/delete                browser session only → email
//   GET   /api/v1/account/delete/confirm        public confirm page (no write)
//   POST  /api/v1/account/delete/confirm        public, token → deletion
//   POST  /api/v1/telemetry                     anonymous, per-IP limited
//   POST  /api/v1/telemetry/crash               anonymous, per-IP limited
//
// Settings effects after the commit: `automation_paused` needs nothing more
// (heartbeats read it and answer `cancel_requested`, new apply claims stop);
// a timezone change sends `rebuild_analytics` (10 §5); an
// `ai_scoring_sensitive` change re-queues scoring (07 §2.1, §8).

import type { RateLimitRule } from "../../../rate-limit";
import { DAY_MS, HOUR_MS } from "../../core/clock";
import type { RouteDef } from "../../core/router";
import { notFound } from "../../core/http";
import { defineRoute, fromContract } from "../../core/router";
import { getUserSettings } from "../../repo/core/settings";
import {
  confirmAccountDeletion,
  confirmationResultPage,
  deletionConfirmPage,
  requestAccountDeletion,
} from "../../services/account/delete";
import {
  openAccountExport,
  requestAccountExport,
} from "../../services/account/export";
import { planPatchSettings } from "../../services/account/settings";
import {
  requireBrowserSession,
  userLocale,
} from "../../services/account/shared";
import {
  acceptTelemetry,
  storeCrashReport,
} from "../../services/account/telemetry";
import {
  scheduleProfileRescore,
  sendRebuildAnalytics,
} from "../../services/profile/shared";

/** Exports per user per day (each one zips the whole account). */
export const ACCOUNT_EXPORT_USER: RateLimitRule = {
  purpose: "account-export",
  max: 5,
  windowMs: DAY_MS,
};
/** Deletion confirmation emails per user per hour. */
export const ACCOUNT_DELETE_USER: RateLimitRule = {
  purpose: "account-delete",
  max: 5,
  windowMs: HOUR_MS,
};
/** Confirmation attempts per IP per hour (token guessing damper). */
export const ACCOUNT_DELETE_CONFIRM_IP: RateLimitRule = {
  purpose: "account-delete-confirm",
  max: 30,
  windowMs: HOUR_MS,
};
/** Telemetry uploads per IP per hour (22 §8.1: rate-limited by IP hash). */
export const TELEMETRY_IP: RateLimitRule = {
  purpose: "telemetry",
  max: 120,
  windowMs: HOUR_MS,
};
/** Crash reports per IP per hour. */
export const TELEMETRY_CRASH_IP: RateLimitRule = {
  purpose: "telemetry-crash",
  max: 20,
  windowMs: HOUR_MS,
};

/** Telemetry and crash bodies are small (22 §8). */
const TELEMETRY_BODY_LIMIT = 64 * 1024;
const CONFIRM_BODY_LIMIT = 4 * 1024;
const JSON_TYPE_RE = /^application\/json\b/i;

/** The token of a confirmation POST (HTML form or JSON body). */
async function confirmationToken(request: Request): Promise<string | null> {
  const text = await request.text();
  if (text.length > CONFIRM_BODY_LIMIT) {
    return null;
  }
  if (JSON_TYPE_RE.test(request.headers.get("content-type") ?? "")) {
    try {
      const parsed = JSON.parse(text) as { token?: unknown };
      return typeof parsed.token === "string" ? parsed.token : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text).get("token");
}

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/settings"),
    async handler(c) {
      const settings = await getUserSettings(c.db, c.scope, c.now);
      return await c.respondWithEtag({ settings });
    },
  }),

  defineRoute({
    ...fromContract("PATCH /api/v1/settings"),
    async handler(c) {
      const plan = await planPatchSettings(c.db, c.scope, {
        baseRevision: c.baseRevision(c.body.base_revision),
        body: c.body,
        flags: c.flags,
        now: c.now,
      });
      if (!plan.changed) {
        return c.respond({ settings: plan.settings });
      }
      const response = await c.commit(plan.statements, {
        body: { settings: plan.settings },
      });
      if (plan.timezoneChanged) {
        await sendRebuildAnalytics(c.env, c.scope, c.requestId);
      }
      if (plan.sensitiveChanged) {
        scheduleProfileRescore(c, { email: c.caller.email });
      }
      return response;
    },
  }),

  defineRoute({
    ...fromContract("POST /api/v1/account/export"),
    rateLimit: [{ rule: ACCOUNT_EXPORT_USER, subject: "user" }],
    async handler(c) {
      requireBrowserSession(c.caller);
      const started = await requestAccountExport(c.env, c.scope, c.now);
      return c.respond(started, 202);
    },
  }),

  defineRoute({
    ...fromContract("GET /api/v1/account/exports/{export_id}"),
    async handler(c) {
      requireBrowserSession(c.caller);
      const { object, record } = await openAccountExport(
        c.env,
        c.scope,
        c.params.export_id,
        c.now
      );
      const day = new Date(record.requested_at).toISOString().slice(0, 10);
      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="pilihpendidikan-export-${day}.zip"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  }),

  defineRoute({
    ...fromContract("POST /api/v1/account/delete"),
    rateLimit: [{ rule: ACCOUNT_DELETE_USER, subject: "user" }],
    async handler(c) {
      requireBrowserSession(c.caller);
      const sent = await requestAccountDeletion(c.env, c.request, {
        alsoDeleteCvs: c.body.also_delete_cvs === true,
        caller: c.caller,
        locale: await userLocale(c.db, c.scope, c.now),
        now: c.now,
        scope: c.scope,
      });
      return c.respond(sent, 202);
    },
  }),

  defineRoute({
    ...fromContract("GET /api/v1/account/delete/confirm"),
    handler: (c) => deletionConfirmPage(c.env, c.url),
  }),

  defineRoute({
    ...fromContract("POST /api/v1/account/delete/confirm"),
    // JSON `{token}` or an HTML form post: read the body in the handler.
    body: "raw",
    rateLimit: [{ rule: ACCOUNT_DELETE_CONFIRM_IP, subject: "ip" }],
    async handler(c) {
      const token = await confirmationToken(c.request);
      const outcome = await confirmAccountDeletion(c.env, token, c.now);
      const wantsJson = JSON_TYPE_RE.test(
        c.request.headers.get("content-type") ?? ""
      );
      if (!wantsJson) {
        return confirmationResultPage(outcome);
      }
      if (outcome.kind === "invalid") {
        throw notFound("This confirmation link expired or was already used.");
      }
      return c.respond({ status: "deleting" }, 202);
    },
  }),

  defineRoute({
    ...fromContract("POST /api/v1/telemetry"),
    maxBodyBytes: TELEMETRY_BODY_LIMIT,
    rateLimit: [{ rule: TELEMETRY_IP, subject: "ip" }],
    async handler(c) {
      await acceptTelemetry(c.db, c.body, c.now);
      return c.respond({ accepted: true }, 202);
    },
  }),

  defineRoute({
    ...fromContract("POST /api/v1/telemetry/crash"),
    maxBodyBytes: TELEMETRY_BODY_LIMIT,
    rateLimit: [{ rule: TELEMETRY_CRASH_IP, subject: "ip" }],
    async handler(c) {
      await storeCrashReport(c.env.JOBS_FILES, c.body, c.now);
      return c.respond({ accepted: true }, 202);
    },
  }),
];
