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
import { ThemeToggle } from "@/components/theme-toggle"
import { makeEmptyPortfolio, PortfolioForm } from "@/components/portfolio-form"
import { PortfolioPreview } from "@/components/portfolio-preview"
import type { Portfolio } from "@/components/portfolio-data-model"
import sampleData from "@/data/sample-portfolio.json"
import { useTranslation } from "@/i18n"
import { LanguageSwitcher } from "@/i18n/components/language-switcher"
import { useCloudSave } from "@/lib/use-cloud-save"

// In dev, target the local mcp Worker (`wrangler dev` on :8787) so end-to-end
// portfolio load/save is exercised without hitting production. In prod the
// public API host is used. MCP_URL is the human-facing host in the MCP guide.
const MCP_API = import.meta.env.DEV
  ? "http://localhost:8787"
  : "https://mcp.bahrul.me"
const MCP_URL = "https://mcp.bahrul.me"

// Local draft persistence (mirrors apps/cv-bahrul). Keeps an unsaved portfolio
// in localStorage so a client-side remount — e.g. switching the EN↔ID locale,
// which swaps the route — restores the in-progress document instead of losing it.
const STORAGE_KEY = "portfolio-data"

function loadSaved(): Portfolio | null {
  if (typeof window === "undefined") {
    return null
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return {
        ...makeEmptyPortfolio(),
        ...(JSON.parse(saved) as Partial<Portfolio>),
      }
    }
  } catch {
    /* ignore corrupt data */
  }
  return null
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null
let pendingSave: Portfolio | null = null

function saveImmediate(next: Portfolio) {
  if (typeof window === "undefined") {
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    pendingSave = null
  } catch {
    /* storage full / unavailable */
  }
}

function saveLocal(next: Portfolio) {
  pendingSave = next
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  saveTimeout = setTimeout(() => saveImmediate(next), 500)
}

function flushSave() {
  if (pendingSave) {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    saveImmediate(pendingSave)
  }
}

interface PortfolioGeneratorProps {
  portfolioId?: string
  print?: boolean
}

export function PortfolioGenerator({
  portfolioId,
  print,
}: PortfolioGeneratorProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<Portfolio>(makeEmptyPortfolio)
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<Portfolio | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEmpty =
    !data.owner.fullName.trim() && !data.projects.some((p) => p.title.trim())

  // Owner-authenticated optimistic persistence. Editing a loaded
  // `?portfolio=<slug>` while signed in writes through to PORTFOLIO_KV; a failed
  // save rolls `data` back.
  const cloud = useCloudSave<Portfolio>({
    apiBase: MCP_API,
    id: portfolioId,
    resource: "portfolio",
    onRollback: setData,
  })

  // Apply an edit optimistically and persist it to the local draft + cloud (the
  // cloud save is a no-op unless editing a signed-in `?portfolio=` slug).
  const applyChange = (next: Portfolio) => {
    const stamped: Portfolio = { ...next, updatedAt: new Date().toISOString() }
    setData(stamped)
    saveLocal(stamped)
    cloud.scheduleSave(stamped)
  }

  // Reset the editor to a blank document (confirm-gated). Clears the local
  // draft; uses the raw setter so a loaded remote portfolio is not wiped until
  // the user makes a deliberate edit.
  const handleClearAll = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY)
    }
    setData(makeEmptyPortfolio())
    setConfirmOpen(false)
  }

  // Hydrate the local draft after mount (client only, to avoid an SSR mismatch).
  // Skipped when a `?portfolio=` slug is present — the cloud document is
  // authoritative.
  useEffect(() => {
    if (portfolioId) {
      return
    }
    const saved = loadSaved()
    if (saved) {
      setData(saved)
    }
  }, [portfolioId])

  useEffect(() => {
    window.addEventListener("beforeunload", flushSave)
    return () => {
      window.removeEventListener("beforeunload", flushSave)
      // Flush on unmount so switching the locale (which remounts the route)
      // doesn't drop an edit still sitting in the debounce window.
      flushSave()
    }
  }, [])

  const { markSaved } = cloud
  useEffect(() => {
    if (!portfolioId) {
      return
    }
    setLoading(true)
    fetch(`${MCP_API}/api/portfolio/${encodeURIComponent(portfolioId)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Portfolio not found")
        }
        return res.json() as Promise<Portfolio>
      })
      .then((loaded) => {
        setData(loaded)
        markSaved(loaded)
      })
      .catch((err) => console.error("Failed to load remote portfolio:", err))
      .finally(() => setLoading(false))
  }, [portfolioId, markSaved])

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as Portfolio
        const next = { ...makeEmptyPortfolio(), ...imported }
        // Overwriting a non-empty portfolio is destructive — confirm first.
        // An empty editor has nothing to lose, so import straight away.
        if (isEmpty) {
          applyChange(next)
        } else {
          setPendingImport(next)
        }
      } catch {
        alert(t("alert.invalidJson"))
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const confirmImport = () => {
    if (pendingImport) {
      applyChange(pendingImport)
    }
    setPendingImport(null)
  }

  const getFileName = (ext: string) => {
    const now = new Date()
    const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
    const name = data.owner.fullName
    return name
      ? `Portfolio-${name.replace(/\s+/g, "-")}-${dt}.${ext}`
      : `Portfolio-${dt}.${ext}`
  }

  const handleDownloadPDF = async () => {
    if (typeof window === "undefined") {
      return
    }
    setGenerating(true)
    try {
      const { pdf } = await import("@react-pdf/renderer")
      const { PortfolioDocument } = await import("@/components/portfolio-pdf")
      const blob = await pdf(<PortfolioDocument data={data} t={t} />).toBlob()
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

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = getFileName("json")
    a.click()
    URL.revokeObjectURL(url)
  }

  if (print) {
    return <PortfolioPrintView data={data} loading={loading} />
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
        href="#portfolio-main"
      >
        {t("a11y.skipToContent")}
      </a>
      <div
        className="pf-app-shell flex min-h-svh flex-col md:flex-row"
        id="portfolio-main"
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        <div className="pf-no-print scrollbar-hide h-svh w-full overflow-y-auto border-b border-border md:w-1/2 md:border-r md:border-b-0">
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
                    <Label htmlFor="portfolio-token">
                      {t("mcp.tokenLabel")}
                    </Label>
                    <Input
                      autoComplete="off"
                      id="portfolio-token"
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
                aria-label={t("a11y.importPortfolio")}
                className="hidden"
                onChange={handleImportJSON}
                ref={fileInputRef}
                type="file"
              />
              <Dialog
                onOpenChange={(open) => {
                  if (!open) {
                    setPendingImport(null)
                  }
                }}
                open={pendingImport !== null}
              >
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t("confirm.importTitle")}</DialogTitle>
                    <DialogDescription>
                      {t("confirm.importDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      onClick={() => setPendingImport(null)}
                      variant="outline"
                    >
                      {t("confirm.cancel")}
                    </Button>
                    <Button onClick={confirmImport}>
                      {t("confirm.replace")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("toolbar.prefill")}
                    onClick={() => applyChange(sampleData as Portfolio)}
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
            <PortfolioForm data={data} onChange={applyChange} />
          </div>
        </div>
        <div className="pf-preview-pane scrollbar-hide h-svh w-full overflow-y-auto bg-muted/50 md:w-1/2">
          <div className="pf-no-print flex flex-wrap items-center gap-1.5 border-b border-border bg-background px-4 py-3 sm:px-6">
            <span className="text-xs text-muted-foreground">
              {t("preview.documentLabel")}
            </span>
            {portfolioId && cloud.hasToken ? (
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
                  <DropdownMenuItem onClick={handleDownloadJSON}>
                    <FileJson className="mr-2 size-4" />
                    {t("toolbar.downloadJson")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="pf-preview-scroll p-4 sm:p-6">
            <PortfolioPreview data={data} />
          </div>
        </div>
        {/* Floating download button, mobile only */}
        <div className="pf-no-print fixed bottom-4 left-4 z-50 sm:bottom-6 sm:left-6 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("a11y.downloadPortfolio")}
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

// Standalone, chrome-free render of a single portfolio used by the public
// `/portfolio/<slug>.pdf` redirect (mcp 302s here with `?print=1`). The document
// is the SAME `<PortfolioPreview>` component the editor shows (fit disabled so it
// renders at true A4 landscape), so the printed PDF is byte-faithful to the web
// view. Once data + web fonts are ready it auto-invokes the browser print dialog.
function PortfolioPrintView({
  data,
  loading,
}: {
  data: Portfolio
  loading: boolean
}) {
  const printed = useRef(false)
  const ready =
    !loading &&
    (data.owner.fullName.trim().length > 0 || data.projects.length > 0)

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
    <div className="pf-print-root">
      <PortfolioPreview data={data} fit={false} />
    </div>
  )
}
