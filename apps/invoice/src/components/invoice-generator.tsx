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
import {
  ArrowUpRight,
  Cable,
  ChevronDown,
  Download,
  FileJson,
  FileText,
  Loader2,
  Receipt,
  Trash2,
  Upload,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { InvoiceData } from "@/components/invoice-form";
import { InvoiceForm } from "@/components/invoice-form";
import sampleData from "@/data/sample-invoice.json";
import { useTranslation } from "@/i18n";
import { LanguageSwitcher } from "@/i18n/components/language-switcher";

const InvoicePreview = lazy(() =>
  import("@/components/invoice-preview").then((m) => ({
    default: m.InvoicePreview,
  }))
);

// Preload PDF renderer on idle so first download is instant
function preloadPdfRenderer() {
  const preload = () => {
    void import("@react-pdf/renderer");
    void import("@/components/invoice-pdf");
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
const MCP_URL = "https://mcp.bahrul.me";

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
    /* ignore corrupt data */
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
    /* storage full / unavailable */
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

function PreviewSkeleton() {
  return (
    <div className="invoice-page mx-auto animate-pulse">
      <div className="h-1 bg-muted" />
      <div className="p-8">
        <div className="h-6 w-24 rounded bg-muted" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-40 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-3 w-36 rounded bg-muted" />
        </div>
        <div className="my-6 border-muted border-t" />
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-2">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-3 w-36 rounded bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-3 w-36 rounded bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function InvoiceGenerator() {
  const { t, locale } = useTranslation();
  const [data, setDataRaw] = useState<InvoiceData>(initialData);

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const saved = loadSavedData();
    if (saved !== initialData) {
      setDataRaw(saved);
    } else {
      // Set today's date only on client to avoid server/client date mismatch
      setDataRaw((prev) => ({
        ...prev,
        dateOfIssue: new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date()),
      }));
    }
    preloadPdfRenderer();
    window.addEventListener("beforeunload", flushPendingSave);
    return () => window.removeEventListener("beforeunload", flushPendingSave);
  }, []);

  const setData = useCallback(
    (update: InvoiceData | ((prev: InvoiceData) => InvoiceData)) => {
      setDataRaw((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        saveData(next);
        return next;
      });
    },
    []
  );
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !data.from.companyName.trim() && data.items.length === 0;

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
        alert("Invalid JSON file. Please select a valid Invoice JSON export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDownloadPDF = async () => {
    if (import.meta.env.SSR) {
      return;
    }

    setGenerating(true);
    try {
      const { pdf } = await import("@react-pdf/renderer");
      const { InvoiceDocument } = await import("@/components/invoice-pdf");

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
      console.error("PDF generation failed:", err);
      alert("Failed to generate PDF. Check the browser console for details.");
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

  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:text-sm focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        href="#main-content"
      >
        {t("a11y.skipToContent")}
      </a>
      <main
        className="flex min-h-svh flex-col md:flex-row"
        id="main-content"
        tabIndex={-1}
      >
        <h1 className="sr-only">{t("meta.title")}</h1>
        <div className="w-full border-border border-b md:h-svh md:w-1/2 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="sticky top-0 z-10 flex items-center justify-end gap-1.5 border-border border-b bg-background px-3 py-2 sm:gap-2 sm:px-6 sm:py-3">
            <LanguageSwitcher />
            <Dialog>
              <DialogTrigger asChild>
                <Button className="h-8 sm:h-9" size="sm" variant="outline">
                  <Cable className="size-4 shrink-0" />
                  <span className="hidden sm:inline">
                    {t("toolbar.mcpGuide")}
                  </span>
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
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[10px] text-foreground">
                        1
                      </span>
                      <span>{t("mcp.step1")}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[10px] text-foreground">
                        2
                      </span>
                      <span>{t("mcp.step2")}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-[10px] text-foreground">
                        3
                      </span>
                      <span>{t("mcp.step3")}</span>
                    </li>
                  </ol>
                  <Button asChild className="w-full" size="lg">
                    <a href={MCP_URL} rel="noopener" target="_blank">
                      {t("mcp.cta")}
                      <ArrowUpRight className="size-4" />
                    </a>
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    {t("mcp.privacy")}
                  </p>
                </div>
              </DialogContent>
            </Dialog>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <Button
                className="h-8 sm:h-9"
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                variant="outline"
              >
                <Upload className="size-4 shrink-0" />
                <span className="hidden sm:inline">
                  {t("toolbar.importJson")}
                </span>
              </Button>
              <input
                accept=".json"
                className="hidden"
                onChange={handleImportJSON}
                ref={fileInputRef}
                type="file"
              />
              <Button
                className="h-8 sm:h-9"
                onClick={() => setData(sampleData as InvoiceData)}
                size="sm"
                variant="outline"
              >
                <Receipt className="size-4 shrink-0" />
                <span className="hidden sm:inline">
                  {t("toolbar.loadSample")}
                </span>
              </Button>
              <Button
                className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive sm:size-9"
                disabled={isEmpty}
                onClick={() => {
                  localStorage.removeItem(STORAGE_KEY);
                  setDataRaw(initialData);
                }}
                size="icon"
                variant="outline"
              >
                <Trash2 className="size-4" />
                <span className="sr-only">{t("toolbar.clearAll")}</span>
              </Button>
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <InvoiceForm data={data} onChange={setData} />
          </div>
        </div>
        <div className="w-full bg-muted/50 md:h-svh md:w-1/2 md:overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 border-border border-b bg-muted/50 px-3 py-2 sm:px-6 sm:py-3">
            <div className="ml-auto hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={isEmpty || generating} size="lg">
                    {generating ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {generating
                      ? t("toolbar.generating")
                      : t("toolbar.download")}
                    <ChevronDown className="ml-1 size-4" />
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
          <div className="p-4 sm:p-6">
            <Suspense fallback={<PreviewSkeleton />}>
              <InvoicePreview data={data} />
            </Suspense>
          </div>
        </div>
        {/* Floating download button — mobile only */}
        <div className="fixed bottom-4 left-4 z-50 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="size-11 rounded-full shadow-lg"
                disabled={isEmpty || generating}
                size="icon"
              >
                {generating ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Download className="size-5" />
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
        {/* Live region for screen reader announcements */}
        <div aria-live="polite" className="sr-only" role="status">
          {generating ? t("a11y.generatingPdf") : ""}
        </div>
      </main>
    </>
  );
}
