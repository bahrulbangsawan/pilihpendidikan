import { formatCvMarkdown } from "@pilihpendidikan/cv-engine/markdown";
import type { CVData, CVStyle } from "@pilihpendidikan/cv-engine/types";
import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { Button } from "@rulisme/ui/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@rulisme/ui/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@rulisme/ui/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Label } from "@rulisme/ui/ui/label";
import { Diamond } from "@rulisme/ui/ui/rails";
import { Spinner } from "@rulisme/ui/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@rulisme/ui/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import {
  ArrowUpRight,
  Cable,
  ChevronDown,
  Download,
  FileJson,
  FileText,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CVForm } from "@/components/cv-form";
import { CVPreview } from "@/components/cv-preview";
import sampleData from "@/data/sample-cv.json";
import { useTranslation } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { createBlankCv } from "@/lib/blank-cv";
import { useCloudSave } from "@/lib/use-cloud-save";

const initialData: CVData = createBlankCv();

// In dev, target the local api Worker (`wrangler dev` on :8788, apps/api) so
// end-to-end CV load/save is exercised without hitting production. In prod the
// public API host is used. `MCP_URL` is the human-facing page linked from the
// MCP guide, where users sign in and mint a personal token.
const MCP_API = import.meta.env.DEV
  ? "http://localhost:8788"
  : "https://api.pilihpendidikan.com";
const MCP_URL = "https://api.pilihpendidikan.com/connect";

const TEMPLATES: CVStyle[] = ["basic", "harvard", "simple", "standard"];

function isTemplate(value: string): value is CVStyle {
  return (TEMPLATES as string[]).includes(value);
}

const MCP_STEPS = ["mcp.step1", "mcp.step2", "mcp.step3"] as const;

// The primary action's shortcut. Its <Kbd> hint sits inside the toolbar's
// "Download PDF" button and `useShortcut` makes it real (DESIGN.md §
// Components: never one without the other). Typing in a field never fires it.
const DOWNLOAD_SHORTCUT = "D";
// A shortcut never acts behind an open window (dialog, menu, select list),
// nor on a focused select trigger, which reads letters as type-ahead.
const OPEN_WINDOW =
  "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]";
const TYPE_AHEAD_TRIGGER = "[role=combobox]";

function TokenStatus({
  email,
  hasToken,
}: {
  email?: string;
  hasToken: boolean;
}) {
  const { t } = useTranslation();
  if (email !== undefined) {
    return (
      <p className="type-caption text-foreground">
        {t("mcp.signedInAs", { email })}
      </p>
    );
  }
  if (hasToken) {
    return (
      <p className="type-caption text-destructive">
        {t("mcp.tokenNotRecognized")}
      </p>
    );
  }
  return (
    <p className="type-caption text-muted-foreground">
      {t("mcp.tokenOptional")}
    </p>
  );
}

// The "Download as" rows, shared by the toolbar's format menu and the mobile
// floating button. The PDF row repeats the D shortcut.
function DownloadMenuItems({
  onJson,
  onMarkdown,
  onPdf,
}: {
  onJson: () => void;
  onMarkdown: () => void;
  onPdf: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem aria-keyshortcuts={DOWNLOAD_SHORTCUT} onClick={onPdf}>
        <FileText aria-hidden="true" />
        {t("toolbar.downloadPdf")}
        <DropdownMenuShortcut aria-hidden="true">
          {DOWNLOAD_SHORTCUT}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onMarkdown}>
        <FileText aria-hidden="true" />
        {t("toolbar.downloadMarkdown")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onJson}>
        <FileJson aria-hidden="true" />
        {t("toolbar.downloadJson")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

// Local draft persistence (mirrors apps/invoice). Keeps an unsaved CV in
// localStorage so a client-side remount — e.g. switching the EN↔ID locale, which
// swaps the route — restores the in-progress document instead of losing it.
const CV_STORAGE_KEY = "cv-data";

function loadSavedCv(): CVData | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const saved = localStorage.getItem(CV_STORAGE_KEY);
    if (saved) {
      return { ...initialData, ...(JSON.parse(saved) as Partial<CVData>) };
    }
  } catch {
    /* ignore corrupt data */
  }
  return null;
}

let cvSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let cvPendingSave: CVData | null = null;

function saveCvImmediate(next: CVData) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(CV_STORAGE_KEY, JSON.stringify(next));
    cvPendingSave = null;
  } catch {
    /* storage full / unavailable */
  }
}

function saveCvLocal(next: CVData) {
  cvPendingSave = next;
  if (cvSaveTimeout) {
    clearTimeout(cvSaveTimeout);
  }
  cvSaveTimeout = setTimeout(() => saveCvImmediate(next), 500);
}

function flushCvSave() {
  if (cvPendingSave) {
    if (cvSaveTimeout) {
      clearTimeout(cvSaveTimeout);
    }
    saveCvImmediate(cvPendingSave);
  }
}

interface CVGeneratorProps {
  cvId?: string;
  print?: boolean;
  template?: CVStyle;
}

export function CVGenerator({ cvId, print, template }: CVGeneratorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<CVData>(initialData);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !data.personalInfo.fullName.trim();
  // The active template lives on the document so it round-trips into the saved
  // CV and the print/PDF view. A `?template=` query param overrides it (used to
  // preview a specific layout without persisting the choice).
  const style: CVStyle = template ?? data.style ?? "basic";

  // Owner-authenticated optimistic persistence. Editing a loaded `?cv=<slug>`
  // while signed in writes through to CV_KV; a failed save rolls `data` back.
  const cloud = useCloudSave<CVData>({
    apiBase: MCP_API,
    id: cvId,
    resource: "cv",
    onRollback: setData,
  });

  // Apply an edit optimistically and persist it to the local draft + cloud (the
  // cloud save is a no-op unless editing a signed-in `?cv=` slug).
  const applyChange = (next: CVData) => {
    setData(next);
    saveCvLocal(next);
    cloud.scheduleSave(next);
  };

  const handleStyleChange = (next: CVStyle) => {
    applyChange({ ...data, style: next });
  };

  // Reset the editor to a blank document (confirm-gated). Clears the local draft;
  // uses the raw setter so a loaded remote CV is not wiped until the user makes a
  // deliberate edit.
  const handleClearAll = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(CV_STORAGE_KEY);
    }
    setData(initialData);
    setConfirmOpen(false);
  };

  // Hydrate the local draft after mount (client only, to avoid an SSR mismatch).
  // Skipped when a `?cv=` slug is present — the cloud document is authoritative.
  // A truly fresh document seeds its section titles in the active locale so a
  // blank Indonesian CV reads in Indonesian; the titles are editable document
  // content, so any saved draft keeps whatever the user set.
  useEffect(() => {
    if (cvId) {
      return;
    }
    const saved = loadSavedCv();
    if (saved) {
      setData(saved);
      return;
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
    });
  }, [cvId, t]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushCvSave);
    return () => {
      window.removeEventListener("beforeunload", flushCvSave);
      // Flush on unmount so switching the locale (which remounts the route)
      // doesn't drop an edit still sitting in the debounce window.
      flushCvSave();
    };
  }, []);

  const { markSaved } = cloud;
  useEffect(() => {
    if (!cvId) {
      return;
    }
    setLoading(true);
    // Bound the document load: a slow or unreachable MCP API would otherwise
    // leave the preview stranded on a perpetual spinner (a hung fetch never
    // settles, so `.finally` never clears `loading`). On timeout the request
    // aborts, the catch runs, and the editor falls back to its current document.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 12_000);
    fetch(`${MCP_API}/api/cv/${encodeURIComponent(cvId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("CV not found");
        }
        return res.json() as Promise<CVData>;
      })
      .then((loaded) => {
        setData(loaded);
        markSaved(loaded);
      })
      .catch((err) => console.error("Failed to load remote CV:", err))
      .finally(() => {
        clearTimeout(abortTimer);
        setLoading(false);
      });
  }, [cvId, markSaved]);

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as CVData;
        applyChange(imported);
      } catch {
        toast.error(t("alert.invalidJson"), {
          duration: Number.POSITIVE_INFINITY,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDownloadPDF = async () => {
    // The browser PDF renderer must not enter the Workers SSR module graph.
    if (import.meta.env.SSR) {
      return;
    }

    setGenerating(true);
    try {
      const [{ renderCvPdfBlob }, { registerCvPrint }] = await Promise.all([
        import("@pilihpendidikan/cv-engine/pdf"),
        import("@/lib/pdf-fonts"),
      ]);
      const blob = await renderCvPdfBlob(data, style, {
        registerFonts: registerCvPrint,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getFileName("pdf");
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error(t("alert.pdfFailed"), { duration: Number.POSITIVE_INFINITY });
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
    triggerDownload(formatCvMarkdown(data), getFileName("md"), "text/markdown");
  };

  const handleDownloadJSON = () => {
    triggerDownload(
      JSON.stringify(data, null, 2),
      getFileName("json"),
      "application/json"
    );
  };

  // D downloads the PDF, exactly like the toolbar button that shows the hint.
  // It is off whenever that button is disabled, and in the print view.
  const canDownload = !(isEmpty || generating);
  useShortcut(
    DOWNLOAD_SHORTCUT,
    (event) => {
      const onTypeAhead =
        event.target instanceof Element &&
        event.target.closest(TYPE_AHEAD_TRIGGER) !== null;
      if (!(onTypeAhead || document.querySelector(OPEN_WINDOW))) {
        handleDownloadPDF();
      }
    },
    canDownload && !print && !loading
  );

  if (print) {
    return <CVPrintView data={data} loading={loading} style={style} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner
          className="text-muted-foreground"
          label={t("a11y.loadingDocument")}
          size="md"
        />
      </div>
    );
  }

  return (
    <>
      <a
        className="type-body sr-only rounded-md border border-border bg-card px-3 py-2 text-foreground shadow-float focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
        href="#cv-main"
      >
        {t("a11y.skipToContent")}
      </a>
      <div
        className="cv-app-shell relative flex min-h-svh flex-col md:flex-row"
        id="cv-main"
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        {/* The node where the toolbars' bottom rule crosses the pane divider:
            56px down (minus half a node), on the divider's 1px rule. */}
        <Diamond className="cv-no-print top-13 left-1/2 z-20 -ml-1 hidden md:block" />
        <div className="cv-no-print no-scrollbar h-svh w-full overflow-y-auto border-line border-b md:w-1/2 md:border-r md:border-b-0">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-1.5 border-line border-b bg-background px-4 sm:px-6">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Cable data-icon="inline-start" />
                  {t("toolbar.mcp")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("mcp.title")}</DialogTitle>
                  <DialogDescription>{t("mcp.description")}</DialogDescription>
                </DialogHeader>
                <div className="flex min-w-0 flex-col gap-3">
                  <ol className="flex flex-col gap-2">
                    {MCP_STEPS.map((step, index) => (
                      <li className="flex gap-2.5" key={step}>
                        <span className="type-micro mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm bg-pane text-foreground tabular-nums">
                          {index + 1}
                        </span>
                        <span>{t(step)}</span>
                      </li>
                    ))}
                  </ol>
                  <Button asChild className="w-full">
                    <a href={MCP_URL} rel="noreferrer" target="_blank">
                      {/* The label names the URL; on a phone it truncates
                          rather than pushing the window wider than the
                          screen. */}
                      <span className="truncate">{t("mcp.cta")}</span>
                      <ArrowUpRight data-icon="inline-end" />
                    </a>
                  </Button>
                  <p className="type-caption text-muted-foreground">
                    {t("mcp.privacy")}
                  </p>
                  <div className="flex flex-col gap-1.5 border-line border-t pt-4">
                    <Label htmlFor="cv-token">{t("mcp.tokenLabel")}</Label>
                    <Input
                      autoComplete="off"
                      id="cv-token"
                      onChange={(e) => cloud.setToken(e.target.value)}
                      placeholder={t("mcp.tokenPlaceholder")}
                      type="password"
                    />
                    <TokenStatus
                      email={cloud.auth?.email}
                      hasToken={cloud.hasToken}
                    />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("toolbar.importJson")}
                    onClick={() => fileInputRef.current?.click()}
                    size="icon-sm"
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
                    size="icon-sm"
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
                        size="icon-sm"
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
          <CVForm data={data} onChange={applyChange} />
        </div>
        <div className="cv-preview-pane graph-paper no-scrollbar h-svh w-full overflow-y-auto md:w-1/2">
          <div className="cv-no-print sticky top-0 z-10 flex h-14 items-center gap-3 border-line border-b bg-background px-4 sm:px-6">
            <ToggleGroup
              aria-label={t("template.label")}
              onValueChange={(value) => {
                // A single toggle group reports "" when the pressed item is
                // clicked again; a template always stays selected.
                if (isTemplate(value)) {
                  handleStyleChange(value);
                }
              }}
              size="sm"
              type="single"
              value={style}
              variant="outline"
            >
              {TEMPLATES.map((s) => (
                <ToggleGroupItem key={s} value={s}>
                  {t(`template.${s}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {cvId && cloud.hasToken ? (
              <span className="type-caption flex items-center gap-1.5 text-muted-foreground">
                {cloud.status === "saving" ? (
                  <>
                    <Spinner className="[--spinner-size:12px]" />
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
            {/* The primary action, split: "Download PDF" downloads in one
                step (and carries the D hint); the chevron opens every
                format. */}
            <ButtonGroup
              aria-label={t("toolbar.download")}
              className="ml-auto hidden md:flex"
            >
              <Button
                aria-keyshortcuts={DOWNLOAD_SHORTCUT}
                disabled={!canDownload}
                onClick={handleDownloadPDF}
                size="sm"
              >
                {generating ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {generating
                  ? t("toolbar.generating")
                  : t("toolbar.downloadPdfShort")}
                <Kbd aria-hidden="true">{DOWNLOAD_SHORTCUT}</Kbd>
              </Button>
              <ButtonGroupSeparator />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={t("toolbar.moreFormats")}
                    disabled={!canDownload}
                    size="icon-sm"
                  >
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DownloadMenuItems
                    onJson={handleDownloadJSON}
                    onMarkdown={handleDownloadMarkdown}
                    onPdf={handleDownloadPDF}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
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
                disabled={!canDownload}
                size="icon-lg"
              >
                {generating ? <Spinner /> : <Download />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DownloadMenuItems
                onJson={handleDownloadJSON}
                onMarkdown={handleDownloadMarkdown}
                onPdf={handleDownloadPDF}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}

// Standalone, chrome-free render of a single CV used by the public
// `/cv/<slug>.pdf` redirect (apps/api 302s here with `?print=1`). The document
// is the SAME `<CVPreview>` component the editor shows, so the printed PDF is
// byte-faithful to the web view — there is no separate PDF renderer. Once the
// data and web fonts are ready it auto-invokes the browser print dialog so the
// `.pdf` URL behaves like a download.
function CVPrintView({
  data,
  style,
  loading,
}: {
  data: CVData;
  style: CVStyle;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const printed = useRef(false);
  const ready = !loading && data.personalInfo.fullName.trim().length > 0;

  useEffect(() => {
    if (!ready || printed.current || typeof window === "undefined") {
      return;
    }
    printed.current = true;
    const fire = () => window.print();
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready
        .then(() => window.setTimeout(fire, 150))
        .catch(() => window.setTimeout(fire, 150));
    } else {
      window.setTimeout(fire, 400);
    }
  }, [ready]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner
          className="text-muted-foreground"
          label={t("a11y.loadingDocument")}
          size="md"
        />
      </div>
    );
  }

  return (
    <div className="cv-print-root">
      <CVPreview data={data} style={style} />
    </div>
  );
}
