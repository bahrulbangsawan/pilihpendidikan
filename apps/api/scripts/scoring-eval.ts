// Scoring evaluation (07 §13): runs rubric r1 over the synthetic golden set
// (`test/fixtures/scoring-golden.jsonl`, 200 labelled pairs over 5 synthetic
// profiles) and reports
//
//   - Spearman ρ between the score and the label (target ≥ 0.6);
//   - precision of "score ≥ 85" for good / excellent labels (target ≥ 0.85,
//     it gates `auto`);
//   - per-predicate gate precision at p ≥ 0.8 (target ≥ 0.9);
//   - the provider cost of the run.
//
// MANUAL and LIVE: it calls the real Decisions API (about $0.05 for the full
// set) and is never part of `bun test` or CI. Run it before changing weights
// or the rubric, then commit the report.
//
//   OPENAI_API_KEY=sk-… bun scripts/scoring-eval.ts            # live, print
//   OPENAI_API_KEY=sk-… bun scripts/scoring-eval.ts --write    # + docs/scoring-eval/<date>.md
//   bun scripts/scoring-eval.ts --fake                         # offline dry run (fake provider)
//   options: --fixture <path> --limit <n> --concurrency <n> (default 5)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  GatePredicate,
  ScoringProfile,
} from "@pilihpendidikan/jobs-contracts/scoring";
import {
  GATE_PREDICATES,
  ScoringProfileSchema,
} from "@pilihpendidikan/jobs-contracts/scoring";
import type { AiProvider } from "../src/jobs/ai/provider";
import { getAiProvider } from "../src/jobs/ai/provider";
import type { AiUsage } from "../src/jobs/ai/primitives";
import { sumUsage } from "../src/jobs/ai/primitives";
import type { AiOutcome } from "../src/jobs/services/scoring/combine";
import { assembleComponents } from "../src/jobs/services/scoring/combine";
import { postingView } from "../src/jobs/services/scoring/engine";
import type { PostingForScoring } from "../src/jobs/services/scoring/features";
import { computeFeatures } from "../src/jobs/services/scoring/features";

const DAY_MS = 86_400_000;
const LABELS = ["poor", "weak", "partial", "good", "excellent"] as const;
type Label = (typeof LABELS)[number];

export interface GoldenPair {
  gates: Record<GatePredicate, boolean>;
  id: string;
  label: Label;
  posting: Omit<
    PostingForScoring,
    "id" | "revision" | "posted_at" | "first_seen_at"
  > & {
    age_days: number;
  };
  profile: ScoringProfile;
}

/** The golden set: profile lines first, then pairs referencing them. */
export function loadGolden(path: string): GoldenPair[] {
  const profiles = new Map<string, ScoringProfile>();
  const pairs: GoldenPair[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row.kind === "profile") {
      profiles.set(String(row.id), ScoringProfileSchema.parse(row.profile));
      continue;
    }
    const profile = profiles.get(String(row.profile_id));
    if (!profile) {
      throw new Error(
        `pair ${String(row.id)} references unknown profile ${String(row.profile_id)}`
      );
    }
    if (!LABELS.includes(row.label as Label)) {
      throw new Error(`pair ${String(row.id)} has an unknown label`);
    }
    pairs.push({
      id: String(row.id),
      label: row.label as Label,
      gates: row.gates as GoldenPair["gates"],
      posting: row.posting as GoldenPair["posting"],
      profile,
    });
  }
  return pairs;
}

/** The pair's posting as the scorer reads it, aged relative to `now`. */
export function postingFor(pair: GoldenPair, now: number): PostingForScoring {
  const { age_days: age, ...rest } = pair.posting;
  return {
    ...rest,
    id: `golden-${pair.id}`,
    revision: 1,
    posted_at: now - age * DAY_MS,
    first_seen_at: now - age * DAY_MS,
  };
}

function ranks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) {
      j += 1;
    }
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      out[order[k].index] = rank;
    }
    i = j + 1;
  }
  return out;
}

/** Spearman's ρ (Pearson correlation of the average ranks). */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) {
    return Number.NaN;
  }
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? Number.NaN : num / Math.sqrt(dx * dy);
}

export interface PairResult {
  id: string;
  label: Label;
  predicates: Partial<Record<GatePredicate, number | null>>;
  score: number;
}

export interface EvalReport {
  autoPrecision: number | null;
  autoPredicted: number;
  gatePrecision: Record<
    GatePredicate,
    { precision: number | null; predicted: number }
  >;
  pairs: number;
  results: PairResult[];
  spearman: number;
  usage: AiUsage;
}

async function inPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await task(item);
      }
    })
  );
}

/** Scores every pair with `ai` and computes the 07 §13 metrics. */
export async function evaluate(
  pairs: readonly GoldenPair[],
  ai: AiProvider,
  options: { concurrency?: number; now: number }
): Promise<EvalReport> {
  const usages: AiUsage[] = [];
  const results: PairResult[] = [];
  await inPool(pairs, options.concurrency ?? 5, async (pair) => {
    const posting = postingFor(pair, options.now);
    const features = computeFeatures(pair.profile, posting, options.now);
    const answer = await ai.scorePosting({
      askSensitive: true,
      profile: pair.profile,
      posting: postingView(posting),
    });
    usages.push(answer.usage);
    const outcome: AiOutcome = {
      status: "ok",
      overall_fit: answer.overall_fit,
      predicates: answer.predicates,
      refused: answer.refused,
    };
    const components = assembleComponents(features, outcome, 1);
    results.push({
      id: pair.id,
      label: pair.label,
      score: components.score,
      predicates: answer.predicates,
    });
  });
  results.sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(pairs.map((pair) => [pair.id, pair]));
  const auto = results.filter((r) => r.score >= 85);
  const autoHits = auto.filter(
    (r) => r.label === "good" || r.label === "excellent"
  );
  const gatePrecision = {} as EvalReport["gatePrecision"];
  for (const predicate of GATE_PREDICATES) {
    const predicted = results.filter(
      (r) => (r.predicates[predicate] ?? 0) >= 0.8
    );
    const correct = predicted.filter(
      (r) => byId.get(r.id)?.gates[predicate] === true
    );
    gatePrecision[predicate] = {
      predicted: predicted.length,
      precision:
        predicted.length > 0 ? correct.length / predicted.length : null,
    };
  }
  return {
    pairs: results.length,
    results,
    spearman: spearman(
      results.map((r) => r.score),
      results.map((r) => LABELS.indexOf(r.label))
    ),
    autoPredicted: auto.length,
    autoPrecision: auto.length > 0 ? autoHits.length / auto.length : null,
    gatePrecision,
    usage: sumUsage(usages),
  };
}

const fmt = (value: number | null) =>
  value === null || Number.isNaN(value) ? "n/a" : value.toFixed(3);

/** The committed Markdown report (docs/scoring-eval/<date>.md). */
export function reportMarkdown(
  report: EvalReport,
  meta: { date: string; mode: string }
): string {
  const lines = [
    `# Scoring eval ${meta.date} (rubric r1, ${meta.mode})`,
    "",
    `- Pairs: ${report.pairs}`,
    `- Spearman ρ (score vs label): ${fmt(report.spearman)} (target ≥ 0.6)`,
    `- Precision of score ≥ 85 for good/excellent: ${fmt(report.autoPrecision)} over ${report.autoPredicted} pairs (target ≥ 0.85)`,
    ...GATE_PREDICATES.map(
      (p) =>
        `- Gate precision ${p} at p ≥ 0.8: ${fmt(report.gatePrecision[p].precision)} over ${report.gatePrecision[p].predicted} (target ≥ 0.9)`
    ),
    `- Cost: ${report.usage.cost_micro_usd} micro-USD (${report.usage.input_tokens} input tokens)`,
    "",
    "| Label | Pairs | Mean score |",
    "|---|---|---|",
    ...LABELS.map((label) => {
      const scores = report.results
        .filter((r) => r.label === label)
        .map((r) => r.score);
      const mean =
        scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : Number.NaN;
      return `| ${label} | ${scores.length} | ${fmt(mean)} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: readonly string[]): Promise<void> {
  const fake = args.includes("--fake");
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!(fake || key)) {
    console.error(
      "scoring-eval calls the live Decisions API: set OPENAI_API_KEY (or pass --fake for a dry run)."
    );
    process.exit(2);
  }
  const fixture = resolve(
    argValue(args, "--fixture") ??
      join(import.meta.dir, "../test/fixtures/scoring-golden.jsonl")
  );
  const limit = Number(argValue(args, "--limit") ?? "0");
  const all = loadGolden(fixture);
  const pairs = limit > 0 ? all.slice(0, limit) : all;
  const ai = getAiProvider({
    JOBS_AI_MODE: fake ? "fake" : "live",
    OPENAI_API_KEY: key,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  });
  const now = Date.now();
  const report = await evaluate(pairs, ai, {
    now,
    concurrency: Number(argValue(args, "--concurrency") ?? "5"),
  });
  const date = new Date(now).toISOString().slice(0, 10);
  const markdown = reportMarkdown(report, {
    date,
    mode: fake ? "fake provider" : "live gpt-6-luna",
  });
  console.log(markdown);
  if (args.includes("--write")) {
    const out = resolve(
      import.meta.dir,
      `../../../docs/scoring-eval/${date}.md`
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown);
    console.log(`wrote ${out}`);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
