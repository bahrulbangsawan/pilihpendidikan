import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ACTOR_KINDS,
  ANSWER_KINDS,
  APPLICATION_MODES,
  AUTO_USE,
  CHANGE_SOURCES,
  CV_TEMPLATES,
  CV_VARIANT_STATUSES,
  EVENT_TYPES,
  EVIDENCE_KINDS,
  EVIDENCE_SCREENSHOT_MODES,
  EVIDENCE_VERDICTS,
  FACT_SOURCES,
  INTERVIEW_KINDS,
  INTERVIEW_OUTCOMES,
  OFFER_STATUSES,
  PAUSE_REASONS,
  PROGRESS_STAGES,
  SALARY_PERIODS,
  SENSITIVITIES,
  SOURCE_KINDS,
  STAGES,
  SUBMISSION_METHODS,
  SUBMISSION_STATUSES,
  TASK_STATES,
  WORKPLACE_TYPES,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  APPROVAL_KINDS,
  APPROVAL_STATES,
  DISCOVERY_ERROR_CLASSES,
  DISCOVERY_RUN_STATUSES,
  GRANT_REVOKED_REASONS,
  INBOX_BULK_ACTIONS,
  INBOX_STATES,
  TASK_ERROR_CLASSES,
  TASK_KINDS,
} from "@pilihpendidikan/jobs-contracts/enums";
import { CV_SECTION_IDS } from "@pilihpendidikan/jobs-contracts/cv-tailoring";
import {
  FEATURE_NAMES,
  GATE_PREDICATES,
  WORK_AUTH_STATUSES,
} from "@pilihpendidikan/jobs-contracts/scoring";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_NAV,
  BAND_LINKS,
  MAIN_NAV,
} from "@/components/shell/nav-items";
import { FACT_GROUPS } from "@/lib/facts-form";
import { FOLLOW_UP_PRESETS } from "@/lib/follow-up";
import { SHORTCUTS } from "@/lib/shortcuts";
import { getT } from "./index";
import en from "./locales/en.json";
import id from "./locales/id.json";

function leaves(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix.slice(0, -1), value);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    for (const [path, text] of leaves(child, `${prefix}${key}.`)) {
      out.set(path, text);
    }
  }
  return out;
}

const EN = leaves(en);
const ID = leaves(id);
const PLACEHOLDER_RE = /\{(\w+)\}/g;
const STATIC_KEY_RE = /\bt\(\s*"([A-Za-z0-9_.]+)"/g;
const TS_FILE_RE = /\.tsx?$/;
const SHOUTING_RE = /\b[A-Z]{4,}\b/g;
const TITLE_KEY_RE = /pageTitle\(match, "([A-Za-z0-9_.]+)"/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)]
    .map((match) => match[1] ?? "")
    .sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return TS_FILE_RE.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

/** Keys built from enums and config at runtime (`t(\`stages.${stage}\`)`). */
function dynamicKeys(): string[] {
  const each = (prefix: string, values: readonly string[]) =>
    values.map((value) => `${prefix}.${value}`);
  return [
    ...each("stages", STAGES),
    ...each("modes", APPLICATION_MODES),
    ...each("sourceKinds", SOURCE_KINDS),
    ...each("sourceBadges", SOURCE_KINDS),
    ...each("workplace", WORKPLACE_TYPES),
    ...each("submission", SUBMISSION_STATUSES),
    ...each(
      "card.submission",
      SUBMISSION_STATUSES.filter((status) => status !== "not_started")
    ),
    ...each("taskStates", TASK_STATES),
    ...each("progressStages", PROGRESS_STAGES),
    ...each("pauseReasons", PAUSE_REASONS),
    ...each("actors", ACTOR_KINDS),
    ...each("changeSources", CHANGE_SOURCES),
    ...each("interviewKinds", INTERVIEW_KINDS),
    ...each("interviewOutcomes", INTERVIEW_OUTCOMES),
    ...each("offerStatuses", OFFER_STATUSES),
    ...each("methods", SUBMISSION_METHODS),
    ...each("salaryPeriods", SALARY_PERIODS),
    ...each("evidenceKinds", EVIDENCE_KINDS),
    ...each("evidenceVerdicts", EVIDENCE_VERDICTS),
    ...each("cv.templates", CV_TEMPLATES),
    ...each("cv.statuses", CV_VARIANT_STATUSES),
    ...each("answers.kinds", ANSWER_KINDS),
    ...each("answers.sensitivities", SENSITIVITIES),
    ...each("answers.sensitivityHelp", SENSITIVITIES),
    ...each("answers.autoUses", AUTO_USE),
    ...each("profile.sources", FACT_SOURCES),
    ...each("profile.workAuthStatuses", WORK_AUTH_STATUSES),
    ...each("settings.screenshotModes", EVIDENCE_SCREENSHOT_MODES),
    ...each(
      "nav",
      [...MAIN_NAV, ...ACCOUNT_NAV, ...BAND_LINKS].map((item) => item.key)
    ),
    ...each(
      "shortcuts.actions",
      SHORTCUTS.map((entry) => entry.action)
    ),
    ...each(
      "shortcuts.scopes",
      SHORTCUTS.map((entry) => entry.scope)
    ),
    ...each(
      "followUp.presets",
      FOLLOW_UP_PRESETS.map((preset) => preset.key)
    ),
    ...each("followUp.reasons", [
      "after_applied",
      "after_interview",
      "offer_deadline",
    ]),
    ...each("detail.tabs", [
      "overview",
      "cv",
      "apply",
      "timeline",
      "interviews",
      "offers",
      "checklists",
    ]),
    ...each("apply.methods", ["browser", "email", "manual"]),
    ...each("bulk.status", ["ok", "skipped", "conflict", "failed"]),
    ...each("checklists.status", ["saving", "saved", "error"]),
    ...each("checklists.limit", ["items", "bytes"]),
    ...each("cvs.visibilities", ["public", "private"]),
    ...each("profile.groups", [
      ...FACT_GROUPS.map((group) => group.id),
      "workAuth",
    ]),
    ...each(
      "profile.facts",
      FACT_GROUPS.flatMap((group) => group.fields.map((field) => field.key))
    ),
    ...each("nextStep.actions", [
      "review_outcome",
      "confirm_submission",
      "approve_submission",
      "review_cv",
      "generate_cv",
      "start_apply",
      "add_interview",
    ]),
    ...each("nextStep.why", [
      "review_outcome",
      "confirm_submission",
      "approve_submission",
      "review_cv",
      "generate_cv",
      "start_apply",
      "add_interview",
    ]),
    ...each("signIn.errors", [
      "expired",
      "unavailable",
      "rate_limited",
      "session_expired",
    ]),
    ...each("signIn.errors", [
      "expiredTitle",
      "unavailableTitle",
      "rate_limitedTitle",
      "session_expiredTitle",
    ]),
    ...each(
      "timeline",
      EVENT_TYPES.filter(
        (type) =>
          ![
            "created",
            "stage_changed",
            "submission_status_changed",
            "note_deleted",
            "approval_decided",
            "conflict_recorded",
          ].includes(type)
      )
    ),
    "nav.devicesOne",
    "nav.devicesMany",
    ...each("approvalKinds", APPROVAL_KINDS),
    ...each("approvalStates", APPROVAL_STATES),
    ...each("taskKinds", TASK_KINDS),
    ...each("runStatuses", DISCOVERY_RUN_STATUSES),
    ...each("discoveryErrors", DISCOVERY_ERROR_CLASSES),
    ...each("inboxStates", INBOX_STATES),
    ...each("taskErrors", TASK_ERROR_CLASSES),
    ...each("pages", [
      "inbox",
      "job",
      "automation",
      "approvals",
      "rules",
      "runs",
      "monitor",
      "cli",
      "sources",
      "stats",
      "render",
    ]),
    ...each("cv.sections", CV_SECTION_IDS),
    ...each("cv.diff.operations", ["keep", "reorder", "rephrase", "merge"]),
    ...each("render.errors", [
      "no_ticket",
      "ticket_rejected",
      "no_cv_data",
      "invalid_cv",
      "render_failed",
      "too_large",
      "upload_failed",
    ]),
    ...each("email.statuses", [
      "draft",
      "approved",
      "sent",
      "failed",
      "handed_off",
    ]),
    ...each("apply.modeHelp", APPLICATION_MODES),
    ...each("score.explanation.gate", GATE_PREDICATES),
    ...each("inbox.bulk.done", INBOX_BULK_ACTIONS),
    ...each("inbox.score.components", [...FEATURE_NAMES, "ai"]),
    ...each("devices.signedOutReasons", GRANT_REVOKED_REASONS),
    ...each("stats.range.presets", ["30d", "90d", "year", "all", "custom"]),
    ...each("stats.timing.metrics", [
      "time_to_first_response",
      "time_to_interview",
      "time_to_offer",
      "prep_time",
    ]),
    ...each("monitor.pauseTitles", PAUSE_REASONS),
  ];
}

describe("TW-I18N catalogues (en / id)", () => {
  it("TW-I18N en and id have exactly the same keys", () => {
    expect([...ID.keys()].sort()).toEqual([...EN.keys()].sort());
  });

  it("TW-I18N no string is empty in either language", () => {
    for (const [key, text] of [...EN, ...ID]) {
      expect(text.trim(), key).not.toBe("");
    }
  });

  it("TW-I18N placeholders match between en and id", () => {
    for (const [key, text] of EN) {
      expect(placeholders(ID.get(key) ?? ""), key).toEqual(placeholders(text));
    }
  });

  it('TW-I18N every static t("…") key used in src exists', () => {
    const root = new URL("..", import.meta.url).pathname;
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of [
        ...source.matchAll(STATIC_KEY_RE),
        ...source.matchAll(TITLE_KEY_RE),
      ]) {
        const key = match[1] ?? "";
        if (!EN.has(key)) {
          missing.push(`${file.slice(root.length)}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("TW-I18N every enum-built key exists (stages, statuses, reasons…)", () => {
    const missing = dynamicKeys().filter(
      (key) => !(EN.has(key) && ID.has(key))
    );
    expect(missing).toEqual([]);
  });

  it("TW-I18N Indonesian stage names follow the 12 §13 glossary", () => {
    const t = getT("id");
    expect(STAGES.map((stage) => t(`stages.${stage}`))).toEqual([
      "Disimpan",
      "Persiapan",
      "Siap",
      "Dilamar",
      "Wawancara",
      "Tawaran",
      "Diterima",
      "Ditolak",
      "Ditarik",
    ]);
    expect(t("nav.board")).toBe("Papan");
    expect(t("nav.inbox")).toBe("Kotak masuk");
    expect(t("submission.outcome_unknown")).toBe("Perlu ditinjau");
    expect(t("submission.submitted_unverified")).toBe("Belum terkonfirmasi");
  });

  it("TW-I18N interpolates {placeholders} and falls back to English, then the key", () => {
    const t = getT("en");
    expect(t("move.illegal", { from: "Applied", to: "Preparing" })).toBe(
      "Can't move from Applied to Preparing"
    );
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("TW-I18N copy is sentence case: no all-caps words", () => {
    const allowed = new Set([
      "HTML",
      "MCP",
      "AI",
      "CLI",
      "URL",
      "PDF",
      "ZIP",
      "APAC",
    ]);
    for (const [key, text] of [...EN, ...ID]) {
      const words = text.match(SHOUTING_RE) ?? [];
      expect(
        words.filter((word) => !allowed.has(word)),
        key
      ).toEqual([]);
    }
  });
});
