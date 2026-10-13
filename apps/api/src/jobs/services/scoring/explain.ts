// Deterministic bilingual explanations (07 §5): `match_scores.explanation` is
// assembled from `components` with fixed `en` / `id` templates. No generative
// call, so it is free, reproducible and cannot carry a hallucinated reason.
// The same keys are mirrored in apps/jobs (`score.*` in its locales) so the
// web can re-render a stored score in the viewer's language.
//
//   78 · Good match
//   ⚠ Possible blocker: posting requires a degree you have not listed
//   ✓ Skills: python, postgresql, aws (3 of 4 required)   ✗ Missing: kubernetes
//   ✓ Title close to your target "Backend Engineer"
//   ✓ Remote within your country
//   ~ Seniority: posting senior, you mid
//   AI fit: good (confidence 71%)

import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type {
  GatePredicate,
  ScoreComponents,
  ScoringProfile,
} from "@pilihpendidikan/jobs-contracts/scoring";

type Seniority = ScoringProfile["seniority"];

const MAX_LISTED_MATCHED = 6;
const GATE_ORDER = { blocking: 0, possible: 1 } as const;
const MAX_LISTED_MISSING = 4;

interface Strings {
  aiDeclined: string;
  aiFit: (label: string, confidence: number | null) => string;
  aiLevels: readonly [string, string, string, string, string];
  aiStatus: Record<"budget" | "error" | "dlq" | "disabled" | "skipped", string>;
  bands: { good: string; partial: string; strong: string; weak: string };
  freshness: (days: number) => string;
  gate: Record<GatePredicate, string>;
  gateLevel: { blocking: string; possible: string };
  languagesMet: (codes: string) => string;
  languagesMissing: (codes: string) => string;
  location: Record<string, string>;
  more: (n: number) => string;
  salary: { below: string; meets: string; slightly: string };
  seniority: (posting: string, user: string) => string;
  seniorityWords: Record<Exclude<Seniority, "unknown">, string>;
  skills: (list: string, matched: number, total: number) => string;
  skillsMissing: (list: string) => string;
  skillsNone: (total: number) => string;
  skillsUnknown: string;
  title: {
    close: (target: string) => string;
    differs: string;
    exact: (target: string) => string;
    none: string;
    partial: (target: string) => string;
  };
}

const EN: Strings = {
  bands: {
    strong: "Strong match",
    good: "Good match",
    partial: "Partial match",
    weak: "Weak match",
  },
  gateLevel: { blocking: "⚠ Blocker", possible: "⚠ Possible blocker" },
  gate: {
    requires_unavailable_work_authorization:
      "posting requires a work authorization you have not listed",
    requires_degree_user_lacks: "posting requires a degree you have not listed",
    requires_onsite_outside_user_locations:
      "posting is on-site outside your locations",
  },
  skills: (list, matched, total) =>
    `Skills: ${list} (${matched} of ${total} required)`,
  skillsNone: (total) => `Skills: none of the ${total} required`,
  skillsMissing: (list) => `✗ Missing: ${list}`,
  skillsUnknown:
    "· Skills not compared (none listed in the posting or your profile)",
  more: (n) => `+${n} more`,
  title: {
    exact: (target) => `✓ Title matches your target "${target}"`,
    close: (target) => `✓ Title close to your target "${target}"`,
    partial: (target) => `~ Title partly matches your target "${target}"`,
    differs: "✗ Title differs from your target titles",
    none: "· No target titles set",
  },
  location: {
    remote_in_country: "✓ Remote within your country",
    remote_anywhere: "✓ Remote with no location limit",
    location_match: "✓ Location matches your preferences",
    hybrid_same_country: "~ Hybrid in your country, another city",
    remote_outside_region: "✗ Remote only outside your countries",
    outside_locations: "✗ Location outside your preferences",
  },
  seniority: (posting, user) => `Seniority: posting ${posting}, you ${user}`,
  seniorityWords: {
    intern: "intern",
    junior: "junior",
    mid: "mid",
    senior: "senior",
    lead: "lead",
    principal: "principal",
  },
  salary: {
    meets: "✓ Salary meets your minimum",
    slightly: "~ Salary slightly below your minimum",
    below: "✗ Salary below your minimum",
  },
  languagesMet: (codes) => `✓ Languages: ${codes}`,
  languagesMissing: (codes) => `✗ Missing language: ${codes}`,
  freshness: (days) => `~ Posted ${days} days ago`,
  aiLevels: ["poor", "weak", "partial", "good", "excellent"],
  aiFit: (label, confidence) =>
    confidence === null
      ? `AI fit: ${label}`
      : `AI fit: ${label} (confidence ${confidence}%)`,
  aiDeclined: "AI declined to assess",
  aiStatus: {
    budget: "AI matching paused for this month",
    error: "AI assessment failed: deterministic score only",
    dlq: "AI off: deterministic score only",
    disabled: "AI matching is turned off",
    skipped: "Add skills to your profile to improve matching",
  },
};

const ID: Strings = {
  bands: {
    strong: "Sangat cocok",
    good: "Cocok",
    partial: "Cukup cocok",
    weak: "Kurang cocok",
  },
  gateLevel: {
    blocking: "⚠ Penghalang",
    possible: "⚠ Kemungkinan penghalang",
  },
  gate: {
    requires_unavailable_work_authorization:
      "lowongan mensyaratkan izin kerja yang belum Anda cantumkan",
    requires_degree_user_lacks:
      "lowongan mensyaratkan gelar yang belum Anda cantumkan",
    requires_onsite_outside_user_locations:
      "lowongan di kantor di luar lokasi Anda",
  },
  skills: (list, matched, total) =>
    `Keahlian: ${list} (${matched} dari ${total} yang diminta)`,
  skillsNone: (total) => `Keahlian: tidak ada dari ${total} yang diminta`,
  skillsMissing: (list) => `✗ Belum ada: ${list}`,
  skillsUnknown:
    "· Keahlian tidak dibandingkan (tidak ada di lowongan atau profil Anda)",
  more: (n) => `+${n} lainnya`,
  title: {
    exact: (target) => `✓ Jabatan sesuai target Anda "${target}"`,
    close: (target) => `✓ Jabatan mirip target Anda "${target}"`,
    partial: (target) => `~ Jabatan sebagian mirip target Anda "${target}"`,
    differs: "✗ Jabatan berbeda dari target Anda",
    none: "· Belum ada target jabatan",
  },
  location: {
    remote_in_country: "✓ Remote di negara Anda",
    remote_anywhere: "✓ Remote tanpa batas lokasi",
    location_match: "✓ Lokasi sesuai preferensi Anda",
    hybrid_same_country: "~ Hybrid di negara Anda, kota lain",
    remote_outside_region: "✗ Remote hanya di luar negara Anda",
    outside_locations: "✗ Lokasi di luar preferensi Anda",
  },
  seniority: (posting, user) => `Senioritas: lowongan ${posting}, Anda ${user}`,
  seniorityWords: {
    intern: "magang",
    junior: "junior",
    mid: "menengah",
    senior: "senior",
    lead: "lead",
    principal: "principal",
  },
  salary: {
    meets: "✓ Gaji memenuhi batas minimum Anda",
    slightly: "~ Gaji sedikit di bawah batas minimum Anda",
    below: "✗ Gaji di bawah batas minimum Anda",
  },
  languagesMet: (codes) => `✓ Bahasa: ${codes}`,
  languagesMissing: (codes) => `✗ Bahasa yang belum ada: ${codes}`,
  freshness: (days) => `~ Diposting ${days} hari lalu`,
  aiLevels: ["buruk", "lemah", "sebagian", "baik", "sangat baik"],
  aiFit: (label, confidence) =>
    confidence === null
      ? `Kecocokan AI: ${label}`
      : `Kecocokan AI: ${label} (keyakinan ${confidence}%)`,
  aiDeclined: "AI menolak menilai",
  aiStatus: {
    budget: "Pencocokan AI dijeda untuk bulan ini",
    error: "Penilaian AI gagal: hanya skor deterministik",
    dlq: "AI nonaktif: hanya skor deterministik",
    disabled: "Pencocokan AI dimatikan",
    skipped: "Tambahkan keahlian ke profil Anda agar pencocokan lebih baik",
  },
};

export const EXPLANATION_STRINGS: Readonly<Record<Locale, Strings>> = {
  en: EN,
  id: ID,
};

function band(score: number, s: Strings): string {
  if (score >= 80) {
    return s.bands.strong;
  }
  if (score >= 60) {
    return s.bands.good;
  }
  return score >= 40 ? s.bands.partial : s.bands.weak;
}

function list(items: readonly string[], max: number, s: Strings): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown}, ${s.more(items.length - max)}` : shown;
}

function skillsLine(
  skills: ScoreComponents["features"]["skills_overlap"],
  s: Strings
): string {
  if (!skills) {
    return s.skillsUnknown;
  }
  const total = skills.matched.length + skills.missing.length;
  const missing =
    skills.missing.length > 0
      ? `   ${s.skillsMissing(list(skills.missing, MAX_LISTED_MISSING, s))}`
      : "";
  if (skills.matched.length === 0) {
    return `✗ ${s.skillsNone(total)}${missing}`;
  }
  const mark = skills.value >= 0.5 ? "✓" : "~";
  return `${mark} ${s.skills(
    list(skills.matched, MAX_LISTED_MATCHED, s),
    skills.matched.length,
    total
  )}${missing}`;
}

function titleLine(
  title: ScoreComponents["features"]["title_similarity"],
  s: Strings
): string {
  if (!title) {
    return s.title.none;
  }
  const target = title.best_target ?? "";
  if (title.value >= 0.99) {
    return s.title.exact(target);
  }
  if (title.value >= 0.5) {
    return s.title.close(target);
  }
  return title.value > 0 ? s.title.partial(target) : s.title.differs;
}

function seniorityLine(
  seniority: NonNullable<ScoreComponents["features"]["seniority_fit"]>,
  s: Strings
): string {
  const word = (level: Seniority) =>
    level === "unknown" ? "?" : s.seniorityWords[level];
  let mark = "✗";
  if (seniority.value >= 0.99) {
    mark = "✓";
  } else if (seniority.value >= 0.6) {
    mark = "~";
  }
  return `${mark} ${s.seniority(word(seniority.posting), word(seniority.user))}`;
}

function salaryLine(value: number, s: Strings): string {
  if (value >= 0.99) {
    return s.salary.meets;
  }
  return value > 0 ? s.salary.slightly : s.salary.below;
}

function aiLine(ai: ScoreComponents["ai"], s: Strings): string {
  if (ai.status !== "ok") {
    return s.aiStatus[ai.status];
  }
  if (!ai.overall_fit) {
    return s.aiDeclined;
  }
  const level = Math.min(4, Math.max(0, Math.round(ai.overall_fit.score)));
  const confidence =
    ai.overall_fit.confidence === null
      ? null
      : Math.round(ai.overall_fit.confidence * 100);
  return s.aiFit(s.aiLevels[level], confidence);
}

/** The explanation of a stored score in `locale` (07 §5). */
export function explainScore(
  components: ScoreComponents,
  locale: Locale = "en"
): string {
  const s = EXPLANATION_STRINGS[locale] ?? EN;
  const lines: string[] = [
    `${components.score} · ${band(components.score, s)}`,
  ];
  const ordered = [...components.gates].sort(
    (a, b) => GATE_ORDER[a.level] - GATE_ORDER[b.level]
  );
  for (const gate of ordered) {
    lines.push(`${s.gateLevel[gate.level]}: ${s.gate[gate.predicate]}`);
  }
  const f = components.features;
  lines.push(skillsLine(f.skills_overlap, s));
  lines.push(titleLine(f.title_similarity, s));
  if (f.location_fit) {
    lines.push(
      s.location[f.location_fit.reason] ?? `· ${f.location_fit.reason}`
    );
  }
  if (f.seniority_fit) {
    lines.push(seniorityLine(f.seniority_fit, s));
  }
  if (f.salary_fit) {
    lines.push(salaryLine(f.salary_fit.value, s));
  }
  if (f.language_fit) {
    const codes = (items: string[]) =>
      items.map((code) => code.toUpperCase()).join(", ");
    lines.push(
      f.language_fit.missing.length === 0
        ? s.languagesMet(codes(f.language_fit.required))
        : s.languagesMissing(codes(f.language_fit.missing))
    );
  }
  if (f.freshness && f.freshness.value < 1) {
    lines.push(s.freshness(f.freshness.age_days));
  }
  lines.push(aiLine(components.ai, s));
  return lines.join("\n");
}
