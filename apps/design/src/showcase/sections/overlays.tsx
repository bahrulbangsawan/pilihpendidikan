import { useShortcut } from "@rulisme/ui/hooks/use-shortcut";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@rulisme/ui/ui/alert-dialog";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@rulisme/ui/ui/attachment";
import { Avatar, AvatarFallback } from "@rulisme/ui/ui/avatar";
import { Button } from "@rulisme/ui/ui/button";
import { Calendar } from "@rulisme/ui/ui/calendar";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@rulisme/ui/ui/command";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@rulisme/ui/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@rulisme/ui/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@rulisme/ui/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@rulisme/ui/ui/hover-card";
import { Input } from "@rulisme/ui/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@rulisme/ui/ui/input-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@rulisme/ui/ui/item";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { NotFound } from "@rulisme/ui/ui/not-found";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@rulisme/ui/ui/popover";
import { RadioGroup, RadioGroupItem } from "@rulisme/ui/ui/radio-group";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@rulisme/ui/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCopy,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileJson,
  FileText,
  FileType2,
  FileUp,
  FolderInput,
  FolderKanban,
  GraduationCap,
  Info,
  KeyRound,
  LayoutTemplate,
  Link2,
  Mail,
  Pencil,
  PencilLine,
  Printer,
  QrCode,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Block, BlockGrid, Example, Section } from "../layout";

const SHARE_URL = "https://cv.pilihpendidikan.com/rina-wulandari";

// A shortcut never opens a second window over one that is already open.
const OPEN_WINDOW =
  "[data-slot=dialog-content], [data-slot=alert-dialog-content], [data-slot=sheet-content], [data-slot=drawer-content]";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ── Dialog ─────────────────────────────────────────────────────────────── */

function ShareDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link stays selectable.
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setCopied(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Share2 aria-hidden="true" data-icon="inline-start" />
          Share a read-only link
          <Kbd>S</Kbd>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share a read-only link</DialogTitle>
          <DialogDescription>
            Anyone with the link sees your latest saved CV. They can't edit it,
            and unsaved drafts stay private.
          </DialogDescription>
        </DialogHeader>
        <form
          id="share-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleOpenChange(false);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="share-link">Public link</FieldLabel>
              <InputGroup>
                <InputGroupInput id="share-link" readOnly value={SHARE_URL} />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton onClick={copyLink}>
                    {copied ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="share-email">
                Send it to a recruiter
              </FieldLabel>
              <Input
                autoComplete="email"
                id="share-email"
                placeholder="sari.pratiwi@tokopedia.com"
                type="email"
              />
              <FieldDescription>
                We email the link once and keep no copy of the address.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button form="share-form" type="submit">
            <Send aria-hidden="true" data-icon="inline-start" />
            Send link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRIVACY_SECTIONS = [
  {
    title: "Your documents",
    body: "Saving stores the CV, invoice or portfolio you are editing with your account, so you can open it on another device. Drafts you never save stay in this browser.",
  },
  {
    title: "Your email address",
    body: "We use it to send sign-in links. There is no password to leak, and no newsletter.",
  },
  {
    title: "Read-only links",
    body: "A link shows the latest saved version of one document. Turn sharing off and the link stops working.",
  },
  {
    title: "Personal tokens",
    body: "A token lets an AI assistant read and update your documents through the MCP endpoint. Revoke it from Connect and the assistant loses access.",
  },
  {
    title: "Downloads",
    body: "PDF, Markdown and JSON files are built for you to keep. Sending one to a recruiter is up to you.",
  },
  {
    title: "Deleting your account",
    body: "Deleting your account removes every saved document, read-only link and token with it.",
  },
] as const;

const TOKEN_ABILITIES = [
  "Read your saved CVs, invoices and portfolios",
  "Create a new document or update an existing one",
  "Never delete your account or change your email",
] as const;

function PrivacyDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <ShieldCheck aria-hidden="true" data-icon="inline-start" />
          What we store
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What we store when you save</DialogTitle>
          <DialogDescription>
            The same for the CV, invoice and portfolio builders.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 flex max-h-[50dvh] flex-col gap-5 overflow-y-auto border-line border-t px-4 pt-4">
          {PRIVACY_SECTIONS.map((section) => (
            <section className="flex flex-col gap-1" key={section.title}>
              <h3 className="type-subtitle weight-semibold">{section.title}</h3>
              <p className="type-body">{section.body}</p>
              {section.title === "Personal tokens" ? (
                <ul className="type-body mt-1 flex list-disc flex-col gap-1 pl-5">
                  {TOKEN_ABILITIES.map((ability) => (
                    <li key={ability}>{ability}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
        <DialogFooter
          className="sm:items-center sm:justify-between"
          showCloseButton
        >
          <p className="type-caption text-muted-foreground">
            Last updated 1 October 2026
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Alert dialog ───────────────────────────────────────────────────────── */

function ClearSectionsAlert() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          Clear all sections
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all sections?</AlertDialogTitle>
          <AlertDialogDescription>
            This empties work experience, education, projects and skills in this
            CV. Your saved copy stays in the cloud until you save again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my CV</AlertDialogCancel>
          <AlertDialogAction variant="destructive">
            Clear sections
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevokeTokenAlert() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <KeyRound aria-hidden="true" data-icon="inline-start" />
          Revoke token
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <KeyRound />
          </AlertDialogMedia>
          <AlertDialogTitle>Revoke “Claude on MacBook”?</AlertDialogTitle>
          <AlertDialogDescription>
            The assistant loses access at once. Create a new token from Connect
            when you need it again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Revoke</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Sheet ──────────────────────────────────────────────────────────────── */

const IMPORT_SECTIONS = [
  { id: "import-experience", label: "Work experience" },
  { id: "import-education", label: "Education" },
  { id: "import-projects", label: "Projects" },
  { id: "import-skills", label: "Skills" },
] as const;

function ImportSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FileUp aria-hidden="true" data-icon="inline-start" />
          Import from PDF
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Import from PDF</SheetTitle>
          <SheetDescription>
            We read the text of your old CV and fill the matching sections. The
            file never leaves this browser.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <Attachment className="w-full">
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>cv-rina-wulandari-2025.pdf</AttachmentTitle>
              <AttachmentDescription>
                PDF · 2 pages · 184 KB
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label="Remove file">
                <X aria-hidden="true" />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
          <FieldSet>
            <FieldLegend variant="label">Sections to fill</FieldLegend>
            <FieldGroup className="gap-3">
              {IMPORT_SECTIONS.map((section) => (
                <Field key={section.id} orientation="horizontal">
                  <Checkbox defaultChecked id={section.id} />
                  <FieldLabel htmlFor={section.id}>{section.label}</FieldLabel>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">
              When a section already has entries
            </FieldLegend>
            <RadioGroup defaultValue="append">
              <Field orientation="horizontal">
                <RadioGroupItem id="import-append" value="append" />
                <FieldLabel htmlFor="import-append">
                  Add the imported entries below mine
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem id="import-replace" value="replace" />
                <FieldLabel htmlFor="import-replace">
                  Replace my entries
                </FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button>Import 4 sections</Button>
          </SheetClose>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const SIDES = [
  { side: "top", label: "Top" },
  { side: "right", label: "Right" },
  { side: "bottom", label: "Bottom" },
  { side: "left", label: "Left" },
] as const;

type Side = (typeof SIDES)[number]["side"];

const OUTLINE = [
  "Personal details",
  "Summary",
  "Work experience",
  "Education",
  "Projects",
  "Skills",
] as const;

function OutlineSheet({ side, label }: { side: Side; label: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>CV outline</SheetTitle>
          <SheetDescription>Jump to a section of the editor.</SheetDescription>
        </SheetHeader>
        <nav
          aria-label="CV sections"
          className="flex flex-wrap gap-1 px-3 pb-4"
        >
          {OUTLINE.map((section) => (
            <SheetClose asChild key={section}>
              <Button size="sm" variant="ghost">
                {section}
              </Button>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */

const FORMATS = [
  { icon: FileText, label: "PDF", hint: "A4, ready to print or attach" },
  { icon: FileCode2, label: "Markdown", hint: "Plain text for job portals" },
  { icon: FileJson, label: "JSON", hint: "Import it back into the builder" },
] as const;

function DownloadDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <Drawer onOpenChange={setOpen} open={open}>
      <DrawerTrigger asChild>
        <Button variant="outline">
          <Download aria-hidden="true" data-icon="inline-start" />
          Download
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto flex w-full max-w-sm flex-col">
          <DrawerHeader>
            <DrawerTitle>Download your CV</DrawerTitle>
            <DrawerDescription>
              Pick a format. Recruiters expect the PDF.
            </DrawerDescription>
          </DrawerHeader>
          <ItemGroup className="px-4 pb-4">
            {FORMATS.map(({ icon: Icon, label, hint }) => (
              <Item asChild key={label} variant="outline">
                <button onClick={() => setOpen(false)} type="button">
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{label}</ItemTitle>
                    <ItemDescription>{hint}</ItemDescription>
                  </ItemContent>
                </button>
              </Item>
            ))}
          </ItemGroup>
        </div>
        <DrawerFooter className="items-center">
          <DrawerClose asChild>
            <Button className="w-full max-w-sm" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/* ── Popover ────────────────────────────────────────────────────────────── */

function StartDatePopover() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(new Date(2025, 5, 2));
  return (
    <Field className="w-44">
      <FieldLabel htmlFor="start-date">Started</FieldLabel>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button className="justify-start" id="start-date" variant="outline">
            <CalendarDays aria-hidden="true" data-icon="inline-start" />
            {date ? formatDate(date) : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            defaultMonth={date}
            mode="single"
            onSelect={(next) => {
              setDate(next);
              setOpen(false);
            }}
            selected={date}
          />
        </PopoverContent>
      </Popover>
    </Field>
  );
}

function RenameSectionPopover() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Organisational experience");
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button variant="ghost">
          <PencilLine aria-hidden="true" data-icon="inline-start" />
          Rename section
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Section title</PopoverTitle>
          <PopoverDescription>
            Printed as the heading above these entries.
          </PopoverDescription>
        </PopoverHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <Field>
            <FieldLabel className="sr-only" htmlFor="section-title">
              Section title
            </FieldLabel>
            <Input
              id="section-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button size="sm" type="submit">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/* ── Hover card ─────────────────────────────────────────────────────────── */

function RecruiterHoverCard() {
  return (
    <p className="type-body max-w-prose">
      Opened 3 times this week, last by{" "}
      <HoverCard closeDelay={100} openDelay={150}>
        <HoverCardTrigger asChild>
          <a
            className="text-primary underline underline-offset-4"
            href="#overlays"
          >
            Sari Pratiwi
          </a>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-72">
          <div className="flex gap-3">
            <Avatar size="lg">
              <AvatarFallback>SP</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="type-subtitle weight-semibold text-foreground">
                Sari Pratiwi
              </p>
              <p className="type-caption text-muted-foreground">
                Talent acquisition · Tokopedia, Jakarta
              </p>
              <p className="type-body mt-2">
                Hiring UI/UX and front-end interns for the January 2027 intake.
              </p>
              <p className="type-caption mt-2 flex items-center gap-1.5 text-muted-foreground">
                <Eye aria-hidden="true" className="size-3.5" />
                Opened your CV on 9 October
              </p>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
      .
    </p>
  );
}

/* ── Tooltip ────────────────────────────────────────────────────────────── */

function EditorToolbar({ onShare }: { onShare: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label="Import JSON" size="icon" variant="ghost">
            <Upload aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import JSON</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Fill with sample data"
            size="icon"
            variant="ghost"
          >
            <Sparkles aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Fill with sample data</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-keyshortcuts="S"
            aria-label="Share a read-only link"
            onClick={onShare}
            size="icon"
            variant="ghost"
          >
            <Share2 aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Share a read-only link
          <Kbd>S</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label="Clear all sections" size="icon" variant="ghost">
            <Trash2 aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Clear all sections</TooltipContent>
      </Tooltip>
    </div>
  );
}

/* ── Dropdown menu ──────────────────────────────────────────────────────── */

function DownloadMenu() {
  const [photo, setPhoto] = useState(true);
  const [contact, setContact] = useState(false);
  const [paper, setPaper] = useState("a4");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Download aria-hidden="true" data-icon="inline-start" />
          Download
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Download as</DropdownMenuLabel>
          <DropdownMenuItem>
            <FileText />
            PDF
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileJson />
            JSON
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileCode2 />
            Markdown
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FileType2 />
            Word document
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Include</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={photo} onCheckedChange={setPhoto}>
            Profile photo
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={contact}
            onCheckedChange={setContact}
          >
            Phone number
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup onValueChange={setPaper} value={paper}>
          <DropdownMenuLabel>Paper</DropdownMenuLabel>
          <DropdownMenuRadioItem value="a4">A4</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="letter">
            US Letter
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Share2 />
              Share
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>
                <Link2 />
                Copy read-only link
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Mail />
                Email to a recruiter
              </DropdownMenuItem>
              <DropdownMenuItem>
                <QrCode />
                Show QR code
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => window.print()}>
            <Printer />
            Print
            <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive">
            <Trash2 />
            Delete saved copy
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Context menu ───────────────────────────────────────────────────────── */

const ENTRY_TEXT =
  "Software Engineering Intern, Gojek, Jakarta. June to August 2025.";

function EntryContextMenu() {
  const [visible, setVisible] = useState(true);
  const [section, setSection] = useState("experience");

  async function copyEntry() {
    try {
      await navigator.clipboard.writeText(ENTRY_TEXT);
    } catch {
      // Clipboard access can be refused; nothing else depends on it.
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex w-full flex-col gap-3 rounded-sm border border-line border-dashed bg-card/60 p-4">
        <span className="type-caption text-muted-foreground">
          Right-click the entry, or press and hold on a touch screen.
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="type-subtitle weight-semibold text-foreground">
            Software Engineering Intern
          </span>
          <span className="type-caption text-muted-foreground">
            Gojek · Jakarta · Jun – Aug 2025
          </span>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuItem>
            <Pencil />
            Edit entry
          </ContextMenuItem>
          <ContextMenuItem onSelect={copyEntry}>
            <ClipboardCopy />
            Copy text
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem>
            <ArrowUp />
            Move up
          </ContextMenuItem>
          <ContextMenuItem disabled>
            <ArrowDown />
            Move down
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuCheckboxItem
            checked={visible}
            onCheckedChange={setVisible}
          >
            Show on the printed CV
          </ContextMenuCheckboxItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput />
              Move to section
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              <ContextMenuRadioGroup onValueChange={setSection} value={section}>
                <ContextMenuLabel>Section</ContextMenuLabel>
                <ContextMenuRadioItem value="experience">
                  Work experience
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="organisation">
                  Organisational experience
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="projects">
                  Projects
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive">
            <Trash2 />
            Delete entry
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ── Command ────────────────────────────────────────────────────────────── */

const COMMAND_SECTIONS = [
  { icon: UserRound, label: "Personal details" },
  { icon: Briefcase, label: "Work experience" },
  { icon: GraduationCap, label: "Education" },
  { icon: FolderKanban, label: "Projects" },
  { icon: Wrench, label: "Skills" },
] as const;

const TEMPLATES = ["Classic", "Modern", "Compact"] as const;

function BuilderCommands({ onShare }: { onShare: () => void }) {
  return (
    <>
      <CommandInput placeholder="Search sections and actions…" />
      <CommandList>
        <CommandEmpty>No matches. Try “education” or “PDF”.</CommandEmpty>
        <CommandGroup heading="Sections">
          {COMMAND_SECTIONS.map(({ icon: Icon, label }) => (
            <CommandItem key={label}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Template">
          {TEMPLATES.map((template) => (
            <CommandItem
              data-checked={template === "Classic"}
              key={template}
              value={`Template ${template}`}
            >
              <LayoutTemplate />
              {template}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem>
            <Download />
            Download PDF
          </CommandItem>
          <CommandItem onSelect={onShare}>
            <Share2 />
            Share a read-only link
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>
            <Upload />
            Import from LinkedIn
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </>
  );
}

function InlineCommand({ onShare }: { onShare: () => void }) {
  // cmdk scrolls its first item into view on mount; a controlled value that
  // matches nothing keeps the page where it is.
  const [value, setValue] = useState("none");
  return (
    <Command onValueChange={setValue} value={value}>
      <BuilderCommands onShare={onShare} />
    </Command>
  );
}

function EmptyCommand() {
  const [value, setValue] = useState("none");
  const [search, setSearch] = useState("pas foto merah");
  return (
    <Command onValueChange={setValue} value={value}>
      <CommandInput
        onValueChange={setSearch}
        placeholder="Search sections and actions…"
        value={search}
      />
      <CommandList>
        <CommandEmpty>No matches. Try “education” or “PDF”.</CommandEmpty>
        <CommandGroup heading="Sections">
          {COMMAND_SECTIONS.map(({ icon: Icon, label }) => (
            <CommandItem key={label}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function PaletteDialog({ onShare }: { onShare: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;
      if (!modified || event.key.toLowerCase() !== "k" || event.repeat) {
        return;
      }
      event.preventDefault();
      setOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Button
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        variant="outline"
      >
        <Search aria-hidden="true" data-icon="inline-start" />
        Search the builder
        <Kbd>⌘K</Kbd>
      </Button>
      <CommandDialog
        description="Jump to a section of your CV or run an action."
        onOpenChange={setOpen}
        open={open}
        title="Search the builder"
      >
        <Command>
          <BuilderCommands
            onShare={() => {
              setOpen(false);
              onShare();
            }}
          />
        </Command>
      </CommandDialog>
    </>
  );
}

/* ── Not found ──────────────────────────────────────────────────────────── */

function PreviewMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 place-items-center rounded-md bg-primary"
    >
      <span className="size-3.5 rotate-45 border border-primary-foreground" />
    </span>
  );
}

/* ── Section ────────────────────────────────────────────────────────────── */

export function OverlaysSection() {
  const [shareOpen, setShareOpen] = useState(false);
  const openShare = () => setShareOpen(true);

  useShortcut("s", () => {
    if (!document.querySelector(OPEN_WINDOW)) {
      openShare();
    }
  });

  return (
    <Section
      id="overlays"
      lead="Windows: 6px corners, a hairline, the one soft drop shadow. They open without animation."
      title="Overlays"
    >
      <BlockGrid>
        <Block
          description="A focused task that needs input. The window sits over a flat 40% shot backdrop; its footer rides on a ruled pane band."
          title="Dialog"
        >
          <Example label="Form with a copy field · press S">
            <ShareDialog onOpenChange={setShareOpen} open={shareOpen} />
          </Example>
          <Example label="Long content scrolls between the rules">
            <PrivacyDialog />
          </Example>
        </Block>

        <Block
          description="Confirms a destructive action: say what is lost, and put the way out first."
          title="Alert dialog"
        >
          <Example label="Default">
            <ClearSectionsAlert />
          </Example>
          <Example label="Small, with media">
            <RevokeTokenAlert />
          </Example>
        </Block>

        <Block
          description="A side panel for settings and details. Square like a band, with the hairline on its inner edge."
          title="Sheet"
        >
          <Example label="Settings panel">
            <ImportSheet />
          </Example>
          <Example label="Sides">
            {SIDES.map(({ side, label }) => (
              <OutlineSheet key={side} label={label} side={side} />
            ))}
          </Example>
        </Block>

        <Block
          description="A mobile-first bottom panel: 6px top corners, a small grab handle, and vaul's own drag."
          title="Drawer"
        >
          <Example label="Bottom drawer">
            <DownloadDrawer />
          </Example>
        </Block>

        <Block
          description="Small contextual content on click: a date picker or a one-field form."
          title="Popover"
        >
          <Example label="Date picker">
            <StartDatePopover />
          </Example>
          <Example label="Header, title and description">
            <RenameSectionPopover />
          </Example>
        </Block>

        <Block
          description="Quick information on hover, such as a recruiter's profile behind a name. Framed 2px initials, a semibold name, a caption-role role."
          title="Hover card"
        >
          <Example>
            <RecruiterHoverCard />
          </Example>
        </Block>

        <Block
          description="A caption-role label on the dark tooltip fill for icon-only controls; a shortcut sits in a translucent kbd."
          title="Tooltip"
        >
          <Example label="Icon-only toolbar">
            <EditorToolbar onShare={openShare} />
          </Example>
          <Example label="Sides">
            {SIDES.map(({ side, label }) => (
              <Tooltip key={side}>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline">
                    {label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={side}>Saved 2 minutes ago</TooltipContent>
              </Tooltip>
            ))}
          </Example>
          <Example label="Long text wraps at 320px">
            <span className="type-body text-foreground">Career span</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="How the career span is counted"
                  size="icon-xs"
                  variant="ghost"
                >
                  <Info aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex-col items-start" side="bottom">
                Counts the months from your first role to today, minus any gap
                longer than three months between roles.
              </TooltipContent>
            </Tooltip>
          </Example>
        </Block>

        <Block
          description="Actions on click. Rows fill with pane when highlighted; checks for options, a diamond for the chosen one."
          title="Dropdown menu"
        >
          <Example label="Download menu">
            <DownloadMenu />
          </Example>
        </Block>

        <Block
          description="The same rows on right-click, for actions on one object: here, a CV entry."
          title="Context menu"
        >
          <Example stack>
            <EntryContextMenu />
          </Example>
        </Block>

        <Block
          description="A searchable list of sections and actions: a window with its search row ruled off, inline or behind ⌘K."
          title="Command"
          wide
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Example label="Inline palette" stack>
              <InlineCommand onShare={openShare} />
            </Example>
            <div className="flex min-w-0 flex-col gap-4">
              <Example label="As a dialog · ⌘K">
                <PaletteDialog onShare={openShare} />
              </Example>
              <Example label="No matches" stack>
                <EmptyCommand />
              </Example>
            </div>
          </div>
        </Block>

        <Block
          description="Not an overlay: the 404 page every app renders for unknown URLs. A ruled band on graph paper, one cobalt action, an outlined way back."
          title="Not found page"
          wide
        >
          <NotFound
            as="div"
            className="min-h-0"
            homeHref="#overview"
            logo={<PreviewMark />}
          />
        </Block>
      </BlockGrid>
    </Section>
  );
}
