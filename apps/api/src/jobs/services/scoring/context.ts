// Everything scoring needs about one user, loaded once per queue batch
// (07 §7.2 step 1): the current profile_version, the ScoringProfile (full and
// AI views), AI availability (AI_DISABLED, consent, the D-34 budget), the
// locale of the explanations and the timezone of the daily budget.

import type { CVData } from "@pilihpendidikan/cv-engine/types";
import { CVDataSchema } from "@pilihpendidikan/cv-engine/schema";
import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { ScoringProfile } from "@pilihpendidikan/jobs-contracts/scoring";
import { normalizeEmail } from "../../../auth";
import type { Env } from "../../../env";
import { resolveOwner } from "../../../ownership";
import { getFeatureFlags } from "../../core/flags";
import type { UserScope } from "../../core/scope";
import type { AiBudgetStatus } from "../../repo/core/ai-usage";
import { getAiBudgetStatus } from "../../repo/core/ai-usage";
import type { JobsDb } from "../../repo/core/db";
import {
  computeProfileVersion,
  PRIMARY_CV_FACT,
} from "../../repo/core/profile-version";
import { getUserSettings } from "../../repo/core/settings";
import { findUserById } from "../../repo/core/users";
import { loadProfileInputs } from "../../repo/scoring";
import { aiProfileView, buildScoringProfile, isThinProfile } from "./profile";

/**
 * Reservations against what is left of the user's month and day (D-34). The
 * consumer scores up to five postings at once, so a call reserves its
 * estimate first and settles with the real cost afterwards.
 */
export class BudgetTracker {
  readonly #remaining: number;
  #reserved = 0;

  constructor(
    status: Pick<
      AiBudgetStatus,
      "daySpentMicroUsd" | "exhausted" | "limits" | "monthSpentMicroUsd"
    >
  ) {
    this.#remaining = status.exhausted
      ? 0
      : Math.max(
          0,
          Math.min(
            status.limits.monthlyMicroUsd - status.monthSpentMicroUsd,
            status.limits.dailyMicroUsd - status.daySpentMicroUsd
          )
        );
  }

  /** Reserves `estimate` micro-USD; false when it would cross a cap. */
  tryReserve(estimate: number): boolean {
    if (this.#reserved + estimate > this.#remaining) {
      return false;
    }
    this.#reserved += estimate;
    return true;
  }

  /** Replaces a reservation by the real cost. */
  settle(estimate: number, actual: number): void {
    this.#reserved += actual - estimate;
  }

  /** Gives a reservation back (the call failed before spending). */
  release(estimate: number): void {
    this.#reserved -= estimate;
  }

  get remaining(): number {
    return this.#remaining - this.#reserved;
  }
}

export interface UserScoringContext {
  aiConsent: boolean;
  aiDisabled: boolean;
  /** The profile as sent to OpenAI (07 §8). */
  aiProfile: ScoringProfile;
  budget: BudgetTracker;
  locale: Locale;
  /** The full profile (features). */
  profile: ScoringProfile;
  profileVersion: number;
  sensitiveAllowed: boolean;
  thin: boolean;
  timezone: string;
}

/** The primary base CV when the user owns it (`owner:cv:{id}` stamp). */
export async function loadOwnedCv(
  env: Pick<Env, "CV_KV">,
  cvId: string | null,
  ownerEmail: string
): Promise<CVData | null> {
  if (!cvId) {
    return null;
  }
  const owner = await resolveOwner(env as Env, "cv", cvId);
  if (!owner || normalizeEmail(owner) !== normalizeEmail(ownerEmail)) {
    return null;
  }
  const raw = await env.CV_KV.get(`cv:${cvId}`);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = CVDataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as CVData) : null;
  } catch {
    return null;
  }
}

/** The scoring context of one user, or null for a missing / deleted user. */
export async function loadUserScoringContext(
  env: Env,
  db: JobsDb,
  scope: UserScope,
  now: number
): Promise<UserScoringContext | null> {
  const user = await findUserById(env.DB, scope.userId);
  if (!user || user.deleted_at !== null) {
    return null;
  }
  const profileVersion = await computeProfileVersion(env, db, scope, {
    email: user.email,
  });
  const inputs = await loadProfileInputs(db, scope);
  const primary = inputs.facts.find((fact) => fact.key === PRIMARY_CV_FACT);
  const cv = await loadOwnedCv(
    env,
    typeof primary?.value === "string" ? primary.value : null,
    user.email
  );
  const settings = await getUserSettings(db, scope, now);
  const flags = await getFeatureFlags(env, now);
  const profile = buildScoringProfile({
    cv,
    facts: inputs.facts,
    yearsAnswers: inputs.yearsAnswers,
    now,
    profileVersion,
  });
  const budget = await getAiBudgetStatus(db, scope, {
    env,
    now,
    timezone: settings.timezone,
  });
  return {
    profileVersion,
    profile,
    aiProfile: aiProfileView(profile, settings.ai_scoring_sensitive),
    sensitiveAllowed: settings.ai_scoring_sensitive,
    thin: isThinProfile(profile),
    aiDisabled: flags.AI_DISABLED,
    aiConsent: settings.ai_consent_at !== null,
    budget: new BudgetTracker(budget),
    locale: settings.locale,
    timezone: settings.timezone,
  };
}
