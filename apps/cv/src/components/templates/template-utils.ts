import type { CVData } from "@/components/cv-form";

export function getDescriptionLines(
  description: string | undefined
): { key: string; text: string }[] {
  const occurrences = new Map<string, number>();
  const lines: { key: string; text: string }[] = [];

  for (const line of description?.split("\n") ?? []) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const occurrence = (occurrences.get(text) ?? 0) + 1;
    occurrences.set(text, occurrence);
    lines.push({ key: JSON.stringify([text, occurrence]), text });
  }

  return lines;
}

export function formatOngoingEndDate(
  endDate: string,
  current: boolean,
  formatDate: (value: string) => string,
  presentLabel = "Present"
): string {
  if (current || !endDate) {
    return presentLabel;
  }
  return formatDate(endDate);
}

export function hasPreviewSectionContent(
  data: CVData,
  sectionId: CVData["sectionOrder"][number]
): boolean {
  switch (sectionId) {
    case "summary":
      return Boolean(data.summary);
    case "experience":
      return data.experience.some((entry) => entry.company || entry.title);
    case "education":
      return data.education.some((entry) => entry.institution || entry.degree);
    case "skills":
      return data.skills.some((category) => category.items.length > 0);
    case "awards":
      return data.awards.some((entry) => entry.title);
    case "certificates":
      return data.certificates.some((entry) => entry.name);
    case "languages":
      return data.languages.some((entry) => entry.language);
    case "projects":
      return data.projects.length > 0;
    case "volunteer":
      return data.volunteer.some((entry) => entry.organization || entry.role);
    default:
      return false;
  }
}
