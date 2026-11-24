import { isoToday } from "@rulisme/ui/lib/iso-date";
import { BadgeButton } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import type { DateRangeValue } from "@rulisme/ui/ui/date-picker";
import {
  DatePicker,
  DateRangePicker,
  defaultDatePresets,
  defaultDateRangePresets,
} from "@rulisme/ui/ui/date-picker";
import { DragHandle } from "@rulisme/ui/ui/drag-handle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import { EditableTitle } from "@rulisme/ui/ui/editable-title";
import { Field, FieldDescription, FieldLabel } from "@rulisme/ui/ui/field";
import { FieldButton } from "@rulisme/ui/ui/field-button";
import { FlagIcon } from "@rulisme/ui/ui/flag-icon";
import { FileDropZone, FileTrigger } from "@rulisme/ui/ui/file-upload";
import { Kbd } from "@rulisme/ui/ui/kbd";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@rulisme/ui/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { StatusDot } from "@rulisme/ui/ui/status-dot";
import { SwatchPicker } from "@rulisme/ui/ui/swatch-picker";
import {
  Archive,
  ArrowUpDown,
  Columns3,
  Copy,
  Download,
  FileCode,
  FileJson,
  FileText,
  ImageUp,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { Block, Example } from "../layout";

// The reui-derived pickers and helpers: date pickers with presets, file
// pickers, the segmented control, status dots, swatches, the field-shaped
// button, drag handles and the inline-editable title. Apps use these instead
// of raw <button>, <input>, <select> or <textarea> (TYPOGRAPHY.md § Raw
// controls).

const ACCENTS = ["#f48120", "#2563eb", "#059669", "#dc2626", "#7c3aed"];

function DatePickerBlock() {
  const [due, setDue] = useState("2026-12-08");
  const [applied, setApplied] = useState("");
  const [interview, setInterview] = useState("2026-12-02T10:30");
  const [range, setRange] = useState<DateRangeValue | undefined>({
    from: "2026-11-01",
    to: "2026-11-30",
  });

  return (
    <Block
      description="The field shell led by a calendar icon, a round clear button once a value is set, and a flyout of presets (row buttons) beside the Calendar. Values are local ISO strings: YYYY-MM-DD, or YYYY-MM-DDTHH:mm with a time; min and max disable the days outside."
      title="Date picker"
      wide
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Example label="Due date with presets, clearable" stack>
          <Field>
            <FieldLabel htmlFor="date-due">Due date</FieldLabel>
            <DatePicker
              id="date-due"
              min={isoToday()}
              onValueChange={setDue}
              presets={defaultDatePresets()}
              value={due}
            />
            <FieldDescription>Only today and later.</FieldDescription>
          </Field>
        </Example>
        <Example label="Empty, max today; date and time" stack>
          <Field>
            <FieldLabel htmlFor="date-applied">Applied on</FieldLabel>
            <DatePicker
              id="date-applied"
              max={isoToday()}
              onValueChange={setApplied}
              value={applied}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="date-interview">Interview</FieldLabel>
            <DatePicker
              id="date-interview"
              onValueChange={setInterview}
              value={interview}
              withTime
            />
          </Field>
        </Example>
        <Example label="Range with presets; small, invalid, disabled" stack>
          <Field>
            <FieldLabel htmlFor="date-period">Billing period</FieldLabel>
            <DateRangePicker
              id="date-period"
              onValueChange={setRange}
              presets={defaultDateRangePresets()}
              value={range}
            />
          </Field>
          <DatePicker aria-label="Small" size="sm" value="2026-11-24" />
          <DatePicker aria-invalid aria-label="Invalid" value="" />
          <DatePicker aria-label="Disabled" disabled value="2026-11-24" />
        </Example>
      </div>
    </Block>
  );
}

function FileUploadBlock() {
  const [picked, setPicked] = useState<string[]>([]);
  const names = (files: File[]) => setPicked(files.map((file) => file.name));

  return (
    <Block
      description="The hidden file input lives inside the component: FileTrigger turns any Button into the picker, FileDropZone is the dashed 8px drop target that also opens the dialog on click, Enter or Space. Both hand back File[] and accept the same filters."
      title="File upload"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Example label="Buttons: a toolbar icon and a labelled pill" stack>
          <div className="flex items-center gap-2">
            <FileTrigger accept=".json" onFilesSelect={names}>
              <Button aria-label="Import JSON" size="icon-sm" variant="ghost">
                <Upload aria-hidden="true" />
              </Button>
            </FileTrigger>
            <FileTrigger accept="image/*" onFilesSelect={names}>
              <Button size="sm" variant="outline">
                <ImageUp aria-hidden="true" data-icon="inline-start" />
                Upload logo
              </Button>
            </FileTrigger>
          </div>
          <p className="type-caption text-muted-foreground">
            {picked.length > 0 ? picked.join(", ") : "No file chosen yet."}
          </p>
        </Example>
        <Example label="Drop zone; disabled" stack>
          <FileDropZone
            accept="image/jpeg,image/png,image/webp"
            description="JPG, PNG or WebP at 16:9, up to 5 MB."
            onFilesSelect={names}
            title="Drop an image or click to browse"
          />
          <FileDropZone
            disabled
            onFilesSelect={names}
            title="Uploads open after sign-in"
          />
        </Example>
      </div>
    </Block>
  );
}

function SegmentedBlock() {
  const [view, setView] = useState("board");
  const [lang, setLang] = useState("en");

  return (
    <Block
      description="One choice from a few, on a pane track; the chosen segment is a card pill with a hairline ring and can't be cleared. Segments may lead with an icon. For independent toggles use ToggleGroup."
      title="Segmented control"
    >
      <Example label="With icons; small, with flags (FlagIcon)" stack>
        <SegmentedControl
          aria-label="View"
          onValueChange={setView}
          value={view}
        >
          <SegmentedControlItem value="board">
            <Columns3 aria-hidden="true" />
            Board
          </SegmentedControlItem>
          <SegmentedControlItem value="list">
            <LayoutList aria-hidden="true" />
            List
          </SegmentedControlItem>
        </SegmentedControl>
        <SegmentedControl
          aria-label="Language"
          onValueChange={setLang}
          size="sm"
          value={lang}
        >
          <SegmentedControlItem aria-label="English" value="en">
            <FlagIcon code="gb" />
            EN
          </SegmentedControlItem>
          <SegmentedControlItem aria-label="Bahasa Indonesia" value="id">
            <FlagIcon code="id" />
            ID
          </SegmentedControlItem>
        </SegmentedControl>
      </Example>
    </Block>
  );
}

const STATUSES = [
  { value: "draft", label: "Draft", tone: "neutral", hint: "Not sent" },
  { value: "sent", label: "Sent", tone: "blue", hint: "Awaiting payment" },
  { value: "overdue", label: "Overdue", tone: "destructive", hint: "7 days" },
  { value: "paid", label: "Paid", tone: "success", hint: "Settled" },
] as const;

function StatusBlock() {
  const [tags, setTags] = useState(["TypeScript", "React", "Figma"]);

  return (
    <Block
      description="An 8px status dot before a label: select options, menu rows, table cells. Tones: neutral, link (orange, also the warning tone), success, destructive, ink. SelectItem and DropdownMenuItem take a trailing description; a lucide icon as the first child sits at 16px in ink-sec."
      title="Status, menu icons and chips"
      wide
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Example label="Status select with descriptions" stack>
          <Select defaultValue="sent">
            <SelectTrigger aria-label="Status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {STATUSES.map((status) => (
                  <SelectItem
                    description={status.hint}
                    key={status.value}
                    value={status.value}
                  >
                    <StatusDot tone={status.tone} />
                    {status.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-3">
            {STATUSES.map((status) => (
              <span
                className="type-caption inline-flex items-center gap-1.5 text-muted-foreground"
                key={status.value}
              >
                <StatusDot tone={status.tone} />
                {status.label}
              </span>
            ))}
            <span className="type-caption inline-flex items-center gap-1.5 text-muted-foreground">
              <StatusDot pulse tone="success" />
              Live
            </span>
          </div>
        </Example>
        <Example label="Row menu: icons, descriptions, shortcut" stack>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="More actions" size="icon-sm" variant="ghost">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>Application</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <Pencil aria-hidden="true" />
                  Rename
                  <DropdownMenuShortcut>R</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy aria-hidden="true" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem description=".md">
                  <FileCode aria-hidden="true" />
                  Export Markdown
                </DropdownMenuItem>
                <DropdownMenuItem description=".json">
                  <FileJson aria-hidden="true" />
                  Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Archive aria-hidden="true" />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="type-caption text-muted-foreground">
            Every row leads with its icon.
          </p>
        </Example>
        <Example label="Removable chips" stack>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <BadgeButton
                key={tag}
                onClick={() => setTags((all) => all.filter((t) => t !== tag))}
                removeLabel={`Remove ${tag}`}
              >
                {tag}
              </BadgeButton>
            ))}
          </div>
          {tags.length === 0 ? (
            <Button
              onClick={() => setTags(["TypeScript", "React", "Figma"])}
              size="sm"
              variant="outline"
            >
              Reset
            </Button>
          ) : null}
        </Example>
      </div>
    </Block>
  );
}

function SwatchBlock() {
  const [accent, setAccent] = useState("#2563eb");
  return (
    <Block
      description="Document colours (an invoice accent), not chrome: 24px dots in a radio group, the chosen one ringed in ink; the last dot opens the colour dialog."
      title="Swatch picker"
    >
      <Example label="Presets and a custom colour" stack>
        <SwatchPicker
          allowCustom
          aria-label="Accent colour"
          colors={ACCENTS}
          onValueChange={setAccent}
          value={accent}
        />
        <p className="type-caption font-mono text-muted-foreground">{accent}</p>
      </Example>
    </Block>
  );
}

function FieldButtonBlock() {
  const [title, setTitle] = useState("Work experience");
  const rows = ["Experience", "Education", "Skills"];

  return (
    <Block
      description="FieldButton is a button drawn as a field, for triggers that open something (a search palette, a picker). EditableTitle reads as a heading until hovered. DragHandle is the grip that dnd-kit lifts; Button variant row is a full-width row target."
      title="Field button, editable title, drag handle, row"
      wide
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Example label="Search trigger; placeholder; small" stack>
          <FieldButton aria-keyshortcuts="/" className="pr-1.5" empty>
            <Search aria-hidden="true" />
            <span className="flex-1">Search applications…</span>
            <Kbd>/</Kbd>
          </FieldButton>
          <FieldButton size="sm">
            <Download aria-hidden="true" />
            <span className="flex-1 truncate">cv-2026.pdf</span>
          </FieldButton>
        </Example>
        <Example label="Editable section title" stack>
          <div className="flex items-center">
            <EditableTitle
              aria-label="Section title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          <div className="flex items-center">
            <EditableTitle
              aria-label="Read-only title"
              readOnly
              value="Fixed"
            />
          </div>
        </Example>
        <Example label="Drag handles and row buttons" stack>
          <div className="flex flex-col">
            {rows.map((row) => (
              <div className="flex items-center gap-1" key={row}>
                <DragHandle label={`Reorder ${row}`} />
                <Button size="sm" variant="row">
                  <FileText aria-hidden="true" />
                  {row}
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <DragHandle label="Reorder (gutter)" variant="gutter" />
              <Button aria-pressed size="sm" variant="row">
                <ArrowUpDown aria-hidden="true" />
                Sorted by date
              </Button>
            </div>
          </div>
        </Example>
      </div>
    </Block>
  );
}

// Renders: DatePicker, DateRangePicker, FileTrigger, FileDropZone,
// SegmentedControl, StatusDot, BadgeButton, SwatchPicker, FieldButton,
// EditableTitle, DragHandle.
export function PickerBlocks() {
  return (
    <>
      <DatePickerBlock />
      <FileUploadBlock />
      <SegmentedBlock />
      <SwatchBlock />
      <StatusBlock />
      <FieldButtonBlock />
    </>
  );
}
