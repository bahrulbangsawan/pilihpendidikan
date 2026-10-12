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
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { Label } from "@rulisme/ui/ui/label";
import { Diamond } from "@rulisme/ui/ui/rails";
import { Spinner } from "@rulisme/ui/ui/spinner";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { makeEmptyPortfolio, PortfolioForm } from "@/components/portfolio-form";
import { PortfolioPreview } from "@/components/portfolio-preview";
import type { Portfolio } from "@/components/portfolio-data-model";
import sampleData from "@/data/sample-portfolio.json";
import { useTranslation } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/components/language-switcher";
import type { SaveStatus } from "@/lib/use-cloud-save";
import { useCloudSave } from "@/lib/use-cloud-save";

// In dev, target the local api Worker (`wrangler dev` on :8788, apps/api) so
// end-to-end portfolio load/save is exercised without hitting production. In
// prod the public API host is used. `MCP_URL` is the human-facing page linked
// from the MCP guide, where users sign in and mint a personal token.
const MCP_API = import.meta.env.DEV
  ? "http://localhost:8788"
  : "https://api.pilihpendidikan.com";
const MCP_URL = "https://api.pilihpendidikan.com/connect";

// The primary action's shortcut. Its <Kbd> hint sits inside the toolbar's
// "Download PDF" button and `useShortcut` makes it real (DESIGN.md §
// Components: never one without the other). Typing in a field never fires it.
const DOWNLOAD_SHORTCUT = "D";
// A shortcut never acts behind an open window (dialog, menu, select list).
const OPEN_WINDOW =
  "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]";

const MCP_STEPS = ["mcp.step1", "mcp.step2", "mcp.step3"] as const;

// Local draft persistence (mirrors apps/cv). Keeps an unsaved portfolio
// in localStorage so a client-side remount — e.g. switching the EN↔ID locale,
// which swaps the route — restores the in-progress document instead of losing it.
const STORAGE_KEY = "portfolio-data";

function loadSaved(): Portfolio | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return {
        ...makeEmptyPortfolio(),
        ...(JSON.parse(saved) as Partial<Portfolio>),
      };
    }
  } catch {
    /* ignore corrupt data */
  }
  return null;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSave: Portfolio | null = null;

function saveImmediate(next: Portfolio) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    pendingSave = null;
  } catch {
    /* storage full / unavailable */
  }
}

function saveLocal(next: Portfolio) {
  pendingSave = next;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => saveImmediate(next), 500);
}

function flushSave() {
  if (pendingSave) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveImmediate(pendingSave);
  }
}

interface PortfolioGeneratorProps {
  portfolioId?: string;
  print?: boolean;
}

export function PortfolioGenerator({
  portfolioId,
  print,
}: PortfolioGeneratorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<Portfolio>(makeEmptyPortfolio);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<Portfolio | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !(
    data.owner.fullName.trim() || data.projects.some((p) => p.title.trim())
  );
  const canDownload = !(isEmpty || generating);

  // Owner-authenticated optimistic persistence. Editing a loaded
  // `?portfolio=<slug>` while signed in writes through to PORTFOLIO_KV; a failed
  // save rolls `data` back.
  const cloud = useCloudSave<Portfolio>({
    apiBase: MCP_API,
    id: portfolioId,
    resource: "portfolio",
    onRollback: setData,
  });

  // Apply an edit optimistically and persist it to the local draft + cloud (the
  // cloud save is a no-op unless editing a signed-in `?portfolio=` slug).
  const applyChange = (next: Portfolio) => {
    const stamped: Portfolio = { ...next, updatedAt: new Date().toISOString() };
    setData(stamped);
    saveLocal(stamped);
    cloud.scheduleSave(stamped);
  };

  // Reset the editor to a blank document (confirm-gated). Clears the local
  // draft; uses the raw setter so a loaded remote portfolio is not wiped until
  // the user makes a deliberate edit.
  const handleClearAll = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    setData(makeEmptyPortfolio());
    setConfirmOpen(false);
  };

  // Hydrate the local draft after mount (client only, to avoid an SSR mismatch).
  // Skipped when a `?portfolio=` slug is present — the cloud document is
  // authoritative.
  useEffect(() => {
    if (portfolioId) {
      return;
    }
    const saved = loadSaved();
    if (saved) {
      setData(saved);
    }
  }, [portfolioId]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushSave);
    return () => {
      window.removeEventListener("beforeunload", flushSave);
      // Flush on unmount so switching the locale (which remounts the route)
      // doesn't drop an edit still sitting in the debounce window.
      flushSave();
    };
  }, []);

  const { markSaved } = cloud;
  useEffect(() => {
    if (!portfolioId) {
      return;
    }
    setLoading(true);
    // Bound the document load: a slow or unreachable MCP API would otherwise
    // leave the preview stranded on a perpetual spinner (a hung fetch never
    // settles, so `.finally` never clears `loading`). On timeout the request
    // aborts, the catch runs, and the editor falls back to its current document.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 12_000);
    fetch(`${MCP_API}/api/portfolio/${encodeURIComponent(portfolioId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Portfolio not found");
        }
        return res.json() as Promise<Portfolio>;
      })
      .then((loaded) => {
        setData(loaded);
        markSaved(loaded);
      })
      .catch((err) => console.error("Failed to load remote portfolio:", err))
      .finally(() => {
        clearTimeout(abortTimer);
        setLoading(false);
      });
  }, [portfolioId, markSaved]);

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(
          event.target?.result as string
        ) as Portfolio;
        const next = { ...makeEmptyPortfolio(), ...imported };
        // Overwriting a non-empty portfolio is destructive — confirm first.
        // An empty editor has nothing to lose, so import straight away.
        if (isEmpty) {
          applyChange(next);
        } else {
          setPendingImport(next);
        }
      } catch {
        toast.error(t("alert.invalidJson"), {
          duration: Number.POSITIVE_INFINITY,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const confirmImport = () => {
    if (pendingImport) {
      applyChange(pendingImport);
    }
    setPendingImport(null);
  };

  const getFileName = (ext: string) => {
    const now = new Date();
    const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const name = data.owner.fullName;
    return name
      ? `Portfolio-${name.replace(/\s+/g, "-")}-${dt}.${ext}`
      : `Portfolio-${dt}.${ext}`;
  };

  const handleDownloadPDF = async () => {
    // The browser PDF renderer must not enter the Workers SSR module graph.
    if (import.meta.env.SSR) {
      return;
    }
    setGenerating(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const { PortfolioDocument } = await import("@/components/portfolio-pdf");
      const blob = await pdf(<PortfolioDocument data={data} t={t} />).toBlob();
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

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getFileName("json");
    a.click();
    URL.revokeObjectURL(url);
  };

  // D downloads the PDF, exactly like the toolbar button that shows the hint.
  // It is off whenever that button is disabled, and in the print view.
  useShortcut(
    DOWNLOAD_SHORTCUT,
    () => {
      if (!document.querySelector(OPEN_WINDOW)) {
        handleDownloadPDF();
      }
    },
    canDownload && !print && !loading
  );

  if (print) {
    return <PortfolioPrintView data={data} loading={loading} />;
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
        className="sr-only rounded-md border border-border bg-popover px-3 py-2 text-foreground shadow-float focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        href="#portfolio-main"
      >
        {t("a11y.skipToContent")}
      </a>
      {/* The editor is a split view: two panes ruled by `line` hairlines, each
          headed by a 56px toolbar band (DESIGN.md § Implementation › Rails). */}
      <div
        className="pf-app-shell relative flex min-h-svh flex-col md:flex-row"
        id="portfolio-main"
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        <div className="pf-no-print no-scrollbar h-svh w-full overflow-y-auto border-line border-b md:w-1/2 md:border-r md:border-b-0">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-1 border-line border-b bg-background px-4 sm:px-6">
            <McpDialog
              auth={cloud.auth}
              hasToken={cloud.hasToken}
              onTokenChange={cloud.setToken}
            />
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
                aria-label={t("a11y.importPortfolio")}
                className="hidden"
                onChange={handleImportJSON}
                ref={fileInputRef}
                type="file"
              />
              <Dialog
                onOpenChange={(open) => {
                  if (!open) {
                    setPendingImport(null);
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
          <PortfolioForm data={data} onChange={applyChange} />
        </div>
        {/* The node where the toolbars' bottom rule crosses the pane divider. */}
        <span
          aria-hidden="true"
          className="pf-no-print pointer-events-none absolute top-14 left-1/2 z-20 hidden md:block"
        >
          <Diamond className="-top-1 -left-1" />
        </span>
        <div className="pf-preview-pane no-scrollbar graph-paper h-svh w-full overflow-y-auto md:w-1/2">
          <div className="pf-no-print sticky top-0 z-10 flex h-14 items-center gap-3 border-line border-b bg-background px-4 sm:px-6">
            <span className="type-caption min-w-0 truncate text-muted-foreground">
              {t("preview.documentLabel")}
            </span>
            {portfolioId && cloud.hasToken ? (
              <CloudStatus error={cloud.error} status={cloud.status} />
            ) : null}
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
                    onPdf={handleDownloadPDF}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
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
                disabled={!canDownload}
                size="icon-lg"
              >
                {generating ? <Spinner /> : <Download />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DownloadMenuItems
                onJson={handleDownloadJSON}
                onPdf={handleDownloadPDF}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}

// The MCP guide: three numbered steps, the token page, and the personal
// token field that turns on cloud save.
function McpDialog({
  auth,
  hasToken,
  onTokenChange,
}: {
  auth: { email: string } | null;
  hasToken: boolean;
  onTokenChange: (token: string) => void;
}) {
  const { t } = useTranslation();

  let tokenStatus = (
    <p className="type-caption text-muted-foreground">
      {t("mcp.tokenOptional")}
    </p>
  );
  if (auth) {
    tokenStatus = (
      <p className="type-caption text-foreground">
        {t("mcp.signedInAs", { email: auth.email })}
      </p>
    );
  } else if (hasToken) {
    tokenStatus = (
      <p className="type-caption text-destructive">
        {t("mcp.tokenNotRecognized")}
      </p>
    );
  }

  return (
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
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col gap-2">
            {MCP_STEPS.map((step, index) => (
              <li className="flex gap-2" key={step}>
                <span className="type-micro mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm bg-pane text-foreground tabular-nums">
                  {index + 1}
                </span>
                <span>{t(step)}</span>
              </li>
            ))}
          </ol>
          {/* The label names the full URL, so it wraps on narrow screens
              instead of widening the dialog. */}
          <Button
            asChild
            className="h-auto min-h-9 w-full whitespace-normal text-balance py-2 text-center"
          >
            <a href={MCP_URL} rel="noreferrer" target="_blank">
              {t("mcp.cta")}
              <ArrowUpRight data-icon="inline-end" />
            </a>
          </Button>
          <p className="type-caption text-muted-foreground">
            {t("mcp.privacy")}
          </p>
          <div className="flex flex-col gap-1.5 border-line border-t pt-3">
            <Label htmlFor="portfolio-token">{t("mcp.tokenLabel")}</Label>
            <Input
              autoComplete="off"
              id="portfolio-token"
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder={t("mcp.tokenPlaceholder")}
              type="password"
            />
            {tokenStatus}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Cloud-save status for a loaded `?portfolio=` document, a caption-role
// status line beside the document label.
function CloudStatus({
  status,
  error,
}: {
  status: SaveStatus;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <span className="type-caption flex shrink-0 items-center gap-1.5 text-muted-foreground">
      {status === "saving" ? (
        <>
          <Spinner />
          {t("status.saving")}
        </>
      ) : null}
      {status === "saved" ? <span>{t("status.saved")}</span> : null}
      {status === "error" ? (
        <span className="text-destructive">{error}</span>
      ) : null}
    </span>
  );
}

// The "Download as" rows, shared by the toolbar's format menu and the mobile
// floating button. The PDF row repeats the D shortcut.
function DownloadMenuItems({
  onPdf,
  onJson,
}: {
  onPdf: () => void;
  onJson: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem aria-keyshortcuts={DOWNLOAD_SHORTCUT} onClick={onPdf}>
        <FileText />
        {t("toolbar.downloadPdf")}
        <DropdownMenuShortcut aria-hidden="true">
          {DOWNLOAD_SHORTCUT}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onJson}>
        <FileJson />
        {t("toolbar.downloadJson")}
      </DropdownMenuItem>
    </>
  );
}

// Standalone, chrome-free render of a single portfolio used by the public
// `/portfolio/<slug>.pdf` redirect (apps/api 302s here with `?print=1`). The
// document is the SAME `<PortfolioPreview>` component the editor shows (fit
// disabled so it renders at true A4 landscape), so the printed PDF is
// byte-faithful to the web view. Once data + web fonts are ready it
// auto-invokes the browser print dialog.
function PortfolioPrintView({
  data,
  loading,
}: {
  data: Portfolio;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const printed = useRef(false);
  const ready =
    !loading &&
    (data.owner.fullName.trim().length > 0 || data.projects.length > 0);

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
    <div className="pf-print-root graph-paper">
      <PortfolioPreview data={data} fit={false} />
    </div>
  );
}
