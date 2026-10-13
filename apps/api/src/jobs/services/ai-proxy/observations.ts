// The step's page, remembered between the calls of one agent step (19 §2):
// page-classify and field-plan carry the observation; next-action carries
// only `observation_id` and the candidates (agent.ts), yet its choice
// descriptions quote the control text (19 §5.2). The server therefore keeps
// the few strings it needs per (user, lease, observation) in isolate memory
// for 15 minutes (bounded, never written anywhere). A `click_ref` candidate
// may also carry its own `text` (UNTRUSTED, sanitized to ≤ 60 characters):
// that comes first, then the remembered control text, then the role-only
// templates.

import type {
  CandidateAction,
  PageObservation,
} from "@pilihpendidikan/jobs-contracts/agent";
import { fenceLine } from "../../ai/compose";

const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 512;
const QUOTE_MAX = 60;

export interface RememberedPage {
  controls: Map<string, { kind: string; role_hint: string; text: string }>;
  fields: Map<string, { kind: string; label: string }>;
  title: string;
  url: string;
  visible_text_excerpt: string;
}

const pages = new Map<string, { at: number; page: RememberedPage }>();

function keyOf(userId: string, leaseId: string, observationId: string): string {
  return `${userId}\u0000${leaseId}\u0000${observationId}`;
}

/** Keeps what next-action needs of an observation (15 min, ≤ 512 pages). */
export function rememberObservation(
  userId: string,
  leaseId: string,
  observation: PageObservation,
  now: number
): void {
  const key = keyOf(userId, leaseId, observation.observation_id);
  pages.delete(key);
  pages.set(key, {
    at: now,
    page: {
      url: observation.url,
      title: observation.title,
      visible_text_excerpt: observation.visible_text_excerpt.slice(0, 4000),
      controls: new Map(
        observation.controls.map((control) => [
          control.ref,
          {
            text: control.text,
            kind: control.kind,
            role_hint: control.role_hint,
          },
        ])
      ),
      fields: new Map(
        observation.fields.map((field) => [
          field.ref,
          { label: field.label, kind: field.kind },
        ])
      ),
    },
  });
  while (pages.size > MAX_ENTRIES) {
    const oldest = pages.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    pages.delete(oldest);
  }
}

/** The remembered page, or null (expired, other isolate, never seen). */
export function recallObservation(
  userId: string,
  leaseId: string,
  observationId: string,
  now: number
): RememberedPage | null {
  const key = keyOf(userId, leaseId, observationId);
  const entry = pages.get(key);
  if (!entry) {
    return null;
  }
  if (now - entry.at > TTL_MS) {
    pages.delete(key);
    return null;
  }
  return entry.page;
}

/** Drops every remembered page (tests). */
export function forgetObservations(): void {
  pages.clear();
}

const ROLE_PHRASES: Readonly<Record<string, string>> = {
  next: "goes to the next step",
  previous: "goes back a step",
  submit: "submits the application",
  add_section: "adds a section",
  remove_section: "removes a section",
  upload_trigger: "opens a file upload",
  apply_entry: "starts the application",
  cookie_consent_reject: "rejects optional cookies",
  cookie_consent_accept: "accepts cookies",
};

const WHOLE_MARKER_RE = /<<[^<>\r\n]{0,80}>>/g;
const SPACES_RE = /\s+/g;
const DOUBLE_QUOTE_RE = /"/g;

/**
 * A control text from the request, safe to quote (19 §5.2): whole `<<…>>`
 * markers and any remaining marker look-alikes removed, newlines collapsed,
 * trimmed to ≤ 60 characters; null when nothing is left.
 */
export function sanitizeControlText(text: string | undefined): string | null {
  if (!text) {
    return null;
  }
  const line = fenceLine(
    text.replace(WHOLE_MARKER_RE, " ").replace(SPACES_RE, " "),
    QUOTE_MAX
  ).trim();
  return line.length > 0 ? line : null;
}

function quote(text: string | undefined): string | null {
  const line = fenceLine(text ?? "", QUOTE_MAX).replace(DOUBLE_QUOTE_RE, "'");
  return line ? `"${line}"` : null;
}

/** The candidate's own text (whole markers dropped), quoted. */
function quoteRequestText(text: string | undefined): string | null {
  const line = sanitizeControlText(text)?.replace(DOUBLE_QUOTE_RE, "'");
  return line ? `"${line}"` : null;
}

/** The fixed-template description of a candidate (19 §5.2). */
export function describeCandidate(
  candidate: CandidateAction,
  page: RememberedPage | null
): string {
  switch (candidate.type) {
    case "click_ref": {
      const control = page?.controls.get(candidate.ref);
      const phrase = ROLE_PHRASES[candidate.role_hint] ?? candidate.role_hint;
      const text = quoteRequestText(candidate.text) ?? quote(control?.text);
      const noun = control?.kind === "link" ? "link" : "button";
      return text
        ? `Click ${noun} ${text} (${phrase})`
        : `Click the control that ${phrase}`;
    }
    case "fill_field":
    case "select_option":
    case "set_checkbox":
    case "upload_file": {
      const label = quote(page?.fields.get(candidate.ref)?.label);
      const verb = {
        fill_field: "Fill in the field",
        select_option: "Choose an option in",
        set_checkbox: "Set the checkbox",
        upload_file: "Upload the prepared file to",
      }[candidate.type];
      return label ? `${verb} ${label}` : `${verb} ${candidate.ref}`;
    }
    case "scroll":
      return candidate.direction === "down" ? "Scroll down" : "Scroll up";
    case "wait_for":
      return candidate.condition === "network_idle"
        ? "Wait for the page to finish loading"
        : "Wait for the page address to change";
    case "pause_for_human":
      return `Ask the applicant to look at this page (${candidate.reason})`;
    default:
      return `Stop the attempt (${fenceLine(candidate.error_class, 40)})`;
  }
}
