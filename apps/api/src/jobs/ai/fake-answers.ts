// Input-dependent answers of the fake provider (JOBS_AI_MODE=fake). They let
// dev, the other leaves and e2e tests exercise realistic flows offline, and
// they are deterministic: the same input always gives the same answer.
//
//   classify   page kind from page markers (challenge, confirmation text,
//              login / sign-up controls, mailto, review + submit, form
//              fields, apply-entry button); injection from "ignore previous
//              instructions"-style text; upload from resume file fields.
//              Confidence rises by 0.12 when the screenshot is attached, so
//              the 0.85 retry rule (19 §4.3) is observable.
//   choose     next action from candidate role hints and the step state.
//   match      question → saved key by word overlap with the key and its
//              description.
//   verify     confirmation / error markers in the final page.
//   score      fit from skill-term and title overlap; gates from explicit
//              degree, on-site and sponsorship wording.
//   field plan maps fields only to the facts and answers the server supplied
//              (never invents a value); anything else needs the human.
// Tests can still override any of it with `FakeAiOptions`.

import type {
  CandidateAction,
  FieldPlan,
  FieldPlanItem,
  ObservedField,
  PageKind,
  PageObservation,
} from "@pilihpendidikan/jobs-contracts/agent";
import { normalizeText } from "@pilihpendidikan/jobs-contracts/fingerprint";
import type { ScoringProfile } from "@pilihpendidikan/jobs-contracts/scoring";
import {
  extractSkillTerms,
  parsePlace,
  titleFamilyIds,
  titleJaccard,
} from "../services/scoring/text";
import {
  acceptsPdf,
  booleanFlag,
  factKeysForField,
  fieldText,
  fileSlotOf,
  isPersonalQuestion,
  keyMatches,
  protectedCategory,
  yesNo,
} from "./lexicon";
import type {
  ChooseInput,
  FieldPlanContext,
  ScorePostingView,
  VerifyInput,
} from "./provider";

// ---------------------------------------------------------------------------
// Page classification
// ---------------------------------------------------------------------------

const CHALLENGE_RE =
  /captcha|verify you are (a )?human|i'?m not a robot|are you a robot|security check|bot (check|detection)|checking your browser|cloudflare|verifikasi manusia/;
const ERROR_RE =
  /page not found|not found|no longer (available|accepting)|job (has been |is )?(closed|filled|expired)|position (has been )?filled|posting (has )?expired|access denied|something went wrong|halaman tidak ditemukan|lowongan (sudah )?ditutup/;
const CONFIRM_RE =
  /thank you for (applying|your application|your interest)|application (has been |was )?(received|submitted|sent)|we('ve| have) received your application|successfully (applied|submitted)|terima kasih (telah|sudah) melamar|lamaran (anda )?(telah |sudah )?(diterima|terkirim|berhasil)/;
const LOGIN_RE = /\b(sign in|log in|login|masuk)\b/;
const SIGNUP_RE =
  /create (an |your )?account|sign up|register|choose a password|buat akun|daftar akun/;
const EMAIL_APPLY_RE =
  /mailto:|send (your )?(cv|resume|application)s? to|e-?mail (your )?(cv|resume|application)|apply (by|via) e-?mail|kirim(kan)? (cv|lamaran|berkas)/;
const REVIEW_RE =
  /review (your )?application|review and submit|please review|confirm your (details|application)|periksa kembali/;
const MARKETING_RE =
  /our blog|subscribe|newsletter|cookie (policy|settings)|accept (all )?cookies/;
const INJECTION_RE =
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the |all )?(previous|above)|(ai|llm) (agent|assistant)|as an ai|language model|chatgpt|automated (agent|assistant)|system prompt|you are now|reveal (your|the) (prompt|instructions)/;
const TYPICAL_FIELD_RE =
  /name|e-?mail|phone|resume|cv|linkedin|nama|telepon|address|location|cover letter/;

export interface FakeClassification {
  confidence: number;
  injection: number;
  kind: PageKind;
  upload: number;
}

function pageText(observation: PageObservation): string {
  return normalizeText(
    [
      observation.title,
      observation.visible_text_excerpt,
      observation.aria_snapshot.slice(0, 6000),
      ...observation.errors.map((error) => error.text),
    ].join(" \n ")
  );
}

function hasRole(observation: PageObservation, ...roles: string[]): boolean {
  return observation.controls.some((control) =>
    roles.includes(control.role_hint)
  );
}

function kindFromMarkers(
  observation: PageObservation,
  text: string
): [PageKind, number] {
  const fields = observation.fields;
  const required = fields.filter((field) => field.required).length;
  if (observation.challenge.detected || CHALLENGE_RE.test(text)) {
    return ["captcha_or_challenge", 0.97];
  }
  if (
    observation.http_status === 404 ||
    observation.http_status === 410 ||
    (fields.length === 0 && ERROR_RE.test(text))
  ) {
    return ["error_page", 0.95];
  }
  if (CONFIRM_RE.test(text) && required === 0) {
    return ["confirmation", 0.96];
  }
  if (
    fields.length <= 3 &&
    SIGNUP_RE.test(text) &&
    hasRole(observation, "sign_up")
  ) {
    return ["account_creation_required", 0.9];
  }
  if (
    fields.length <= 3 &&
    LOGIN_RE.test(text) &&
    hasRole(observation, "login")
  ) {
    return ["login_required", 0.9];
  }
  if (fields.length === 0 && EMAIL_APPLY_RE.test(text)) {
    return ["email_instructions", 0.9];
  }
  if (
    REVIEW_RE.test(text) &&
    hasRole(observation, "submit") &&
    required === 0
  ) {
    return ["review_page", 0.9];
  }
  if (fields.length > 0) {
    const typical = fields.some((field) =>
      TYPICAL_FIELD_RE.test(normalizeText(field.label))
    );
    return ["application_form", typical ? 0.95 : 0.8];
  }
  if (hasRole(observation, "apply_entry")) {
    return ["job_description", 0.93];
  }
  if (MARKETING_RE.test(text)) {
    return ["unrelated", 0.75];
  }
  return ["other", 0.6];
}

/** The fake page classification of an observation. */
export function fakeClassify(
  observation: PageObservation,
  withImage: boolean
): FakeClassification {
  const text = pageText(observation);
  const [kind, base] = kindFromMarkers(observation, text);
  const files = observation.fields.filter((field) => field.kind === "file");
  let upload = 0.03;
  if (files.some((field) => fileSlotOf(field) === "cv_file")) {
    upload = 0.97;
  } else if (files.length > 0) {
    upload = 0.6;
  }
  return {
    kind,
    confidence: withImage ? Math.min(0.99, base + 0.12) : base,
    injection: INJECTION_RE.test(text) ? 0.92 : 0.02,
    upload,
  };
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

function firstOf(
  candidates: readonly CandidateAction[],
  predicate: (candidate: CandidateAction) => boolean
): CandidateAction | undefined {
  return candidates.find(predicate);
}

const isClick =
  (...roles: string[]) =>
  (candidate: CandidateAction) =>
    candidate.type === "click_ref" && roles.includes(candidate.role_hint);

/** The fake next-action choice: `[choice, confidence]`. */
export function fakeChoose(
  input: Pick<ChooseInput, "candidates" | "pageKind" | "state">
): [string, number] {
  const { candidates, pageKind, state } = input;
  if (pageKind === "job_description") {
    const apply = firstOf(candidates, isClick("apply_entry"));
    return apply ? [apply.id, 0.92] : ["pause", 0.7];
  }
  const cookie = firstOf(candidates, isClick("cookie_consent_reject"));
  if (cookie) {
    return [cookie.id, 0.9];
  }
  if (state.errors > 0) {
    return ["pause", 0.8];
  }
  if (state.required_remaining > 0) {
    const fill = firstOf(candidates, (candidate) =>
      ["fill_field", "select_option", "set_checkbox", "upload_file"].includes(
        candidate.type
      )
    );
    if (fill) {
      return [fill.id, 0.9];
    }
    const scroll = firstOf(
      candidates,
      (candidate) => candidate.type === "scroll"
    );
    return scroll ? [scroll.id, 0.74] : ["pause", 0.65];
  }
  const next = firstOf(candidates, isClick("next"));
  if (next) {
    return [next.id, 0.91];
  }
  const submit = firstOf(candidates, isClick("submit"));
  if (
    submit &&
    (pageKind === "application_form" || pageKind === "review_page")
  ) {
    return [submit.id, 0.88];
  }
  return ["pause", 0.6];
}

// ---------------------------------------------------------------------------
// Question → answer bank
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "you",
  "your",
  "are",
  "is",
  "do",
  "does",
  "will",
  "in",
  "of",
  "to",
  "for",
  "with",
  "what",
  "how",
  "have",
  "be",
  "or",
  "and",
  "now",
  "future",
  "apakah",
  "anda",
  "yang",
  "dan",
  "di",
  "ke",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    normalizeText(text.replace(/[._]/g, " "))
      .split(" ")
      .map((word) => word.replace(/[^\p{L}\p{N}+#]/gu, ""))
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
  );
}

/** Stems shared by `a` and `b` (prefix match of ≥ 5 letters counts). */
function overlap(question: Set<string>, key: Set<string>): number {
  if (key.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of key) {
    const hit = [...question].some(
      (q) =>
        q === word ||
        (q.length >= 5 &&
          word.length >= 5 &&
          q.slice(0, 5) === word.slice(0, 5))
    );
    if (hit) {
      shared += 1;
    }
  }
  return shared / key.size;
}

/** The fake answer-bank match: `[key | "none", confidence]`. */
export function fakeMatch(
  questionText: string,
  keys: ReadonlyArray<{ description: string; value: string }>
): [string, number] {
  const question = contentWords(questionText);
  let best: { key: string; score: number } = { key: "none", score: 0 };
  for (const key of keys) {
    const score = Math.max(
      overlap(question, contentWords(key.value)),
      overlap(question, contentWords(key.description))
    );
    if (score > best.score) {
      best = { key: key.value, score };
    }
  }
  if (best.score >= 0.5) {
    return [best.key, Math.min(0.97, 0.62 + 0.35 * best.score)];
  }
  return ["none", 0.7];
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const THANKS_URL_RE = /\/(thank-?you|thanks|confirmation)\b/;
const STILL_FORM_RE =
  /\berror\b|required field|this field is required|please (correct|fix|complete|fill)|invalid|failed|try again|wajib diisi|tidak valid|gagal/;

/** The fake verification predicates. */
export function fakeVerify(
  input: Pick<VerifyInput, "final_url" | "page_title" | "text_excerpt">
): { received: number; stillForm: number } {
  const text = normalizeText(
    `${input.page_title} ${input.text_excerpt} ${input.final_url}`
  );
  const received = CONFIRM_RE.test(text) || THANKS_URL_RE.test(text);
  return {
    received: received ? 0.95 : 0.05,
    stillForm: STILL_FORM_RE.test(text) ? 0.86 : 0.04,
  };
}

// ---------------------------------------------------------------------------
// Scoring rubric
// ---------------------------------------------------------------------------

const DEGREE_REQUIRED_RE =
  /(bachelor'?s?|master'?s?|ph\.?d|doctorate|degree|diploma|s1|s2|sarjana)[^.\n]{0,60}\b(required|mandatory|must|minimum|wajib)\b|\b(required|must have|minimum|minimal|wajib)\b[^.\n]{0,60}(bachelor'?s?|master'?s?|ph\.?d|doctorate|degree|s1|s2|sarjana)/i;
const EQUIVALENT_RE = /or (an )?equivalent|or related experience|atau setara/i;
const RELOCATION_RE =
  /(?<!no )relocation (support|assistance|package)|(we|will) (offer|provide) (visa )?sponsorship|(?<!tanpa )bantuan relokasi/i;
const NO_SPONSOR_RE =
  /no (visa )?sponsorship|not (able to |be able to )?sponsor|unable to sponsor|without (visa )?sponsorship|must be (legally )?authori[sz]ed to work|(citizens?|citizenship) (only|required)|security clearance|tidak (menyediakan )?sponsor/i;
const DOCTORATE_RE = /ph\.?d|doctorate|s3/i;
const MASTER_RE = /master'?s?|s2|msc|mba/i;
const ORDER = [
  "none",
  "secondary",
  "diploma",
  "bachelor",
  "master",
  "doctorate",
];

function requiredDegree(text: string): number | null {
  if (!DEGREE_REQUIRED_RE.test(text) || EQUIVALENT_RE.test(text)) {
    return null;
  }
  if (DOCTORATE_RE.test(text)) {
    return ORDER.indexOf("doctorate");
  }
  if (MASTER_RE.test(text)) {
    return ORDER.indexOf("master");
  }
  return ORDER.indexOf("bachelor");
}

export interface FakeScore {
  confidence: number;
  degree: number;
  fit: number;
  onsite: number;
  workAuth: number;
}

/** The fake rubric: overall fit 0–4 plus the three gate probabilities. */
export function fakeScore(
  profile: ScoringProfile,
  posting: ScorePostingView
): FakeScore {
  const text = `${posting.requirements.join("\n")}\n${posting.description_text}`;
  const wanted = extractSkillTerms(`${posting.title}\n${text}`);
  const mine = new Set([
    ...profile.skills,
    ...profile.experience_digest.flatMap((role) => role.keywords),
  ]);
  let shared = 0;
  for (const term of wanted) {
    if (mine.has(term)) {
      shared += 1;
    }
  }
  const skillRatio =
    wanted.size === 0 ? 0.5 : shared / Math.max(3, wanted.size);
  const postingFamilies = titleFamilyIds(posting.title);
  const titleRatio = profile.target_titles.reduce((best, target) => {
    const family = [...titleFamilyIds(target)].some((id) =>
      postingFamilies.has(id)
    );
    return Math.max(best, family ? 1 : titleJaccard(target, posting.title));
  }, 0);
  const fitUnit = Math.min(
    1,
    0.65 * Math.min(1, skillRatio) + 0.35 * titleRatio
  );
  const degreeLevel = requiredDegree(text);
  const userLevel = Math.max(
    0,
    ...profile.education.map((entry) => ORDER.indexOf(entry.level))
  );
  const userCountries = new Set(profile.locations.map((l) => l.country_code));
  const postingCountries = posting.locations
    .map((raw) => parsePlace(raw).country_code)
    .filter((code): code is string => Boolean(code));
  const onsiteOutside =
    (posting.workplace_type === "onsite" ||
      posting.workplace_type === "hybrid") &&
    userCountries.size > 0 &&
    postingCountries.length > 0 &&
    !postingCountries.some((code) => userCountries.has(code)) &&
    !RELOCATION_RE.test(text);
  const authorized = new Set(
    profile.work_authorization
      .filter((entry) =>
        ["citizen", "permanent_resident", "work_visa"].includes(entry.status)
      )
      .map((entry) => entry.country_code)
  );
  const needsAuth =
    NO_SPONSOR_RE.test(text) &&
    (postingCountries.length === 0
      ? authorized.size === 0
      : !postingCountries.some((code) => authorized.has(code)));
  return {
    fit: Math.round(fitUnit * 4 * 100) / 100,
    confidence:
      Math.round((0.6 + 0.35 * Math.abs(fitUnit - 0.5) * 2) * 100) / 100,
    degree: degreeLevel !== null && userLevel < degreeLevel ? 0.88 : 0.06,
    onsite: onsiteOutside ? 0.86 : 0.04,
    workAuth: needsAuth ? 0.9 : 0.05,
  };
}

// ---------------------------------------------------------------------------
// Field plan
// ---------------------------------------------------------------------------

function optionMatching(
  field: ObservedField,
  value: string
): { label: string; value: string } | null {
  const wanted = normalizeText(value);
  const flag = booleanFlag(value, value);
  for (const option of field.options) {
    if (option.disabled) {
      continue;
    }
    if (
      normalizeText(option.label) === wanted ||
      normalizeText(option.value) === wanted ||
      (flag !== null &&
        (yesNo(option.label) === flag || yesNo(option.value) === flag))
    ) {
      return { label: option.label, value: option.value };
    }
  }
  return null;
}

const CHOICE_KINDS = new Set([
  "select",
  "radio_group",
  "combobox",
  "checkbox_group",
]);

function baseItem(field: ObservedField, index: number): FieldPlanItem {
  return {
    plan_item: `p${index + 1}`,
    ref: field.ref,
    signature: field.signature,
    action: "skip",
    value_source: "none",
    fact_key: null,
    answer_id: null,
    option_value: null,
    value: null,
    confidence: 0,
    sensitivity: "none",
    needs_human: false,
    question_key: null,
    reason: "",
  };
}

function actionFor(field: ObservedField): FieldPlanItem["action"] {
  if (field.kind === "file") {
    return "upload";
  }
  if (field.kind === "checkbox") {
    return "check";
  }
  return CHOICE_KINDS.has(field.kind) ? "select" : "fill";
}

function needsHuman(
  item: FieldPlanItem,
  field: ObservedField,
  why: string
): FieldPlanItem {
  return {
    ...item,
    action: actionFor(field),
    needs_human: true,
    confidence: 0.3,
    reason: why,
  };
}

function planFile(
  item: FieldPlanItem,
  field: ObservedField,
  context: FieldPlanContext
): FieldPlanItem {
  const slot = fileSlotOf(field) ?? "cv_file";
  if (context.fileSlots[slot] && acceptsPdf(field.accept)) {
    return {
      ...item,
      action: "upload",
      value_source: slot,
      confidence: 0.95,
      reason: `upload the attached ${slot === "cv_file" ? "CV" : "cover letter"}`,
    };
  }
  return needsHuman(item, field, "no compatible file attached");
}

function planFromValue(
  item: FieldPlanItem,
  field: ObservedField,
  value: string,
  source: { answer_id?: string; fact_key?: string; question_key?: string }
): FieldPlanItem {
  const sourced: FieldPlanItem = {
    ...item,
    fact_key: source.fact_key ?? null,
    answer_id: source.answer_id ?? null,
    question_key: source.question_key ?? null,
    value_source: source.answer_id ? "answer" : "fact",
    confidence: 0.92,
  };
  if (CHOICE_KINDS.has(field.kind) || field.kind === "checkbox") {
    if (field.kind === "checkbox") {
      const flag = booleanFlag(value, value);
      return flag
        ? {
            ...sourced,
            action: flag === "yes" ? "check" : "uncheck",
            value,
            reason: "checkbox from a stored value",
          }
        : needsHuman(item, field, "no stored value for this checkbox");
    }
    const option = optionMatching(field, value);
    return option
      ? {
          ...sourced,
          action: "select",
          value_source: source.answer_id ? "answer" : "option",
          option_value: option.value,
          value: option.label,
          reason: "option entailed by a stored value",
        }
      : needsHuman(item, field, "no option equals the stored value");
  }
  return { ...sourced, action: "fill", value, reason: "stored value" };
}

function planField(
  field: ObservedField,
  index: number,
  context: FieldPlanContext,
  lookups: {
    answers: ReadonlyMap<string, FieldPlanContext["answers"][number]>;
    hints: ReadonlyMap<string, FieldPlanContext["hints"][number]>;
  }
): FieldPlanItem {
  const item = baseItem(field, index);
  const text = fieldText(field);
  if (protectedCategory(text)) {
    item.sensitivity = "protected";
  } else if (isPersonalQuestion(text)) {
    item.sensitivity = "personal";
  }
  if (field.user_touched || (field.has_value && !field.invalid)) {
    return { ...item, confidence: 1, reason: "field already has a value" };
  }
  if (field.kind === "file") {
    return planFile(item, field, context);
  }
  if (item.sensitivity === "protected") {
    return needsHuman(item, field, "protected question");
  }
  const hint = lookups.hints.get(field.ref);
  const hinted = hint ? lookups.answers.get(hint.answer_id) : undefined;
  if (hinted) {
    return planFromValue(item, field, hinted.answer, {
      answer_id: hinted.id,
      question_key: hinted.question_key,
    });
  }
  const matchers = factKeysForField(field);
  const fact = context.facts.find((candidate) =>
    keyMatches(candidate.key, matchers)
  );
  if (fact) {
    return planFromValue(item, field, fact.value, { fact_key: fact.key });
  }
  return needsHuman(item, field, "no fact or answer supports a value");
}

/** A field plan citing only the supplied facts / answers (fake). */
export function fakeFieldPlan(
  observation: PageObservation,
  context: FieldPlanContext
): FieldPlan {
  const lookups = {
    answers: new Map(context.answers.map((answer) => [answer.id, answer])),
    hints: new Map(context.hints.map((hint) => [hint.ref, hint])),
  };
  const items = observation.fields.map((field, index) =>
    planField(field, index, context, lookups)
  );
  return {
    items,
    missing: items
      .filter((item) => item.needs_human)
      .map((item) => {
        const field = observation.fields.find((f) => f.ref === item.ref);
        return {
          ref: item.ref,
          label: (field?.label ?? "").slice(0, 300),
          question_key: item.question_key,
          why: item.reason.slice(0, 200),
        };
      }),
  };
}
