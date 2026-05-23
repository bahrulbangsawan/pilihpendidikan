import { Button } from "@rulisme/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@rulisme/ui/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Cable,
  ChevronDown,
  Download,
  FileJson,
  FileText,
  Loader2,
  Upload,
  UserRoundPen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type CVData, CVForm, type CVStyle } from "@/components/cv-form";
import { CVPreview } from "@/components/cv-preview";

import sampleData from "@/data/sample-cv.json";

export const Route = createFileRoute("/")({
  component: CVGenerator,
  validateSearch: (search: Record<string, unknown>) => ({
    cv: (search.cv as string) || undefined,
  }),
});

const initialData: CVData = {
  personalInfo: {
    fullName: "",
    jobTitle: "",
    email: "",
    phone: "",
    location: "",
    linkedIn: "",
    photoUrl: "",
    usePhoto: false,
  },
  sectionOrder: [
    "summary",
    "experience",
    "education",
    "skills",
    "awards",
    "certificates",
    "languages",
    "projects",
    "volunteer",
  ],
  summaryTitle: "Professional Summary",
  summary: "",
  experienceTitle: "Work Experience",
  experience: [],
  educationTitle: "Education",
  education: [],
  skillsTitle: "Skills",
  skills: [],
  awardsTitle: "Awards",
  awards: [],
  certificatesTitle: "Certificates",
  certificates: [],
  languagesTitle: "Languages",
  languages: [],
  projectsTitle: "Projects",
  projects: [],
  volunteerTitle: "Volunteer & Community",
  volunteer: [],
};

const MCP_API = "https://mcp.bahrul.me";
const MCP_URL = "https://mcp.bahrul.me";

function CVGenerator() {
  const { cv: cvId } = Route.useSearch();
  const [data, setData] = useState<CVData>(initialData);
  const [style, setStyle] = useState<CVStyle>("basic");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !data.personalInfo.fullName.trim();

  useEffect(() => {
    if (!cvId) {
      return;
    }
    setLoading(true);
    fetch(`${MCP_API}/api/cv/${encodeURIComponent(cvId)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("CV not found");
        }
        return res.json() as Promise<CVData>;
      })
      .then(setData)
      .catch((err) => console.error("Failed to load remote CV:", err))
      .finally(() => setLoading(false));
  }, [cvId]);

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as CVData;
        setData(imported);
      } catch {
        alert("Invalid JSON file. Please select a valid CV JSON export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDownloadPDF = async () => {
    if (typeof window === "undefined") {
      return;
    }

    setGenerating(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const { CVDocument } = await import("@/components/cv-pdf");

      const blob = await pdf(<CVDocument data={data} style={style} />).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getFileName("pdf");
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to generate PDF. Check the browser console for details.");
    } finally {
      setGenerating(false);
    }
  };

  const getFileName = (ext: string) => {
    const now = new Date();
    const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const name = data.personalInfo.fullName;
    return name
      ? `CV-${name.replace(/\s+/g, "-")}-${dt}.${ext}`
      : `CV-${dt}.${ext}`;
  };

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadMarkdown = () => {
    const lines: string[] = [];
    const { personalInfo } = data;

    // Header
    if (personalInfo.fullName) {
      lines.push(`# ${personalInfo.fullName}`);
    }
    if (personalInfo.jobTitle) {
      lines.push(`**${personalInfo.jobTitle}**`);
    }

    const contact: string[] = [];
    if (personalInfo.email) {
      contact.push(personalInfo.email);
    }
    if (personalInfo.phone) {
      contact.push(personalInfo.phone);
    }
    if (personalInfo.location) {
      contact.push(personalInfo.location);
    }
    if (personalInfo.linkedIn) {
      contact.push(`linkedin.com/in/${personalInfo.linkedIn}`);
    }
    if (contact.length) {
      lines.push("", contact.join(" | "));
    }

    // Summary
    if (data.summary) {
      lines.push("", `## ${data.summaryTitle}`, "", data.summary);
    }

    // Experience
    if (data.experience.length) {
      lines.push("", `## ${data.experienceTitle}`);
      for (const exp of data.experience) {
        const period = exp.current
          ? `${exp.startDate} – Present`
          : `${exp.startDate} – ${exp.endDate}`;
        const tags = [exp.workType, exp.locationPolicy]
          .filter(Boolean)
          .join(" · ");
        lines.push(
          "",
          `### ${exp.title} — ${exp.company}`,
          `*${period}*${tags ? ` | ${tags}` : ""}`
        );
        if (exp.description) {
          for (const bullet of exp.description.split("\n")) {
            if (bullet.trim()) {
              lines.push(`- ${bullet.trim()}`);
            }
          }
        }
      }
    }

    // Education
    if (data.education.length) {
      lines.push("", `## ${data.educationTitle}`);
      for (const edu of data.education) {
        const period = edu.current
          ? `${edu.startDate} – Present`
          : `${edu.startDate} – ${edu.endDate}`;
        lines.push(
          "",
          `### ${edu.degree} — ${edu.institution}`,
          `*${period}*${edu.category ? ` | ${edu.category}` : ""}`
        );
      }
    }

    // Skills
    if (data.skills.length) {
      lines.push("", `## ${data.skillsTitle}`);
      for (const cat of data.skills) {
        lines.push("", `**${cat.name}:** ${cat.items.join(", ")}`);
      }
    }

    // Awards
    if (data.awards.length) {
      lines.push("", `## ${data.awardsTitle}`);
      for (const award of data.awards) {
        lines.push(
          "",
          `### ${award.title}`,
          `*${award.issuer} — ${award.date}*`
        );
        if (award.description) {
          lines.push("", award.description);
        }
      }
    }

    // Certificates
    if (data.certificates.length) {
      lines.push("", `## ${data.certificatesTitle}`);
      for (const cert of data.certificates) {
        const dateRange = [cert.date, cert.expiryDate]
          .filter(Boolean)
          .join(" – ");
        lines.push(
          `- **${cert.name}** — ${cert.issuer}${dateRange ? ` (${dateRange})` : ""}`
        );
      }
    }

    // Languages
    if (data.languages.length) {
      lines.push("", `## ${data.languagesTitle}`);
      for (const lang of data.languages) {
        lines.push(`- ${lang.language}: ${lang.proficiency}`);
      }
    }

    // Projects
    if (data.projects.length) {
      lines.push("", `## ${data.projectsTitle}`);
      for (const proj of data.projects) {
        const link = proj.url ? ` — [${proj.url}](${proj.url})` : "";
        lines.push(
          `- **${proj.name}**${link}${proj.description ? `: ${proj.description}` : ""}`
        );
      }
    }

    // Volunteer
    if (data.volunteer.length) {
      lines.push("", `## ${data.volunteerTitle}`);
      for (const vol of data.volunteer) {
        const period = vol.current
          ? `${vol.startDate} – Present`
          : `${vol.startDate} – ${vol.endDate}`;
        lines.push("", `### ${vol.role} — ${vol.organization}`, `*${period}*`);
        if (vol.description) {
          for (const bullet of vol.description.split("\n")) {
            if (bullet.trim()) {
              lines.push(`- ${bullet.trim()}`);
            }
          }
        }
      }
    }

    triggerDownload(lines.join("\n"), getFileName("md"), "text/markdown");
  };

  const handleDownloadJSON = () => {
    triggerDownload(
      JSON.stringify(data, null, 2),
      getFileName("json"),
      "application/json"
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <h1 className="sr-only">
        CV Builder & Resume Generator — Bahrul Bangsawan
      </h1>
      <div className="h-svh w-full overflow-y-auto border-border border-b md:w-1/2 md:border-r md:border-b-0">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-border border-b bg-background px-4 py-3 sm:px-6">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="lg" variant="secondary">
                <Cable data-icon="inline-start" />
                <span className="hidden sm:inline">MCP Guide</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Connect via MCP</DialogTitle>
                <DialogDescription>
                  Manage your CV with any AI assistant. Ask it to{" "}
                  <strong className="text-foreground">"create a CV"</strong> or{" "}
                  <strong className="text-foreground">
                    "update my experience"
                  </strong>
                  . To save your CV and access it from any device, generate a
                  token at{" "}
                  <a
                    className="text-foreground underline underline-offset-2"
                    href={MCP_URL}
                    rel="noopener"
                    target="_blank"
                  >
                    mcp.bahrul.me
                  </a>
                  .
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <ol className="space-y-2 text-muted-foreground text-xs">
                  <li className="flex gap-2">
                    <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[10px] text-foreground">
                      1
                    </span>
                    <span>
                      Visit{" "}
                      <a
                        className="text-foreground underline underline-offset-2"
                        href={MCP_URL}
                        rel="noopener"
                        target="_blank"
                      >
                        mcp.bahrul.me
                      </a>{" "}
                      and sign in to generate your personal MCP token — required
                      to save your CVs to the cloud.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[10px] text-foreground">
                      2
                    </span>
                    <span>
                      Follow the client-specific setup on the guides page —
                      Claude Code, Cursor, Codex, Windsurf, Zed, and more.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[10px] text-foreground">
                      3
                    </span>
                    <span>
                      Paste your personal URL into your client and restart it.
                    </span>
                  </li>
                </ol>
                <Button asChild className="w-full" size="lg">
                  <a href={MCP_URL} rel="noopener" target="_blank">
                    Get my MCP token at mcp.bahrul.me
                    <ArrowUpRight className="size-4" />
                  </a>
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Your MCP URL is personal — keep it private.
                </p>
              </div>
            </DialogContent>
          </Dialog>
          <div className="ml-auto flex items-center gap-2">
            <Button
              onClick={() => fileInputRef.current?.click()}
              size="lg"
              variant="outline"
            >
              <Upload data-icon="inline-start" />
              <span className="hidden sm:inline">Import JSON</span>
            </Button>
            <input
              accept=".json"
              className="hidden"
              onChange={handleImportJSON}
              ref={fileInputRef}
              type="file"
            />
            <Button
              onClick={() => setData(sampleData as CVData)}
              size="lg"
              variant="outline"
            >
              <UserRoundPen data-icon="inline-start" />
              <span className="hidden sm:inline">Pre-Fill Example</span>
            </Button>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <CVForm data={data} onChange={setData} />
        </div>
      </div>
      <div className="h-svh w-full overflow-y-auto bg-muted/50 md:w-1/2">
        <div className="flex flex-wrap items-center gap-2 border-border border-b bg-muted/50 px-4 py-3 sm:px-6">
          <div className="flex gap-1">
            {(["basic", "harvard", "simple", "standard"] as const).map((s) => (
              <Button
                key={s}
                onClick={() => setStyle(s)}
                size="sm"
                variant={style === s ? "default" : "outline"}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
          <div className="ml-auto hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={isEmpty || generating} size="lg">
                  {generating ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {generating ? "Generating..." : "Download"}
                  <ChevronDown className="ml-1 size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadPDF}>
                  <FileText className="mr-2 size-4" />
                  Download as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadMarkdown}>
                  <FileText className="mr-2 size-4" />
                  Download as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadJSON}>
                  <FileJson className="mr-2 size-4" />
                  Download as JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <CVPreview data={data} style={style} />
        </div>
      </div>
      {/* Floating download button — mobile only */}
      <div className="fixed bottom-4 left-4 z-50 sm:bottom-6 sm:left-6 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="size-12 rounded-full shadow-lg"
              disabled={isEmpty || generating}
              size="icon"
            >
              {generating ? <Loader2 className="animate-spin" /> : <Download />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onClick={handleDownloadPDF}>
              <FileText className="mr-2 size-4" />
              Download as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadMarkdown}>
              <FileText className="mr-2 size-4" />
              Download as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadJSON}>
              <FileJson className="mr-2 size-4" />
              Download as JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
