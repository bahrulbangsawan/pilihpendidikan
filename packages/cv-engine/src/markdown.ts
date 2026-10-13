import type { CVData } from "./types";

function appendSection<T>(
  lines: string[],
  title: string,
  items: T[],
  format: (item: T) => string[]
): void {
  if (!items.length) {
    return;
  }
  lines.push("", `## ${title}`);
  for (const item of items) {
    lines.push(...format(item));
  }
}

function descriptionBullets(description: string): string[] {
  return description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line}`);
}

function formatPeriod(item: {
  current: boolean;
  startDate: string;
  endDate: string;
}): string {
  return `${item.startDate} – ${item.current ? "Present" : item.endDate}`;
}

function formatExperience(exp: CVData["experience"][number]): string[] {
  const tags = [exp.workType, exp.locationPolicy].filter(Boolean).join(" · ");
  const lines = [
    "",
    `### ${exp.title}, ${exp.company}`,
    `*${formatPeriod(exp)}*${tags ? ` | ${tags}` : ""}`,
  ];
  if (exp.description) {
    lines.push(...descriptionBullets(exp.description));
  }
  return lines;
}

function formatEducation(edu: CVData["education"][number]): string[] {
  return [
    "",
    `### ${edu.degree}, ${edu.institution}`,
    `*${formatPeriod(edu)}*${edu.category ? ` | ${edu.category}` : ""}`,
  ];
}

function formatAward(award: CVData["awards"][number]): string[] {
  const lines = ["", `### ${award.title}`, `*${award.issuer}, ${award.date}*`];
  if (award.description) {
    lines.push("", award.description);
  }
  return lines;
}

function formatCertificate(cert: CVData["certificates"][number]): string[] {
  const dateRange = [cert.date, cert.expiryDate].filter(Boolean).join(" – ");
  return [
    `- **${cert.name}** (${cert.issuer}${dateRange ? `, ${dateRange}` : ""})`,
  ];
}

function formatProject(project: CVData["projects"][number]): string[] {
  const link = project.url ? ` (${project.url})` : "";
  const description = project.description ? `: ${project.description}` : "";
  return [`- **${project.name}**${link}${description}`];
}

function formatVolunteer(volunteer: CVData["volunteer"][number]): string[] {
  const lines = [
    "",
    `### ${volunteer.role}, ${volunteer.organization}`,
    `*${formatPeriod(volunteer)}*`,
  ];
  if (volunteer.description) {
    lines.push(...descriptionBullets(volunteer.description));
  }
  return lines;
}

function appendHeader(
  lines: string[],
  personalInfo: CVData["personalInfo"]
): void {
  if (personalInfo.fullName) {
    lines.push(`# ${personalInfo.fullName}`);
  }
  if (personalInfo.jobTitle) {
    lines.push(`**${personalInfo.jobTitle}**`);
  }
  const contact = [
    personalInfo.email,
    personalInfo.phone,
    personalInfo.location,
    personalInfo.linkedIn ? `linkedin.com/in/${personalInfo.linkedIn}` : "",
  ].filter(Boolean);
  if (contact.length) {
    lines.push("", contact.join(" | "));
  }
}

export function formatCvMarkdown(data: CVData): string {
  const lines: string[] = [];
  appendHeader(lines, data.personalInfo);
  if (data.summary) {
    lines.push("", `## ${data.summaryTitle}`, "", data.summary);
  }
  appendSection(lines, data.experienceTitle, data.experience, formatExperience);
  appendSection(lines, data.educationTitle, data.education, formatEducation);
  appendSection(lines, data.skillsTitle, data.skills, (category) => [
    "",
    `**${category.name}:** ${category.items.join(", ")}`,
  ]);
  appendSection(lines, data.awardsTitle, data.awards, formatAward);
  appendSection(
    lines,
    data.certificatesTitle,
    data.certificates,
    formatCertificate
  );
  appendSection(lines, data.languagesTitle, data.languages, (language) => [
    `- ${language.language}: ${language.proficiency}`,
  ]);
  appendSection(lines, data.projectsTitle, data.projects, formatProject);
  appendSection(lines, data.volunteerTitle, data.volunteer, formatVolunteer);
  return lines.join("\n");
}
