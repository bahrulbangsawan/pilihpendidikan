import { cn } from "@rulisme/ui/lib/utils";
import { Avatar, AvatarFallback } from "@rulisme/ui/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@rulisme/ui/ui/breadcrumb";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rulisme/ui/ui/dropdown-menu";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@rulisme/ui/ui/menubar";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@rulisme/ui/ui/navigation-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@rulisme/ui/ui/pagination";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@rulisme/ui/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rulisme/ui/ui/tabs";
import {
  tabsListVariants,
  tabsTriggerVariants,
} from "@rulisme/ui/ui/tabs-variants";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  Briefcase,
  ChevronsUpDown,
  Download,
  FilePlus,
  FileText,
  FolderGit2,
  GraduationCap,
  Languages,
  Link2,
  Mail,
  Monitor,
  MoreHorizontal,
  Palette,
  Plus,
  Printer,
  Redo2,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  Upload,
  User,
  Wrench,
} from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";
import { Block, BlockGrid, Example, Section } from "../layout";
import { previewState, StateMatrix } from "../state-matrix";

/* ── Tabs ──────────────────────────────────────────────────────────────── */

const TAB_VARIANTS = ["default", "line"] as const;
const TAB_STATES = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "selected",
] as const;

const PORTFOLIO_PAGES = [
  { label: "Projects", current: true },
  { label: "About", current: false },
  { label: "Contact", current: false },
] as const;

function TabsBlock() {
  return (
    <Block
      description="Switch between views of the same thing. Default is a segmented track whose selected segment sits on paper with the lip; line sets the tabs on a hairline rule. Selected tabs take the heading weight, never the blue."
      title="Tabs"
      wide
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Example label="default · views inside a panel" stack>
          <Tabs className="w-full" defaultValue="content">
            <TabsList>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="share">Share</TabsTrigger>
            </TabsList>
            <TabsContent value="content">
              <p className="type-body max-w-prose">
                Profile, work experience, education and skills, in the order a
                recruiter reads them.
              </p>
            </TabsContent>
            <TabsContent value="design">
              <p className="type-body max-w-prose">
                Harvard, Standard, Simple or Basic, on A4 or Letter paper.
              </p>
            </TabsContent>
            <TabsContent value="share">
              <p className="type-body max-w-prose">
                A read-only link that always shows your latest saved version.
              </p>
            </TabsContent>
          </Tabs>
        </Example>
        <Example label="line · sections of a page or a list" stack>
          <Tabs className="w-full" defaultValue="sent">
            <TabsList className="w-full justify-start" variant="line">
              <TabsTrigger className="flex-none" value="drafts">
                Drafts
              </TabsTrigger>
              <TabsTrigger className="flex-none" value="sent">
                Sent
              </TabsTrigger>
              <TabsTrigger className="flex-none" value="paid">
                Paid
              </TabsTrigger>
            </TabsList>
            <TabsContent value="drafts">
              <p className="type-body">3 invoices not sent yet.</p>
            </TabsContent>
            <TabsContent value="sent">
              <p className="type-body">
                12 invoices waiting for payment, the oldest due 25 October.
              </p>
            </TabsContent>
            <TabsContent value="paid">
              <p className="type-body">28 invoices paid this year.</p>
            </TabsContent>
          </Tabs>
        </Example>
        <Example label="with icons · leading, icon-only">
          <Tabs defaultValue="projects">
            <TabsList>
              <TabsTrigger value="projects">
                <FolderGit2 aria-hidden="true" data-icon="inline-start" />
                Projects
              </TabsTrigger>
              <TabsTrigger value="about">
                <User aria-hidden="true" data-icon="inline-start" />
                About
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs defaultValue="desktop">
            <TabsList aria-label="Preview size">
              <TabsTrigger aria-label="Desktop" value="desktop">
                <Monitor aria-hidden="true" />
              </TabsTrigger>
              <TabsTrigger aria-label="Tablet" value="tablet">
                <Tablet aria-hidden="true" />
              </TabsTrigger>
              <TabsTrigger aria-label="Phone" value="phone">
                <Smartphone aria-hidden="true" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Example>
        <Example label="vertical · settings pages">
          <Tabs className="w-full" defaultValue="cloud" orientation="vertical">
            <TabsList className="w-36" variant="line">
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="cloud">Cloud save</TabsTrigger>
              <TabsTrigger value="mcp">MCP access</TabsTrigger>
            </TabsList>
            <TabsContent className="min-w-0" value="account">
              <p className="type-body">Your name and sign-in email.</p>
            </TabsContent>
            <TabsContent className="min-w-0" value="cloud">
              {/* The host name is one long word: let it break at 375px. */}
              <p className="type-body wrap-break-word">
                Every save also goes to your private copy on
                api.pilihpendidikan.com.
              </p>
            </TabsContent>
            <TabsContent className="min-w-0" value="mcp">
              <p className="type-body">
                Personal tokens your AI assistant uses to edit your CV.
              </p>
            </TabsContent>
          </Tabs>
        </Example>
        <Example label="links styled as tabs · tabsListVariants">
          <nav
            aria-label="Portfolio pages"
            className={tabsListVariants({ variant: "line" })}
          >
            {PORTFOLIO_PAGES.map((page) => (
              <a
                aria-current={page.current ? "page" : undefined}
                className={tabsTriggerVariants({ variant: "line" })}
                href="#navigation"
                key={page.label}
              >
                {page.label}
              </a>
            ))}
          </nav>
        </Example>
      </div>
      <StateMatrix
        render={(variant, state) => (
          <Tabs value={state === "selected" ? "content" : ""}>
            <TabsList variant={variant}>
              <TabsTrigger value="content" {...previewState(state)}>
                Content
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        rows={TAB_VARIANTS}
        states={TAB_STATES}
      />
    </Block>
  );
}

/* ── Breadcrumb ────────────────────────────────────────────────────────── */

function BreadcrumbBlock() {
  return (
    <Block
      description="Where this page sits. Muted links that darken on hover, a 14px chevron between levels, the current page in black."
      title="Breadcrumb"
    >
      <Example label="typical">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#navigation">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#navigation">CVs</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Rina Wulandari</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Example>
      <Example label="collapsed levels · the ellipsis opens a menu">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#navigation">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Show hidden levels"
                    size="icon-xs"
                    variant="ghost"
                  >
                    <BreadcrumbEllipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuItem>Portfolios</DropdownMenuItem>
                    <DropdownMenuItem>
                      Apple Developer Academy 2026
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#navigation">Projects</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Sapa</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Example>
      <Example label="long page title · truncated">
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem>
              <BreadcrumbLink href="#navigation">Invoices</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage
                className="max-w-56 truncate"
                title="INV-2026-014 · PT Sinar Digital Nusantara, website redesign and three months of maintenance"
              >
                INV-2026-014 · PT Sinar Digital Nusantara, website redesign and
                three months of maintenance
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Example>
    </Block>
  );
}

/* ── Pagination ────────────────────────────────────────────────────────── */

const LAST_PAGE = 12;

function pageWindow(page: number): (number | "gap-start" | "gap-end")[] {
  if (page <= 3) {
    return [1, 2, 3, 4, "gap-end", LAST_PAGE];
  }
  if (page >= LAST_PAGE - 2) {
    return [
      1,
      "gap-start",
      LAST_PAGE - 3,
      LAST_PAGE - 2,
      LAST_PAGE - 1,
      LAST_PAGE,
    ];
  }
  return [1, "gap-start", page - 1, page, page + 1, "gap-end", LAST_PAGE];
}

function InvoicePagination({ initialPage }: { initialPage: number }) {
  const [page, setPage] = useState(initialPage);
  const go = (next: number) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setPage(Math.min(LAST_PAGE, Math.max(1, next)));
  };
  const atStart = page === 1;
  const atEnd = page === LAST_PAGE;
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={atStart || undefined}
            href="#navigation"
            onClick={go(page - 1)}
            tabIndex={atStart ? -1 : undefined}
          />
        </PaginationItem>
        {pageWindow(page).map((entry) =>
          typeof entry === "number" ? (
            <PaginationItem
              className={cn(Math.abs(entry - page) > 1 && "max-sm:hidden")}
              key={entry}
            >
              <PaginationLink
                href="#navigation"
                isActive={entry === page}
                onClick={go(entry)}
              >
                {entry}
              </PaginationLink>
            </PaginationItem>
          ) : (
            <PaginationItem className="max-sm:hidden" key={entry}>
              <PaginationEllipsis />
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNext
            aria-disabled={atEnd || undefined}
            href="#navigation"
            onClick={go(page + 1)}
            tabIndex={atEnd ? -1 : undefined}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function PaginationBlock() {
  return (
    <Block
      description="Step through long lists. Page links are ghost buttons; the current page is outlined and set in the heading weight. Below 640px Previous and Next drop their words and only the neighbouring pages stay."
      title="Pagination"
    >
      <Example label="many pages · ellipsis on both sides">
        <InvoicePagination initialPage={6} />
      </Example>
      <Example label="first page · Previous is disabled">
        <InvoicePagination initialPage={1} />
      </Example>
    </Block>
  );
}

/* ── Navigation menu ───────────────────────────────────────────────────── */

const BUILDERS = [
  {
    title: "CV builder",
    description: "Four print-faithful templates, exported to PDF or JSON.",
  },
  {
    title: "Invoice builder",
    description: "Rupiah totals, PPN and Indonesian addresses built in.",
  },
  {
    title: "Academy portfolio",
    description:
      "A landscape deck for your Apple Developer Academy application.",
  },
] as const;

const RESOURCES = [
  {
    title: "Writing a CV recruiters read",
    description: "One page per five years, newest first, one line of impact.",
  },
  {
    title: "Connect your AI assistant",
    description: "Mint a personal token and let MCP fill in your CV.",
  },
  {
    title: "Changelog",
    description: "What changed in the builders this month.",
  },
] as const;

function MenuLinks({
  links,
}: {
  links: readonly { title: string; description: string }[];
}) {
  return (
    <ul className="grid w-72 gap-0.5 sm:w-[30rem] sm:grid-cols-2">
      {links.map((link) => (
        <li key={link.title}>
          <NavigationMenuLink
            className="flex-col items-start gap-0.5"
            href="#navigation"
          >
            <span className="weight-semibold">{link.title}</span>
            <span className="type-caption text-muted-foreground">
              {link.description}
            </span>
          </NavigationMenuLink>
        </li>
      ))}
    </ul>
  );
}

function NavigationMenuBlock() {
  return (
    <Block
      description="The site nav: ghost links with a muted chevron. A menu opens instantly in a window under its trigger; the current page takes the heading weight, not a colour."
      title="Navigation menu"
      wide
    >
      <Example
        className="min-h-80 items-start"
        label="hub nav · hover or click Builders"
      >
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Builders</NavigationMenuTrigger>
              <NavigationMenuContent>
                <MenuLinks links={BUILDERS} />
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
              <NavigationMenuContent>
                <MenuLinks links={RESOURCES} />
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                active
                className={navigationMenuTriggerStyle()}
                href="#navigation"
              >
                Docs
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Example>
    </Block>
  );
}

/* ── Menubar ───────────────────────────────────────────────────────────── */

const TEMPLATES = ["Harvard", "Standard", "Simple", "Basic"] as const;

function EditorMenubar() {
  const [graphPaper, setGraphPaper] = useState(true);
  const [pageBreaks, setPageBreaks] = useState(false);
  const [template, setTemplate] = useState<string>("Harvard");
  return (
    <Menubar className="w-fit">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarItem>
              <FilePlus />
              New CV
              <MenubarShortcut>⌘N</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              <Upload />
              Import JSON…
            </MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarSub>
              <MenubarSubTrigger>
                <Download />
                Export
              </MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarGroup>
                  <MenubarItem>PDF</MenubarItem>
                  <MenubarItem>JSON</MenubarItem>
                  <MenubarItem>Markdown</MenubarItem>
                </MenubarGroup>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarItem>
              <Printer />
              Print
              <MenubarShortcut>⌘P</MenubarShortcut>
            </MenubarItem>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarItem>
              <Undo2 />
              Undo
              <MenubarShortcut>⌘Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem disabled>
              <Redo2 />
              Redo
              <MenubarShortcut>⇧⌘Z</MenubarShortcut>
            </MenubarItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarGroup>
            <MenubarItem>Duplicate section</MenubarItem>
            <MenubarItem variant="destructive">
              <Trash2 />
              Delete section
            </MenubarItem>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarCheckboxItem
              checked={graphPaper}
              onCheckedChange={setGraphPaper}
            >
              Graph paper
            </MenubarCheckboxItem>
            <MenubarCheckboxItem
              checked={pageBreaks}
              onCheckedChange={setPageBreaks}
            >
              Page breaks
            </MenubarCheckboxItem>
          </MenubarGroup>
          <MenubarSeparator />
          <MenubarLabel>Template</MenubarLabel>
          <MenubarRadioGroup onValueChange={setTemplate} value={template}>
            {TEMPLATES.map((name) => (
              <MenubarRadioItem key={name} value={name}>
                {name}
              </MenubarRadioItem>
            ))}
          </MenubarRadioGroup>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarItem>Keyboard shortcuts</MenubarItem>
            <MenubarItem>Connect your AI assistant</MenubarItem>
          </MenubarGroup>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

function MenubarBlock() {
  return (
    <Block
      description="Desktop-style menus for an editor toolbar. Triggers are flat; each menu is a window of 2px rows, with a check for toggles and a diamond for the chosen option."
      title="Menubar"
      wide
    >
      <Example label="CV editor · open File, Edit or View">
        <EditorMenubar />
      </Example>
    </Block>
  );
}

/* ── Sidebar ───────────────────────────────────────────────────────────── */

interface CvSection {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  description: string;
}

const CV_SECTIONS: readonly CvSection[] = [
  {
    id: "profile",
    label: "Profile",
    icon: User,
    description: "Name, headline, contact details and a short summary.",
  },
  {
    id: "experience",
    label: "Work experience",
    icon: Briefcase,
    count: 2,
    description: "Roles you held, newest first, each with one line of impact.",
  },
  {
    id: "education",
    label: "Education",
    icon: GraduationCap,
    count: 1,
    description: "Universitas Brawijaya, S.Kom. Informatika, 2021 to 2025.",
  },
  {
    id: "skills",
    label: "Skills",
    icon: Wrench,
    count: 3,
    description: "Grouped by kind: languages, frameworks, tools.",
  },
  {
    id: "awards",
    label: "Awards",
    icon: Award,
    description: "Competitions and scholarships, with the year.",
  },
  {
    id: "languages",
    label: "Languages",
    icon: Languages,
    count: 2,
    description: "Bahasa Indonesia (native) and English (professional).",
  },
];

const EXPERIENCE_ENTRIES = [
  "Frontend Developer · Tokopedia",
  "Software Engineer Intern · Gojek",
] as const;

function SectionsGroup({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Sections</SidebarGroupLabel>
      <SidebarGroupAction title="Add section">
        <Plus />
        <span className="sr-only">Add section</span>
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {CV_SECTIONS.map((section) => (
            <SidebarMenuItem key={section.id}>
              <SidebarMenuButton
                isActive={section.id === active}
                onClick={() => onSelect(section.id)}
              >
                <section.icon aria-hidden="true" />
                <span>{section.label}</span>
              </SidebarMenuButton>
              {section.count ? (
                <SidebarMenuBadge>{section.count}</SidebarMenuBadge>
              ) : null}
              {section.id === "experience" && active === "experience" ? (
                <SidebarMenuSub>
                  {EXPERIENCE_ENTRIES.map((entry) => (
                    <SidebarMenuSubItem key={entry}>
                      <SidebarMenuSubButton asChild>
                        <button type="button">
                          <span>{entry}</span>
                        </button>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function DocumentGroup() {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Document</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <Palette aria-hidden="true" />
              <span>Template</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>Harvard</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <Link2 aria-hidden="true" />
              <span>Share link</span>
            </SidebarMenuButton>
            <SidebarMenuAction showOnHover title="More share options">
              <MoreHorizontal />
              <span className="sr-only">More share options</span>
            </SidebarMenuAction>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <Mail aria-hidden="true" />
              <span>Send to a recruiter</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function CvEditorSidebar() {
  const [active, setActive] = useState("experience");
  const current =
    CV_SECTIONS.find((section) => section.id === active) ?? CV_SECTIONS[0];
  return (
    <div className="flex overflow-hidden border border-line">
      <SidebarProvider className="min-h-0">
        <Sidebar className="w-full sm:w-(--sidebar-width)" collapsible="none">
          <SidebarHeader className="border-sidebar-border border-b">
            <div className="flex items-center gap-2 px-2 pt-1">
              <FileText
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              <span className="type-body-compact weight-semibold truncate text-foreground">
                Rina Wulandari · CV
              </span>
            </div>
            <SidebarInput aria-label="Search sections" placeholder="Search" />
          </SidebarHeader>
          <SidebarContent>
            <SectionsGroup active={active} onSelect={setActive} />
            <DocumentGroup />
            <SidebarGroup>
              <SidebarGroupLabel>Recent exports</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-sidebar-border border-t">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg">
                  <Avatar size="sm">
                    <AvatarFallback>RW</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left">
                    <span className="weight-semibold truncate text-foreground">
                      Rina Wulandari
                    </span>
                    <span className="type-caption truncate text-muted-foreground">
                      rina.wulandari@student.ub.ac.id
                    </span>
                  </div>
                  <ChevronsUpDown
                    aria-hidden="true"
                    className="text-muted-foreground"
                  />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <div className="hidden min-w-0 flex-1 flex-col sm:flex">
          <div className="band flex h-12 shrink-0 items-center justify-between gap-3 px-4">
            <span className="type-body weight-semibold truncate text-foreground">
              {current.label}
            </span>
            <Button size="sm" variant="outline">
              <Download aria-hidden="true" data-icon="inline-start" />
              Export PDF
            </Button>
          </div>
          <div className="graph-paper flex flex-1 flex-col gap-1 p-6">
            <h4 className="type-title">{current.label}</h4>
            <p className="type-body max-w-prose">{current.description}</p>
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}

function SidebarBlock() {
  return (
    <Block
      description="The editor's section list: a pane ruled off by a hairline, caption group labels, compact rows, and one active row on pane-2 in the heading weight. Click a section to move the active row."
      title="Sidebar"
      wide
    >
      <CvEditorSidebar />
    </Block>
  );
}

// Renders: Tabs, Breadcrumb, Pagination, NavigationMenu, Menubar, Sidebar.
export function NavigationSection() {
  return (
    <Section
      id="navigation"
      lead="Nav links are ghost buttons; selected items get the heading weight, not a colour."
      title="Navigation"
    >
      <BlockGrid>
        <TabsBlock />
        <BreadcrumbBlock />
        <PaginationBlock />
        <NavigationMenuBlock />
        <MenubarBlock />
        <SidebarBlock />
      </BlockGrid>
    </Section>
  );
}
