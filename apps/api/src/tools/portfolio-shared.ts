// Shared building blocks for the per-user portfolio_* tool family
// (portfolio-management.ts / portfolio-projects.ts / portfolio-socials.ts).
//
// This is the per-user portfolio BUILDER — persisted in PORTFOLIO_KV as
// `portfolio:{id}`, ownership-scoped exactly like cv / invoice (the ownership
// guard checks `owner:portfolio:{id}`).
//
// The document shape mirrors apps/portfolio's `Portfolio` type verbatim
// (src/components/portfolio-data-model.ts), surfaced server-side as PortfolioData
// in ../types.ts, so a portfolio round-trips byte-for-byte between these tools,
// `GET/PUT /api/portfolio/:id`, and the builder app.

import { z } from "zod";
import { pdfUrl, text } from "../helpers";
import { APP_ORIGINS } from "../origins";
import type {
  PortfolioAffiliation,
  PortfolioCollaboration,
  PortfolioData,
  PortfolioProject,
} from "../types";

// The edit URL is the builder app; the print URL is the canonical
// `/portfolio/{slug}.pdf` route served from the api host (302 → print view).
export function portfolioEditUrl(id: string): string {
  // Canonical `?id=` form (the legacy `?portfolio=` still resolves in-app).
  return `${APP_ORIGINS.portfolio}/?id=${encodeURIComponent(id)}`;
}

export function portfolioPdfUrl(id: string): string {
  return pdfUrl("portfolio", id);
}

// Success envelope mirroring cv's saved(): confirm + the shareable edit URL so
// the caller always gets a link back without a second get_url round-trip.
export function portfolioSaved(message: string, id: string) {
  return text(`${message}\n\nEdit URL: ${portfolioEditUrl(id)}`);
}

// ── Shared Zod enums (Zod v3 here — keep v3-compatible) ──────────────────────
export const trackEnum = z
  .enum(["tech", "design", "domain"])
  .describe("Primary focus area: tech, design, or domain.");

export const projectTypeEnum = z
  .enum(["self-initiated", "class-assignment", "work-assignment"])
  .describe(
    "Whether the project was self-initiated or a class/work assignment."
  );

export const collaborationKindEnum = z
  .enum(["individual", "group"])
  .describe("individual, or group (then provide group_role).");

export const affiliationKindEnum = z
  .enum(["student", "alumni", "professional", "independent"])
  .describe(
    "The owner's background: student, alumni, professional, independent."
  );

export const mediaTypeEnum = z.enum(["image", "video"]);

// 16:9 ratio guard — mirrors isValidImageRatio() in the builder app. The slot is
// a fixed 16:9; reject anything else so the print layout never crops/letterboxes.
const IMAGE_RATIO = 16 / 9;
const IMAGE_RATIO_TOLERANCE = 0.01;

export function isValidImageRatio(width: number, height: number): boolean {
  return (
    height > 0 &&
    Math.abs(width / height - IMAGE_RATIO) <= IMAGE_RATIO_TOLERANCE
  );
}

// Build a discriminated-union Affiliation from a flat tool input. Only the
// fields relevant to `kind` are carried over (the rest are dropped), so the
// stored union is always well-formed.
export function buildAffiliation(input: {
  kind: PortfolioAffiliation["kind"];
  institution?: string;
  program?: string;
  semester?: number;
  graduation_year?: number;
  organization?: string;
  job_title?: string;
  years_experience?: number;
  note?: string;
}): PortfolioAffiliation {
  switch (input.kind) {
    case "student":
      return {
        kind: "student",
        institution: input.institution ?? "",
        program: input.program,
        semester: input.semester,
      };
    case "alumni":
      return {
        kind: "alumni",
        institution: input.institution ?? "",
        program: input.program,
        graduationYear: input.graduation_year,
      };
    case "professional":
      return {
        kind: "professional",
        organization: input.organization,
        jobTitle: input.job_title,
        yearsExperience: input.years_experience,
      };
    default:
      return { kind: "independent", note: input.note };
  }
}

// Build a Collaboration union from flat input. `group` requires a non-empty role
// (the builder app enforces the same invariant), so we fall back to "" only when
// the caller omitted it — callers should always pass group_role for groups.
export function buildCollaboration(
  kind: PortfolioCollaboration["kind"],
  teamSize?: number,
  groupRole?: string
): PortfolioCollaboration {
  if (kind === "group") {
    return { kind: "group", teamSize, role: groupRole ?? "" };
  }
  return { kind: "individual" };
}

// Find a project by id and return it plus its index, or null when absent.
export function findProject(
  portfolio: PortfolioData,
  id: string
): { project: PortfolioProject; index: number } | null {
  const index = portfolio.projects.findIndex((p) => p.id === id);
  if (index === -1) {
    return null;
  }
  return { project: portfolio.projects[index], index };
}

// Renumber project.order to a dense 1..N sequence after an add/remove so the
// "Project N of 5" labels in the print layout stay contiguous.
export function renumberProjects(portfolio: PortfolioData): void {
  portfolio.projects.forEach((project, i) => {
    project.order = i + 1;
  });
}
