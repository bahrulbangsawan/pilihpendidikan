import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import { cn } from "@rulisme/ui/lib/utils";
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
import { useSearch } from "@tanstack/react-router";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { InvoiceData } from "@/components/invoice-form";
import { InvoiceForm } from "@/components/invoice-form";
import { InvoicePreview } from "@/components/invoice-preview";
import { ThemeToggle } from "@/components/theme-toggle";
import sampleData from "@/data/sample-invoice.json";
import { translateNow, useTranslation } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/components/language-switcher";
import type { SaveStatus } from "@/lib/use-cloud-save";
import { useCloudSave } from "@/lib/use-cloud-save";

// Canonical ISO `yyyy-MM-dd` seed for a new invoice's issue date, matching what
// the mcp tools and createEmptyInvoice() persist (was "dd MMM yyyy"). [defect-1]
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Preload PDF renderer on idle so first download is instant
function preloadPdfRenderer() {
  // A compile-time guard also removes these browser-only imports from SSR.
  if (import.meta.env.SSR) {
    return;
  }
  const preload = async () => {
    try {
      await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/invoice-pdf"),
      ]);
    } catch (error) {
      toast.error(translateNow("errors.preloadFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  // Skip preload on slow connections
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (conn?.saveData || conn?.effectiveType === "2g") {
    return;
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 5000 });
  } else {
    setTimeout(preload, 3000);
  }
}

const STORAGE_KEY = "invoice-data";
// In dev, target the local api Worker (`wrangler dev` on :8788, apps/api) so
// end-to-end invoice load/save is exercised without hitting production. In prod
// the public API host is used. `MCP_URL` is the human-facing page linked from
// the MCP guide, where users sign in and mint a personal token.
const MCP_API = import.meta.env.DEV
  ? "http://localhost:8788"
  : "https://api.pilihpendidikan.com";
const MCP_URL = "https://api.pilihpendidikan.com/connect";

// The primary action's shortcut. Its <Kbd> hint sits inside the toolbar's
// "Download PDF" button and `useShortcut` makes it real (DESIGN.md §
// Components: never one without the other). Typing in a field never fires it.
const DOWNLOAD_SHORTCUT = "D";
// A shortcut never acts behind an open window (dialog, menu, date picker,
// select list).
const OPEN_WINDOW =
  "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]";

const MCP_STEPS = ["mcp.step1", "mcp.step2", "mcp.step3"] as const;

const initialData: InvoiceData = {
  invoiceNumber: "",
  dateOfIssue: "",
  dateDue: "",
  currency: "IDR",
  accentColor: "#f48120",
  from: {
    companyName: "",
    address: "",
    city: "",
    kecamatan: "",
    state: "",
    postalCode: "",
    country: "",
    email: "",
    logoUrl: "",
  },
  billTo: {
    name: "",
    address: "",
    city: "",
    kecamatan: "",
    stateRegion: "",
    postalCode: "",
    country: "",
    email: "",
  },
  items: [],
  adjustments: [],
  customFields: [],
  notes: "",
  taxRate: 0,
};

function loadSavedData(): InvoiceData {
  if (typeof window === "undefined") {
    return initialData;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...initialData, ...JSON.parse(saved) };
    }
  } catch {
    toast.error(translateNow("errors.restoreFailed"));
  }
  return initialData;
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSaveData: InvoiceData | null = null;

function saveDataImmediate(data: InvoiceData) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    pendingSaveData = null;
  } catch {
    toast.error(translateNow("errors.localSaveFailed"));
  }
}

function saveData(data: InvoiceData) {
  pendingSaveData = data;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => saveDataImmediate(data), 500);
}

function flushPendingSave() {
  if (pendingSaveData) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveDataImmediate(pendingSaveData);
  }
}

interface CloudAuthStatusProps {
  auth: { email: string } | null;
  hasToken: boolean;
}

function CloudAuthStatus({ auth, hasToken }: CloudAuthStatusProps) {
  const { t } = useTranslation();
  if (auth) {
    return (
      <p className="type-caption text-foreground">
        {t("mcp.signedInAs", { email: auth.email })}
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

interface McpDialogProps extends CloudAuthStatusProps {
  onTokenChange: (token: string) => void;
}

// The MCP guide: three numbered steps, the cobalt link to mint a token, and
// the optional personal-token field that turns on cloud save.
function McpDialog({ auth, hasToken, onTokenChange }: McpDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Cable aria-hidden="true" data-icon="inline-start" />
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
              <li className="flex gap-2.5" key={step}>
                <span className="type-micro mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm bg-pane text-foreground tabular-nums">
                  {index + 1}
                </span>
                <span>{t(step)}</span>
              </li>
            ))}
          </ol>
          <Button
            asChild
            className="h-auto min-h-9 w-full whitespace-normal py-2"
          >
            <a href={MCP_URL} rel="noopener noreferrer" target="_blank">
              {t("mcp.cta")}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
          <p className="type-caption text-muted-foreground">
            {t("mcp.privacy")}
          </p>
          <div className="flex flex-col gap-1.5 border-line border-t pt-3">
            <Label htmlFor="inv-token">{t("mcp.tokenLabel")}</Label>
            <Input
              autoComplete="off"
              id="inv-token"
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder={t("mcp.tokenPlaceholder")}
              type="password"
            />
            <CloudAuthStatus auth={auth} hasToken={hasToken} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CloudSaveStatusProps {
  status: SaveStatus;
  error: string | null;
}

// The preview toolbar's status line for a loaded, token-authorised invoice.
function CloudSaveStatus({ status, error }: CloudSaveStatusProps) {
  const { t } = useTranslation();
  return (
    <span className="type-caption flex min-w-0 items-center gap-1.5 text-muted-foreground">
      {status === "saving" ? (
        <>
          <Spinner />
          {t("status.saving")}
        </>
      ) : null}
      {status === "saved" ? <span>{t("status.saved")}</span> : null}
      {status === "error" ? (
        <span className="truncate text-destructive">{error}</span>
      ) : null}
    </span>
  );
}

interface DownloadMenuItemsProps {
  onPdf: () => void;
  onJson: () => void;
}

function DownloadMenuItems({ onPdf, onJson }: DownloadMenuItemsProps) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem aria-keyshortcuts={DOWNLOAD_SHORTCUT} onClick={onPdf}>
        <FileText aria-hidden="true" />
        {t("toolbar.downloadPdf")}
        <DropdownMenuShortcut aria-hidden="true">
          {DOWNLOAD_SHORTCUT}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onJson}>
        <FileJson aria-hidden="true" />
        {t("toolbar.downloadJson")}
      </DropdownMenuItem>
    </>
  );
}

// The document sheet resting on the editor's graph paper: a 1px hairline
// frames it on screen, and it prints bare at full width (the print CSS in
// styles.css prints `.invoice-page` alone). The empty state stays unframed.
function PreviewSheet({ data }: { data: InvoiceData }) {
  const hasDocument = Boolean(data.from.companyName) || data.items.length > 0;
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-2xl print:max-w-none",
        hasDocument && "border border-border print:border-0"
      )}
    >
      <InvoicePreview data={data} />
    </div>
  );
}

export function InvoiceGenerator() {
  const { t, locale } = useTranslation();
  // `?id=` is the canonical edit param; `?invoice=` is kept as a working alias.
  const { id, invoice, print } = useSearch({ strict: false }) as {
    id?: string;
    invoice?: string;
    print?: true;
  };
  const invoiceId = id ?? invoice;
  const [data, setDataRaw] = useState<InvoiceData>(initialData);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Owner-authenticated optimistic persistence for a loaded `?invoice=<slug>`.
  // A ref keeps the memoized `setData` stable while always calling the latest
  // scheduler (token/auth may change between renders).
  const cloud = useCloudSave<InvoiceData>({
    apiBase: MCP_API,
    id: invoiceId,
    resource: "invoice",
    onRollback: setDataRaw,
  });
  const scheduleSaveRef = useRef(cloud.scheduleSave);
  scheduleSaveRef.current = cloud.scheduleSave;

  // Hydrate after mount to avoid SSR mismatch. A `?invoice=` slug loads the
  // server-authoritative document from INVOICE_KV; otherwise fall back to the
  // localStorage scratch copy.
  useEffect(() => {
    if (invoiceId) {
      return;
    }
    const saved = loadSavedData();
    if (saved !== initialData) {
      setDataRaw(saved);
    } else {
      // Set today's date only on client to avoid server/client date mismatch
      setDataRaw((prev) => ({
        ...prev,
        dateOfIssue: todayIso(),
      }));
    }
  }, [invoiceId]);

  useEffect(() => {
    preloadPdfRenderer();
    window.addEventListener("beforeunload", flushPendingSave);
    return () => window.removeEventListener("beforeunload", flushPendingSave);
  }, []);

  const { markSaved } = cloud;
  useEffect(() => {
    if (!invoiceId) {
      return;
    }
    setLoading(true);
    fetch(`${MCP_API}/api/invoice/${encodeURIComponent(invoiceId)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(translateNow("errors.notFound"));
        }
        return res.json() as Promise<InvoiceData>;
      })
      .then((loaded) => {
        setDataRaw(loaded);
        markSaved(loaded);
      })
      .catch((error: unknown) =>
        toast.error(translateNow("errors.loadFailed"), {
          description: error instanceof Error ? error.message : undefined,
        })
      )
      .finally(() => setLoading(false));
  }, [invoiceId, markSaved]);

  const setData = useCallback(
    (update: InvoiceData | ((prev: InvoiceData) => InvoiceData)) => {
      setDataRaw((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        saveData(next);
        scheduleSaveRef.current(next);
        return next;
      });
    },
    []
  );
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !data.from.companyName.trim() && data.items.length === 0;
  const canDownload = !(isEmpty || generating);
  const showCloudStatus = Boolean(invoiceId) && cloud.hasToken;

  // Reset the editor to a blank invoice (confirm-gated).
  const handleClearAll = () => {
    localStorage.removeItem(STORAGE_KEY);
    setDataRaw(initialData);
    setConfirmOpen(false);
  };

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
        ) as InvoiceData;
        setData(imported);
      } catch {
        toast.error(t("errors.invalidJson"));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDownloadPDF = async () => {
    // The browser PDF renderer must not enter the Workers SSR module graph.
    // A compile-time guard also removes these browser-only imports from SSR.
    if (import.meta.env.SSR) {
      return;
    }

    setGenerating(true);
    try {
      const [{ pdf }, { InvoiceDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/invoice-pdf"),
      ]);

      const blob = await pdf(
        <InvoiceDocument data={data} locale={locale} />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getFileName("pdf");
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(t("errors.pdfFailed"), {
        description: err instanceof Error ? err.message : t("errors.tryAgain"),
      });
    } finally {
      setGenerating(false);
    }
  };

  const getFileName = (ext: string) => {
    const now = new Date();
    const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    return data.invoiceNumber
      ? `Invoice-${data.invoiceNumber}-${dt}.${ext}`
      : `Invoice-${dt}.${ext}`;
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
    return <InvoicePrintView data={data} loading={loading} />;
  }

  return (
    <>
      <a
        className="sr-only rounded-md border border-border bg-popover px-3 py-2 text-foreground shadow-float focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        href="#main-content"
      >
        {t("a11y.skipToContent")}
      </a>
      <main
        className="invoice-app-shell relative flex min-h-svh flex-col md:flex-row"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        {/* Form pane: a 56px toolbar band over the form's ruled sections. */}
        <div className="invoice-no-print no-scrollbar w-full border-line border-b md:h-svh md:w-1/2 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-1.5 border-line border-b bg-background px-4 sm:px-6">
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
                    <Upload aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("toolbar.importJson")}</TooltipContent>
              </Tooltip>
              <input
                accept=".json"
                aria-label={t("toolbar.importJson")}
                className="hidden"
                onChange={handleImportJSON}
                ref={fileInputRef}
                type="file"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("toolbar.loadSample")}
                    onClick={() => setData(sampleData as InvoiceData)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Sparkles aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("toolbar.loadSample")}</TooltipContent>
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
                        <Trash2 aria-hidden="true" />
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
          <InvoiceForm data={data} onChange={setData} />
        </div>
        {/* Preview pane: the same band, then the sheet on graph paper. */}
        <div className="invoice-preview-pane no-scrollbar graph-paper w-full md:h-svh md:w-1/2 md:overflow-y-auto">
          <div
            className={cn(
              "invoice-no-print h-14 items-center gap-3 border-line border-b bg-background px-4 sm:px-6 md:sticky md:top-0 md:z-10",
              showCloudStatus ? "flex" : "hidden md:flex"
            )}
          >
            {showCloudStatus ? (
              <CloudSaveStatus error={cloud.error} status={cloud.status} />
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
                  <Download aria-hidden="true" data-icon="inline-start" />
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
                    <ChevronDown aria-hidden="true" />
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
          <div className="invoice-preview-scroll p-4 sm:p-6">
            <PreviewSheet data={data} />
          </div>
        </div>
        {/* The node where the toolbar rule crosses the pane divider. */}
        <Diamond className="invoice-no-print top-[calc(3.5rem-var(--node)/2-0.5px)] left-[calc(50%-var(--node)/2-0.5px)] z-20 hidden md:block" />
        {/* Floating download button — mobile only */}
        <div className="invoice-no-print fixed bottom-4 left-4 z-50 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("a11y.downloadInvoice")}
                disabled={!canDownload}
                size="icon-lg"
              >
                {generating ? <Spinner /> : <Download aria-hidden="true" />}
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
        {/* Live region for screen reader announcements */}
        <output aria-live="polite" className="sr-only">
          {generating ? t("a11y.generatingPdf") : ""}
        </output>
      </main>
    </>
  );
}

// Standalone, chrome-free render of a single invoice used by the public
// `/invoice/<slug>.pdf` redirect (apps/api 302s here with `?print=1`). The
// document is the SAME `<InvoicePreview>` the editor shows, so the printed PDF
// is byte-faithful to the web view. Auto-prints once data + fonts are ready.
function InvoicePrintView({
  data,
  loading,
}: {
  data: InvoiceData;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const printed = useRef(false);
  const ready =
    !loading && (Boolean(data.from.companyName) || data.items.length > 0);

  useEffect(() => {
    if (!ready || printed.current || typeof window === "undefined") {
      return;
    }
    printed.current = true;
    const fire = () => window.print();
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      fonts.ready
        .then(() => window.setTimeout(fire, 200))
        .catch(() => window.setTimeout(fire, 200));
    } else {
      window.setTimeout(fire, 500);
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
    <div className="invoice-print-root">
      <PreviewSheet data={data} />
    </div>
  );
}
