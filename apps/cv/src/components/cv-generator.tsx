import { Button } from "@rulisme/ui/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@rulisme/ui/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu"
import { Input } from "@rulisme/ui/ui/input"
import { Label } from "@rulisme/ui/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@rulisme/ui/ui/tooltip"
import {
  ArrowUpRight,
  Cable,
  ChevronDown,
  Download,
  FileJson,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { type CVData, CVForm, type CVStyle } from "@/components/cv-form"
import { CVPreview } from "@/components/cv-preview"
import sampleData from "@/data/sample-cv.json"
import { useTranslation } from "@/i18n"
import { LanguageSwitcher } from "@/i18n/components/language-switcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { useCloudSave } from "@/lib/use-cloud-save"

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
}

// In dev, target the local mcp Worker (`wrangler dev` on :8787) so end-to-end
// CV load/save is exercised without hitting production. In prod the public API
// host is used. `MCP_URL` is the human-facing host shown in the MCP guide.
const MCP_API = import.meta.env.DEV
  ? "http://localhost:8787"
  : "https://mcp.bahrul.me"
const MCP_URL = "https://mcp.bahrul.me"

const TEMPLATES: CVStyle[] = ["basic", "harvard", "simple", "standard"]

// Local draft persistence (mirrors apps/invoice-bahrul). Keeps an unsaved CV in
// localStorage so a client-side remount — e.g. switching the EN↔ID locale, which
// swaps the route — restores the in-progress document instead of losing it.
const CV_STORAGE_KEY = "cv-data"

function loadSavedCv(): CVData | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const saved = localStorage.getItem(CV_STORAGE_KEY)
    if (saved) {
      return { ...initialData, ...(JSON.parse(saved) as Partial<CVData>) }
    }
  } catch {
    /* ignore corrupt data */
  }
  return null
}

let cvSaveTimeout: ReturnType<typeof setTimeout> | null = null
let cvPendingSave: CVData | null = null

function saveCvImmediate(next: CVData) {
  if (typeof window === "undefined") {
    return
  }
  try {
    localStorage.setItem(CV_STORAGE_KEY, JSON.stringify(next))
    cvPendingSave = null
  } catch {
    /* storage full / unavailable */
  }
}

function saveCvLocal(next: CVData) {
  cvPendingSave = next
  if (cvSaveTimeout) {
    clearTimeout(cvSaveTimeout)
  }
  cvSaveTimeout = setTimeout(() => saveCvImmediate(next), 500)
}

function flushCvSave() {
  if (cvPendingSave) {
    if (cvSaveTimeout) {
      clearTimeout(cvSaveTimeout)
    }
    saveCvImmediate(cvPendingSave)
  }
}

interface CVGeneratorProps {
  cvId?: string
  print?: boolean
  template?: CVStyle
}

export function CVGenerator({ cvId, print, template }: CVGeneratorProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<CVData>(initialData)
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEmpty = !data.personalInfo.fullName.trim()
  // The active template lives on the document so it round-trips into the saved
  // CV and the print/PDF view. A `?template=` query param overrides it (used to
  // preview a specific layout without persisting the choice).
  const style: CVStyle = template ?? data.style ?? "basic"

  // Owner-authenticated optimistic persistence. Editing a loaded `?cv=<slug>`
  // while signed in writes through to CV_KV; a failed save rolls `data` back.
  const cloud = useCloudSave<CVData>({
    apiBase: MCP_API,
    id: cvId,
    resource: "cv",
    onRollback: setData,
  })

  // Apply an edit optimistically and persist it to the local draft + cloud (the
  // cloud save is a no-op unless editing a signed-in `?cv=` slug).
  const applyChange = (next: CVData) => {
    setData(next)
    saveCvLocal(next)
    cloud.scheduleSave(next)
  }

  const handleStyleChange = (next: CVStyle) => {
    applyChange({ ...data, style: next })
  }

  // Reset the editor to a blank document (confirm-gated). Clears the local draft;
  // uses the raw setter so a loaded remote CV is not wiped until the user makes a
  // deliberate edit.
  const handleClearAll = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(CV_STORAGE_KEY)
    }
    setData(initialData)
    setConfirmOpen(false)
  }

  // Hydrate the local draft after mount (client only, to avoid an SSR mismatch).
  // Skipped when a `?cv=` slug is present — the cloud document is authoritative.
  // A truly fresh document seeds its section titles in the active locale so a
  // blank Indonesian CV reads in Indonesian; the titles are editable document
  // content, so any saved draft keeps whatever the user set.
  useEffect(() => {
    if (cvId) {
      return
    }
    const saved = loadSavedCv()
    if (saved) {
      setData(saved)
      return
    }
    setData({
      ...initialData,
      summaryTitle: t("placeholders.summaryTitle"),
      experienceTitle: t("placeholders.workExperience"),
      educationTitle: t("placeholders.education"),
      skillsTitle: t("placeholders.skills"),
      awardsTitle: t("placeholders.awards"),
      certificatesTitle: t("placeholders.certificates"),
      languagesTitle: t("placeholders.languages"),
      projectsTitle: t("placeholders.projects"),
      volunteerTitle: t("placeholders.volunteer"),
    })
  }, [cvId, t])

  useEffect(() => {
    window.addEventListener("beforeunload", flushCvSave)
    return () => {
      window.removeEventListener("beforeunload", flushCvSave)
      // Flush on unmount so switching the locale (which remounts the route)
      // doesn't drop an edit still sitting in the debounce window.
      flushCvSave()
    }
  }, [])

  const { markSaved } = cloud
  useEffect(() => {
    if (!cvId) {
      return
    }
    setLoading(true)
    fetch(`${MCP_API}/api/cv/${encodeURIComponent(cvId)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("CV not found")
        }
        return res.json() as Promise<CVData>
      })
      .then((loaded) => {
        setData(loaded)
        markSaved(loaded)
      })
      .catch((err) => console.error("Failed to load remote CV:", err))
      .finally(() => setLoading(false))
  }, [cvId, markSaved])

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as CVData
        applyChange(imported)
      } catch {
        alert(t("alert.invalidJson"))
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleDownloadPDF = async () => {
    if (typeof window === "undefined") {
      return
    }

    setGenerating(true)
    try {
      const { pdf } = await import("@react-pdf/renderer")
      const { CVDocument } = await import("@/components/cv-pdf")

      const blob = await pdf(<CVDocument data={data} style={style} />).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = getFileName("pdf")
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("PDF generation failed:", err)
      alert(t("alert.pdfFailed"))
    } finally {
      setGenerating(false)
    }
  }

  const getFileName = (ext: string) => {
    const now = new Date()
    const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
    const name = data.personalInfo.fullName
    return name
      ? `CV-${name.replace(/\s+/g, "-")}-${dt}.${ext}`
      : `CV-${dt}.${ext}`
  }

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadMarkdown = () => {
    const lines: string[] = []
    const { personalInfo } = data

    // Header
    if (personalInfo.fullName) {
      lines.push(`# ${personalInfo.fullName}`)
    }
    if (personalInfo.jobTitle) {
      lines.push(`**${personalInfo.jobTitle}**`)
    }

    const contact: string[] = []
    if (personalInfo.email) {
      contact.push(personalInfo.email)
    }
    if (personalInfo.phone) {
      contact.push(personalInfo.phone)
    }
    if (personalInfo.location) {
      contact.push(personalInfo.location)
    }
    if (personalInfo.linkedIn) {
      contact.push(`linkedin.com/in/${personalInfo.linkedIn}`)
    }
    if (contact.length) {
      lines.push("", contact.join(" | "))
    }

    // Summary
    if (data.summary) {
      lines.push("", `## ${data.summaryTitle}`, "", data.summary)
    }

    // Experience
    if (data.experience.length) {
      lines.push("", `## ${data.experienceTitle}`)
      for (const exp of data.experience) {
        const period = exp.current
          ? `${exp.startDate} – Present`
          : `${exp.startDate} – ${exp.endDate}`
        const tags = [exp.workType, exp.locationPolicy]
          .filter(Boolean)
          .join(" · ")
        lines.push(
          "",
          `### ${exp.title}, ${exp.company}`,
          `*${period}*${tags ? ` | ${tags}` : ""}`
        )
        if (exp.description) {
          for (const bullet of exp.description.split("\n")) {
            if (bullet.trim()) {
              lines.push(`- ${bullet.trim()}`)
            }
          }
        }
      }
    }

    // Education
    if (data.education.length) {
      lines.push("", `## ${data.educationTitle}`)
      for (const edu of data.education) {
        const period = edu.current
          ? `${edu.startDate} – Present`
          : `${edu.startDate} – ${edu.endDate}`
        lines.push(
          "",
          `### ${edu.degree}, ${edu.institution}`,
          `*${period}*${edu.category ? ` | ${edu.category}` : ""}`
        )
      }
    }

    // Skills
    if (data.skills.length) {
      lines.push("", `## ${data.skillsTitle}`)
      for (const cat of data.skills) {
        lines.push("", `**${cat.name}:** ${cat.items.join(", ")}`)
      }
    }

    // Awards
    if (data.awards.length) {
      lines.push("", `## ${data.awardsTitle}`)
      for (const award of data.awards) {
        lines.push("", `### ${award.title}`, `*${award.issuer}, ${award.date}*`)
        if (award.description) {
          lines.push("", award.description)
        }
      }
    }

    // Certificates
    if (data.certificates.length) {
      lines.push("", `## ${data.certificatesTitle}`)
      for (const cert of data.certificates) {
        const dateRange = [cert.date, cert.expiryDate]
          .filter(Boolean)
          .join(" – ")
        lines.push(
          `- **${cert.name}** (${cert.issuer}${dateRange ? `, ${dateRange}` : ""})`
        )
      }
    }

    // Languages
    if (data.languages.length) {
      lines.push("", `## ${data.languagesTitle}`)
      for (const lang of data.languages) {
        lines.push(`- ${lang.language}: ${lang.proficiency}`)
      }
    }

    // Projects
    if (data.projects.length) {
      lines.push("", `## ${data.projectsTitle}`)
      for (const proj of data.projects) {
        const link = proj.url ? ` (${proj.url})` : ""
        lines.push(
          `- **${proj.name}**${link}${proj.description ? `: ${proj.description}` : ""}`
        )
      }
    }

    // Volunteer
    if (data.volunteer.length) {
      lines.push("", `## ${data.volunteerTitle}`)
      for (const vol of data.volunteer) {
        const period = vol.current
          ? `${vol.startDate} – Present`
          : `${vol.startDate} – ${vol.endDate}`
        lines.push("", `### ${vol.role}, ${vol.organization}`, `*${period}*`)
        if (vol.description) {
          for (const bullet of vol.description.split("\n")) {
            if (bullet.trim()) {
              lines.push(`- ${bullet.trim()}`)
            }
          }
        }
      }
    }

    triggerDownload(lines.join("\n"), getFileName("md"), "text/markdown")
  }

  const handleDownloadJSON = () => {
    triggerDownload(
      JSON.stringify(data, null, 2),
      getFileName("json"),
      "application/json"
    )
  }

  if (print) {
    return <CVPrintView data={data} loading={loading} style={style} />
  }

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <a
        className="sr-only rounded-md bg-background px-4 py-2 text-sm font-medium outline-none focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:ring-2 focus:ring-ring"
        href="#cv-main"
      >
        {t("a11y.skipToContent")}
      </a>
      <div
        className="cv-app-shell flex min-h-svh flex-col md:flex-row"
        id="cv-main"
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        <div className="cv-no-print scrollbar-hide h-svh w-full overflow-y-auto border-b border-border md:w-1/2 md:border-r md:border-b-0">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-border bg-background px-4 py-3 sm:px-6">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="default" variant="outline">
                  <Cable data-icon="inline-start" />
                  <span>{t("toolbar.mcp")}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("mcp.title")}</DialogTitle>
                  <DialogDescription>{t("mcp.description")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <ol className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-medium text-foreground">
                        1
                      </span>
                      <span>{t("mcp.step1")}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-medium text-foreground">
                        2
                      </span>
                      <span>{t("mcp.step2")}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-medium text-foreground">
                        3
                      </span>
                      <span>{t("mcp.step3")}</span>
                    </li>
                  </ol>
                  <Button asChild className="w-full" size="default">
                    <a href={MCP_URL} rel="noreferrer" target="_blank">
                      {t("mcp.cta")}
                      <ArrowUpRight />
                    </a>
                  </Button>
                  <p className="text-micro text-muted-foreground">
                    {t("mcp.privacy")}
                  </p>
                  <div className="space-y-1.5 border-t border-border pt-3">
                    <Label htmlFor="cv-token">{t("mcp.tokenLabel")}</Label>
                    <Input
                      autoComplete="off"
                      id="cv-token"
                      onChange={(e) => cloud.setToken(e.target.value)}
                      placeholder={t("mcp.tokenPlaceholder")}
                      type="password"
                    />
                    {cloud.auth ? (
                      <p className="text-micro text-primary">
                        {t("mcp.signedInAs", { email: cloud.auth.email })}
                      </p>
                    ) : cloud.hasToken ? (
                      <p className="text-micro text-destructive">
                        {t("mcp.tokenNotRecognized")}
                      </p>
                    ) : (
                      <p className="text-micro text-muted-foreground">
                        {t("mcp.tokenOptional")}
                      </p>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("toolbar.importJson")}
                    onClick={() => fileInputRef.current?.click()}
                    size="icon"
                    variant="ghost"
                  >
                    <Upload />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("toolbar.importJson")}</TooltipContent>
              </Tooltip>
              <input
                accept=".json"
                aria-label={t("a11y.importCv")}
                className="hidden"
                onChange={handleImportJSON}
                ref={fileInputRef}
                type="file"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("toolbar.prefill")}
                    onClick={() => applyChange(sampleData as CVData)}
                    size="icon"
                    variant="ghost"
                  >
                    <Sparkles />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("toolbar.prefill")}</TooltipContent>
              </Tooltip>
              <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                      <Button
                        aria-label={t("toolbar.clearAll")}
                        disabled={isEmpty}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    </DialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("toolbar.clearAll")}</TooltipContent>
                </Tooltip>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t("confirm.title")}</DialogTitle>
                    <DialogDescription>
                      {t("confirm.description")}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      onClick={() => setConfirmOpen(false)}
                      variant="outline"
                    >
                      {t("confirm.cancel")}
                    </Button>
                    <Button onClick={handleClearAll} variant="destructive">
                      {t("confirm.confirm")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <ThemeToggle />
              <LanguageSwitcher />
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <CVForm data={data} onChange={applyChange} />
          </div>
        </div>
        <div className="cv-preview-pane scrollbar-hide h-svh w-full overflow-y-auto bg-muted/50 md:w-1/2">
          <div className="cv-no-print flex flex-wrap items-center gap-1.5 border-b border-border bg-background px-4 py-3 sm:px-6">
            <div className="flex gap-1">
              {TEMPLATES.map((s) => (
                <Button
                  key={s}
                  onClick={() => handleStyleChange(s)}
                  size="default"
                  variant={style === s ? "default" : "outline"}
                >
                  {t(`template.${s}`)}
                </Button>
              ))}
            </div>
            {cvId && cloud.hasToken ? (
              <span className="flex items-center gap-1 text-micro text-muted-foreground">
                {cloud.status === "saving" ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />{" "}
                    {t("status.saving")}
                  </>
                ) : null}
                {cloud.status === "saved" ? (
                  <span>{t("status.saved")}</span>
                ) : null}
                {cloud.status === "error" ? (
                  <span className="text-destructive">{cloud.error}</span>
                ) : null}
              </span>
            ) : null}
            <div className="ml-auto hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={isEmpty || generating} size="default">
                    {generating ? (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <Download data-icon="inline-start" />
                    )}
                    {generating
                      ? t("toolbar.generating")
                      : t("toolbar.download")}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDownloadPDF}>
                    <FileText className="mr-2 size-4" />
                    {t("toolbar.downloadPdf")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadMarkdown}>
                    <FileText className="mr-2 size-4" />
                    {t("toolbar.downloadMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadJSON}>
                    <FileJson className="mr-2 size-4" />
                    {t("toolbar.downloadJson")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="cv-preview-scroll p-4 sm:p-6">
            <CVPreview data={data} style={style} />
          </div>
        </div>
        {/* Floating download button, mobile only */}
        <div className="cv-no-print fixed bottom-4 left-4 z-50 sm:bottom-6 sm:left-6 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("a11y.downloadCv")}
                className="rounded-full"
                disabled={isEmpty || generating}
                size="icon-lg"
              >
                {generating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={handleDownloadPDF}>
                <FileText className="mr-2 size-4" />
                {t("toolbar.downloadPdf")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadMarkdown}>
                <FileText className="mr-2 size-4" />
                {t("toolbar.downloadMarkdown")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadJSON}>
                <FileJson className="mr-2 size-4" />
                {t("toolbar.downloadJson")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  )
}

// Standalone, chrome-free render of a single CV used by the public
// `/cv/<slug>.pdf` redirect (mcp 302s here with `?print=1`). The document is
// the SAME `<CVPreview>` component the editor shows, so the printed PDF is
// byte-faithful to the web view — there is no separate PDF renderer. Once the
// data and web fonts are ready it auto-invokes the browser print dialog so the
// `.pdf` URL behaves like a download.
function CVPrintView({
  data,
  style,
  loading,
}: {
  data: CVData
  style: CVStyle
  loading: boolean
}) {
  const printed = useRef(false)
  const ready = !loading && data.personalInfo.fullName.trim().length > 0

  useEffect(() => {
    if (!ready || printed.current || typeof window === "undefined") {
      return
    }
    printed.current = true
    const fire = () => window.print()
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts?.ready) {
      fonts.ready
        .then(() => window.setTimeout(fire, 150))
        .catch(() => window.setTimeout(fire, 150))
    } else {
      window.setTimeout(fire, 400)
    }
  }, [ready])

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="cv-print-root">
      <CVPreview data={data} style={style} />
    </div>
  )
}
