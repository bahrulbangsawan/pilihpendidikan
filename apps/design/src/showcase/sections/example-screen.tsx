import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@rulisme/ui/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@rulisme/ui/ui/avatar";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@rulisme/ui/ui/input-group";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@rulisme/ui/ui/sidebar";
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rulisme/ui/ui/table";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  Cloud,
  Copy,
  Download,
  FileText,
  KeyRound,
  Palette,
  Trash2,
  User,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Section } from "../layout";

/* ── Settings model ────────────────────────────────────────────────────── */

const AUTOSAVE = {
  "30s": "Every 30 seconds",
  "5m": "Every 5 minutes",
  manual: "Only when I press Save",
} as const;

const EXPIRY = {
  never: "Never",
  "7d": "After 7 days",
  "30d": "After 30 days",
} as const;

type Autosave = keyof typeof AUTOSAVE;
type Expiry = keyof typeof EXPIRY;

interface CloudSettings {
  autosave: Autosave;
  cloudSave: boolean;
  expiry: Expiry;
  publicLink: boolean;
  slug: string;
}

const INITIAL_SETTINGS: CloudSettings = {
  cloudSave: true,
  autosave: "30s",
  publicLink: true,
  slug: "rina-wulandari",
  expiry: "never",
};

const SHARE_HOST = "cv.pilihpendidikan.com/";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COPIED_MS = 2000;

// A shortcut never acts behind a window or an open list.
const OPEN_LAYER =
  "[data-slot=dialog-content], [data-slot=alert-dialog-content], [data-slot=sheet-content], [data-slot=drawer-content], [data-slot=select-content]";

function sameSettings(a: CloudSettings, b: CloudSettings): boolean {
  return (
    a.cloudSave === b.cloudSave &&
    a.autosave === b.autosave &&
    a.publicLink === b.publicLink &&
    a.slug === b.slug &&
    a.expiry === b.expiry
  );
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// How each auto-save choice reads inside the saved-settings toast.
const AUTOSAVE_SUMMARY: Record<Autosave, string> = {
  "30s": "saved every 30 seconds",
  "5m": "saved every 5 minutes",
  manual: "saved when you press Save",
};

function summary(settings: CloudSettings): string {
  if (!settings.cloudSave) {
    return "Cloud copy off · kept in this browser only, no public link.";
  }
  const link = settings.publicLink
    ? `public link at ${SHARE_HOST}${settings.slug}`
    : "no public link";
  return `Cloud copy ${AUTOSAVE_SUMMARY[settings.autosave]} · ${link}.`;
}

/* ── Exports ───────────────────────────────────────────────────────────── */

type ExportStatus = "ready" | "shared" | "expired";

interface ExportRow {
  exported: string;
  file: string;
  format: "PDF" | "JSON";
  id: string;
  status: ExportStatus;
}

const STATUS_BADGE: Record<
  ExportStatus,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  ready: { label: "Ready", variant: "secondary" },
  shared: { label: "Shared", variant: "outline" },
  expired: { label: "Link expired", variant: "destructive" },
};

const INITIAL_EXPORTS: ExportRow[] = [
  {
    id: "pdf-1012",
    file: "rina-wulandari-cv.pdf",
    format: "PDF",
    exported: "12 Oct 2026, 14:32",
    status: "ready",
  },
  {
    id: "json-1012",
    file: "rina-wulandari-cv.json",
    format: "JSON",
    exported: "12 Oct 2026, 14:31",
    status: "ready",
  },
  {
    id: "pdf-1002",
    file: "cv-tokopedia-frontend.pdf",
    format: "PDF",
    exported: "2 Oct 2026, 09:15",
    status: "shared",
  },
  {
    id: "pdf-0914",
    file: "cv-gojek-internship.pdf",
    format: "PDF",
    exported: "14 Sep 2026, 20:48",
    status: "expired",
  },
];

function RecentExports() {
  const [rows, setRows] = useState(INITIAL_EXPORTS);
  // Clearing removes the focused button and exporting removes the empty
  // state's, so focus moves on to the control that replaces it.
  const pendingFocus = useRef(false);
  const focusIfPending = (node: HTMLButtonElement | null) => {
    if (node && pendingFocus.current) {
      pendingFocus.current = false;
      node.focus();
    }
  };

  const clearHistory = () => {
    const previous = rows;
    pendingFocus.current = true;
    setRows([]);
    toast("Export history cleared", {
      description: "The files stay in your downloads folder.",
      action: { label: "Undo", onClick: () => setRows(previous) },
    });
  };

  const exportPdf = () => {
    const now = new Date();
    const exported = `${now.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}, ${clockTime(now)}`;
    pendingFocus.current = true;
    setRows((current) => [
      {
        id: `pdf-${now.getTime()}`,
        file: "rina-wulandari-cv.pdf",
        format: "PDF",
        exported,
        status: "ready",
      },
      ...current,
    ]);
    toast.success("PDF exported", {
      description: "rina-wulandari-cv.pdf · 2 pages, A4",
    });
  };

  return (
    <section aria-labelledby="exports-title" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h4 className="type-subtitle weight-semibold" id="exports-title">
            Recent exports
          </h4>
          <p className="type-caption text-muted-foreground">
            Files you exported in the last 30 days.
          </p>
        </div>
        {rows.length > 0 ? (
          <Button
            onClick={clearHistory}
            ref={focusIfPending}
            size="sm"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            Clear history
          </Button>
        ) : null}
      </div>
      <div className="border border-line">
        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Exported</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-foreground">
                    <span className="flex items-center gap-2">
                      <FileText
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      {row.file}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.format}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.exported}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[row.status].variant}>
                      {STATUS_BADGE[row.status].label}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty className="graph-paper py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Download aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No exports yet</EmptyTitle>
              <EmptyDescription>
                PDFs and JSON files you export show up here for 30 days.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                onClick={exportPdf}
                ref={focusIfPending}
                size="sm"
                variant="outline"
              >
                <Download aria-hidden="true" data-icon="inline-start" />
                Export PDF
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </section>
  );
}

/* ── Danger zone ───────────────────────────────────────────────────────── */

function DangerZone({
  disabled,
  onDelete,
}: {
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <section
      aria-labelledby="danger-title"
      className="flex flex-col gap-3 border border-destructive/25 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="type-body weight-semibold" id="danger-title">
          Delete the cloud copy
        </h4>
        <p className="type-caption text-muted-foreground">
          Removes your CV from api.pilihpendidikan.com and turns the public link
          off. The copy in this browser stays.
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            className="shrink-0"
            disabled={disabled}
            variant="destructive"
          >
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            Delete cloud copy
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your cloud copy?</AlertDialogTitle>
            <AlertDialogDescription>
              Your CV leaves api.pilihpendidikan.com and anyone holding the
              public link sees a not-found page. You can't undo this; the copy
              in this browser stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the cloud copy</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} variant="destructive">
              Delete cloud copy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ── The form ──────────────────────────────────────────────────────────── */

function ShareLinkField({
  disabled,
  slug,
  onSlugChange,
}: {
  disabled: boolean;
  slug: string;
  onSlugChange: (slug: string) => void;
}) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const invalid = !SLUG_PATTERN.test(slug);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://${SHARE_HOST}${slug}`);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link stays selectable.
    }
  }

  return (
    <Field data-disabled={disabled} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>Link</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          {/* Phones keep only the slash (the description spells out the
              whole address). One child, so the addon's flex gap never splits
              the host from its slash. */}
          <InputGroupText>
            <span>
              <span className="max-sm:hidden">{SHARE_HOST.slice(0, -1)}</span>/
            </span>
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          aria-describedby={`${id}-help`}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          id={id}
          onChange={(event) => onSlugChange(event.target.value)}
          spellCheck={false}
          value={slug}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label={copied ? "Link copied" : "Copy link"}
            disabled={disabled || invalid}
            onClick={copyLink}
            size="icon-xs"
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {invalid ? (
        <FieldError id={`${id}-help`}>
          Use lowercase letters, numbers and single hyphens.
        </FieldError>
      ) : (
        <FieldDescription className="wrap-break-word" id={`${id}-help`}>
          Recruiters see your latest saved CV at{" "}
          <span className="text-foreground">
            {SHARE_HOST}
            {slug}
          </span>
          . Drafts stay private.
        </FieldDescription>
      )}
    </Field>
  );
}

function CloudSettingsForm({
  settings,
  onChange,
}: {
  settings: CloudSettings;
  onChange: (patch: Partial<CloudSettings>) => void;
}) {
  const id = useId();
  return (
    <FieldGroup className="gap-8">
      <FieldSet>
        <FieldLegend>Cloud save</FieldLegend>
        <Field orientation="horizontal">
          <Switch
            checked={settings.cloudSave}
            id={`${id}-cloud`}
            onCheckedChange={(cloudSave) => onChange({ cloudSave })}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${id}-cloud`}>
              Keep a copy in the cloud
            </FieldLabel>
            <FieldDescription>
              Every save also goes to your private copy on
              api.pilihpendidikan.com, so you can open the CV on any device.
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field data-disabled={!settings.cloudSave}>
          <FieldLabel htmlFor={`${id}-autosave`}>Auto-save</FieldLabel>
          <Select
            disabled={!settings.cloudSave}
            onValueChange={(autosave) =>
              onChange({ autosave: autosave as Autosave })
            }
            value={settings.autosave}
          >
            <SelectTrigger className="w-full sm:w-64" id={`${id}-autosave`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(AUTOSAVE).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Drafts in this browser save as you type either way.
          </FieldDescription>
        </Field>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Sharing</FieldLegend>
        <Field data-disabled={!settings.cloudSave} orientation="horizontal">
          <Switch
            checked={settings.publicLink}
            disabled={!settings.cloudSave}
            id={`${id}-public`}
            onCheckedChange={(publicLink) => onChange({ publicLink })}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${id}-public`}>
              Public read-only link
            </FieldLabel>
            <FieldDescription>
              Anyone with the link can read the CV. Nobody can edit it.
            </FieldDescription>
          </FieldContent>
        </Field>
        <ShareLinkField
          disabled={!(settings.cloudSave && settings.publicLink)}
          onSlugChange={(slug) => onChange({ slug })}
          slug={settings.slug}
        />
        <Field data-disabled={!(settings.cloudSave && settings.publicLink)}>
          <FieldLabel htmlFor={`${id}-expiry`}>Link expires</FieldLabel>
          <Select
            disabled={!(settings.cloudSave && settings.publicLink)}
            onValueChange={(expiry) => onChange({ expiry: expiry as Expiry })}
            value={settings.expiry}
          >
            <SelectTrigger className="w-full sm:w-64" id={`${id}-expiry`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(EXPIRY).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldSet>
    </FieldGroup>
  );
}

/* ── The window ────────────────────────────────────────────────────────── */

const PAGES: readonly {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    id: "profile",
    label: "Profile",
    icon: User,
    description: "Your name, photo and contact details.",
  },
  {
    id: "cloud",
    label: "Cloud save and sharing",
    icon: Cloud,
    description: "Where your CV is kept and who can read it.",
  },
  {
    id: "templates",
    label: "Templates",
    icon: Palette,
    description: "Harvard, Standard, Simple and Basic.",
  },
  {
    id: "tokens",
    label: "Personal tokens",
    icon: KeyRound,
    description: "Tokens that let an AI app read and edit your CV.",
  },
];

const CLOUD_PAGE = "cloud";
const SIDEBAR_STYLE = { "--sidebar-width": "14rem" } as CSSProperties;

function OtherPage({
  page,
  onBack,
}: {
  page: (typeof PAGES)[number];
  onBack: () => void;
}) {
  return (
    <Empty className="graph-paper min-h-96 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <page.icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{page.label}</EmptyTitle>
        <EmptyDescription>
          {page.description} This example builds out the cloud save page only.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onBack} size="sm" variant="outline">
          Back to cloud save
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function SettingsScreen() {
  const [page, setPage] = useState(CLOUD_PAGE);
  const [draft, setDraft] = useState(INITIAL_SETTINGS);
  const [saved, setSaved] = useState(INITIAL_SETTINGS);
  const [savedAt, setSavedAt] = useState("14:32");
  const formRef = useRef<HTMLDivElement>(null);

  const dirty = !sameSettings(draft, saved);
  const current = PAGES.find((item) => item.id === page) ?? PAGES[1];

  const update = (patch: Partial<CloudSettings>) =>
    setDraft((settings) => ({ ...settings, ...patch }));

  const save = () => {
    if (!SLUG_PATTERN.test(draft.slug)) {
      toast.error("Fix the link first", {
        description: "Use lowercase letters, numbers and single hyphens.",
      });
      formRef.current
        ?.querySelector<HTMLInputElement>("input[aria-invalid]")
        ?.focus();
      return;
    }
    const time = clockTime(new Date());
    setSaved(draft);
    setSavedAt(time);
    toast.success(dirty ? "Settings saved" : "Already up to date", {
      description: summary(draft),
    });
  };

  const discard = () => setDraft(saved);

  // The deletion takes effect at once, in both the saved settings and the
  // form; any other unsaved edit stays unsaved.
  const deleteCloudCopy = () => {
    const off = { cloudSave: false, publicLink: false };
    setDraft((settings) => ({ ...settings, ...off }));
    setSaved((settings) => ({ ...settings, ...off }));
    toast.success("Cloud copy deleted", {
      description: "Your CV is now kept in this browser only.",
    });
  };

  // V saves from anywhere on the page, like the button says, unless a
  // window or a list is open over the form.
  useShortcut("v", () => {
    if (page === CLOUD_PAGE && !document.querySelector(OPEN_LAYER)) {
      save();
    }
  });

  return (
    // overflow-clip, not overflow-hidden: a hidden overflow would make the
    // window a scroll container and pin the sticky save bar to it.
    <div className="flex flex-col overflow-clip border border-line bg-background">
      <div className="band flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <span className="type-body flex min-w-0 items-center gap-2 text-foreground">
          <FileText
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="weight-semibold">CV builder</span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate">Settings</span>
        </span>
        <Avatar size="sm">
          <AvatarFallback title="Rina Wulandari">RW</AvatarFallback>
        </Avatar>
      </div>
      <SidebarProvider className="min-h-0" style={SIDEBAR_STYLE}>
        {/* h-auto lets the pane stretch to the form's height. */}
        <Sidebar className="hidden h-auto md:flex" collapsible="none">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Settings</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {PAGES.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        aria-current={item.id === page ? "page" : undefined}
                        isActive={item.id === page}
                        onClick={() => setPage(item.id)}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="band flex flex-col gap-1 px-5 py-5 sm:px-8">
            <h3 className="type-title">{current.label}</h3>
            <p className="type-caption text-muted-foreground">
              {current.description}
            </p>
          </header>
          {page === CLOUD_PAGE ? (
            <>
              <div
                className="flex max-w-3xl flex-col gap-10 px-5 py-8 sm:px-8"
                ref={formRef}
              >
                <CloudSettingsForm onChange={update} settings={draft} />
                <RecentExports />
                <DangerZone
                  disabled={!saved.cloudSave}
                  onDelete={deleteCloudCopy}
                />
              </div>
              <div className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-between gap-3 border-line border-t bg-background px-5 py-3 sm:px-8">
                <p
                  aria-live="polite"
                  className="type-caption text-muted-foreground"
                >
                  {dirty ? "Unsaved changes" : `Saved at ${savedAt}`}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <Button disabled={!dirty} onClick={discard} variant="ghost">
                    Discard
                  </Button>
                  <Button onClick={save}>
                    Save changes
                    <Kbd>V</Kbd>
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <OtherPage onBack={() => setPage(CLOUD_PAGE)} page={current} />
          )}
        </div>
      </SidebarProvider>
    </div>
  );
}

// Renders: Sidebar, FieldGroup, Field, Switch, Select, InputGroup, Table,
// Badge, Empty, AlertDialog, Kbd and the page's toaster (feedback section).
export function ExampleScreenSection() {
  return (
    <Section
      id="example-screen"
      lead="The CV builder's cloud save and sharing settings, built only from the system's tokens and components. Change a setting, then press V to save."
      title="Example screen"
    >
      <SettingsScreen />
    </Section>
  );
}
