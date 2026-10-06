import { cn } from "@rulisme/ui/lib/utils";
import { useFirstPaintEntrance } from "@rulisme/ui/lib/use-first-paint-entrance";
import { Button } from "@rulisme/ui/ui/button";
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
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { Input } from "@rulisme/ui/ui/input";
import { Label } from "@rulisme/ui/ui/label";
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
import { useTranslation } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/components/language-switcher";
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
      toast.error("Could not prepare PDF download. Try downloading again.", {
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
    toast.error(
      "Could not restore the saved invoice. Import a JSON export to recover it."
    );
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
    toast.error(
      "Could not save this invoice in the browser. Download a JSON copy to keep your changes."
    );
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
  if (auth) {
    return (
      <p className="text-micro text-primary">
        Signed in as {auth.email}. Edits to a loaded invoice save automatically.
      </p>
    );
  }
  if (hasToken) {
    return (
      <p className="text-destructive text-micro">
        Token not recognized — generate a new one.
      </p>
    );
  }
  return (
    <p className="text-micro text-muted-foreground">
      Optional. Without a token, edits stay in this browser only.
    </p>
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
  // Entrance plays on the first paint only; locale switches remount this
  // page and rely on the route cross-fade instead.
  const animateEntrance = useFirstPaintEntrance();

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
          throw new Error("Invoice not found");
        }
        return res.json() as Promise<InvoiceData>;
      })
      .then((loaded) => {
        setDataRaw(loaded);
        markSaved(loaded);
      })
      .catch((error: unknown) =>
        toast.error("Failed to load remote invoice.", {
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
        toast.error(
          "Invalid JSON file. Please select a valid Invoice JSON export."
        );
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
      toast.error("Failed to generate PDF.", {
        description: err instanceof Error ? err.message : "Please try again.",
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

  if (print) {
    return <InvoicePrintView data={data} loading={loading} />;
  }

  return (
    <>
      <a
        className="sr-only rounded-md bg-background px-4 py-2 font-medium text-body-sm outline-hidden focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:ring-2 focus:ring-ring"
        href="#main-content"
      >
        {t("a11y.skipToContent")}
      </a>
      <main
        className="route-view invoice-app-shell flex min-h-svh flex-col md:flex-row"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        <div
          className={cn(
            "invoice-no-print scrollbar-hide w-full border-border border-b md:h-svh md:w-1/2 md:overflow-y-auto md:border-r md:border-b-0",
            animateEntrance && "motion-enter"
          )}
        >
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-border border-b bg-background px-4 py-3 sm:px-6">
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
                  <ol className="space-y-2 text-muted-foreground text-xs">
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground text-micro">
                        1
                      </span>
                      <span>{t("mcp.step1")}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground text-micro">
                        2
                      </span>
                      <span>{t("mcp.step2")}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground text-micro">
                        3
                      </span>
                      <span>{t("mcp.step3")}</span>
                    </li>
                  </ol>
                  <Button asChild className="w-full" size="default">
                    <a href={MCP_URL} rel="noopener noreferrer" target="_blank">
                      {t("mcp.cta")}
                      <ArrowUpRight />
                    </a>
                  </Button>
                  <p className="text-micro text-muted-foreground">
                    {t("mcp.privacy")}
                  </p>
                  <div className="space-y-1.5 border-border border-t pt-3">
                    <Label htmlFor="inv-token">
                      Personal token (enables cloud save)
                    </Label>
                    <Input
                      autoComplete="off"
                      id="inv-token"
                      onChange={(e) => cloud.setToken(e.target.value)}
                      placeholder="Paste your token to save edits"
                      type="password"
                    />
                    <CloudAuthStatus
                      auth={cloud.auth}
                      hasToken={cloud.hasToken}
                    />
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
                    size="icon"
                    variant="ghost"
                  >
                    <Sparkles />
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
            <InvoiceForm data={data} onChange={setData} />
          </div>
        </div>
        <div
          className={cn(
            "invoice-preview-pane scrollbar-hide w-full bg-muted/50 md:h-svh md:w-1/2 md:overflow-y-auto",
            animateEntrance &&
              "motion-enter [animation-delay:var(--motion-stagger)]"
          )}
        >
          <div className="invoice-no-print flex flex-wrap items-center gap-1.5 border-border border-b bg-background px-4 py-3 sm:px-6">
            {invoiceId && cloud.hasToken ? (
              <span className="flex items-center gap-1 text-micro text-muted-foreground">
                {cloud.status === "saving" ? (
                  <>
                    <Spinner className="[--spinner-size:12px]" />{" "}
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
                      <Spinner data-icon="inline-start" />
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
          <div className="invoice-preview-scroll p-4 sm:p-6">
            <InvoicePreview data={data} />
          </div>
        </div>
        {/* Floating download button — mobile only */}
        <div className="invoice-no-print fixed bottom-4 left-4 z-50 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("a11y.downloadInvoice")}
                className="rounded-full"
                disabled={isEmpty || generating}
                size="icon-lg"
              >
                {generating ? <Spinner /> : <Download />}
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
      <InvoicePreview data={data} />
    </div>
  );
}
