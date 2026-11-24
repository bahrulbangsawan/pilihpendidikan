import { AppBrand } from "@rulisme/ui/blocks/app-brand";
import { GhostPage } from "@rulisme/ui/blocks/ghost-page";
import {
  Kanban,
  KanbanCard,
  KanbanCollapsedColumn,
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnEmpty,
  KanbanColumnHeader,
} from "@rulisme/ui/blocks/kanban";
import {
  PageContent,
  PageGutter,
  PageHeader,
  PageSection,
} from "@rulisme/ui/blocks/page";
import { DocHeader } from "@rulisme/ui/blocks/doc-header";
import {
  SectionCard,
  SettingsCard,
  SettingsRow,
  SubNavLayout,
} from "@rulisme/ui/blocks/settings";
import { UserMenu } from "@rulisme/ui/blocks/user-menu";
import { WindowFrame } from "@rulisme/ui/blocks/window-frame";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@rulisme/ui/ui/dropdown-menu";
import { EntityAvatar } from "@rulisme/ui/ui/entity-avatar";
import { Input } from "@rulisme/ui/ui/input";
import { Meter } from "@rulisme/ui/ui/meter";
import { PropertyChip } from "@rulisme/ui/ui/property-chip";
import { StatCard, StatGrid } from "@rulisme/ui/ui/stat-card";
import { Switch } from "@rulisme/ui/ui/switch";
import {
  Bell,
  CalendarCheck,
  Circle,
  CircleArrowRight,
  CircleDashed,
  CircleDot,
  CircleX,
  Ellipsis,
  Globe,
  Keyboard,
  LogOut,
  MapPin,
  Plus,
  Settings,
  Shield,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Block, BlockGrid, Example, Section } from "../layout";

// Patterns: the composites in `packages/ui/src/blocks` (and the small
// primitives they are built from). Each takes its content as props, with no
// app hooks or copy inside, so every app can lay out the same screens.

const LANES = [
  {
    id: "saved",
    title: "Saved",
    icon: <CircleDashed aria-hidden="true" className="size-4 text-ink-sec" />,
    cards: [
      { company: "Gojek", title: "iOS Engineer Intern", score: 82 },
      { company: "Traveloka", title: "Product Designer", score: 61 },
    ],
  },
  {
    id: "applied",
    title: "Applied",
    icon: <CircleArrowRight aria-hidden="true" className="size-4 text-link" />,
    cards: [{ company: "Tokopedia", title: "Frontend Engineer", score: 44 }],
  },
  {
    id: "interviewing",
    title: "Interviewing",
    icon: <CircleDot aria-hidden="true" className="size-4 text-link" />,
    cards: [],
  },
] as const;

function KanbanBlock() {
  const [collapsed, setCollapsed] = useState(true);
  const [selected, setSelected] = useState("Gojek");
  return (
    <Block
      description="Render-only lanes after reui's kanban: the app keeps its drag and drop and passes refs and listeners. A lane is a 296px well on card with a 1px border and 12px corners, 12px of padding and 12px between cards (16px inside each); the header carries a status icon, the title, a count and a menu; the body washes when a card hovers it and tints red when the move is not allowed; a collapsed lane is a 44px strip that expands on click."
      title="Kanban"
      wide
    >
      <Example label="Lanes: cards (one selected, one saving), empty, blocked, collapsed">
        <Kanban className="h-auto">
          {LANES.map((lane) => (
            <KanbanColumn aria-labelledby={`lane-${lane.id}`} key={lane.id}>
              <KanbanColumnHeader
                actions={
                  <Button
                    aria-label={`${lane.title} menu`}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Ellipsis aria-hidden="true" />
                  </Button>
                }
                count={lane.cards.length}
                icon={lane.icon}
                title={lane.title}
                titleId={`lane-${lane.id}`}
              />
              <KanbanColumnContent
                state={lane.id === "applied" ? "over" : "idle"}
              >
                {lane.cards.map((card) => (
                  <KanbanCard
                    key={card.company}
                    onClick={() => setSelected(card.company)}
                    pending={card.company === "Traveloka"}
                    selected={selected === card.company}
                  >
                    <span className="type-body weight-semibold text-foreground">
                      {card.title}
                    </span>
                    <span className="type-body-compact inline-flex items-center gap-1.5 text-muted-foreground">
                      <EntityAvatar name={card.company} size="xs" />
                      {card.company}
                    </span>
                    <Meter label="Match" value={card.score} />
                  </KanbanCard>
                ))}
                {lane.cards.length === 0 ? (
                  <KanbanColumnEmpty>Drop a card here</KanbanColumnEmpty>
                ) : null}
              </KanbanColumnContent>
            </KanbanColumn>
          ))}
          <KanbanColumn aria-labelledby="lane-offer">
            <KanbanColumnHeader
              count={0}
              icon={
                <Circle aria-hidden="true" className="size-4 text-success" />
              }
              title="Offer"
              titleId="lane-offer"
            />
            <KanbanColumnContent state="blocked">
              <p className="type-caption px-1 text-destructive">
                Saved cards can't move straight to Offer.
              </p>
            </KanbanColumnContent>
          </KanbanColumn>
          {collapsed ? (
            <KanbanCollapsedColumn
              aria-label="Rejected"
              count={12}
              expandLabel="Expand Rejected (12)"
              icon={
                <CircleX
                  aria-hidden="true"
                  className="size-4 text-destructive"
                />
              }
              onExpand={() => setCollapsed(false)}
              title="Rejected"
            />
          ) : (
            <KanbanColumn aria-labelledby="lane-rejected">
              <KanbanColumnHeader
                actions={
                  <Button
                    onClick={() => setCollapsed(true)}
                    size="xs"
                    variant="ghost"
                  >
                    Collapse
                  </Button>
                }
                count={12}
                icon={
                  <CircleX
                    aria-hidden="true"
                    className="size-4 text-destructive"
                  />
                }
                title="Rejected"
                titleId="lane-rejected"
              />
              <KanbanColumnContent>
                <KanbanCard dashed muted>
                  <span className="type-body text-foreground">
                    Archived card
                  </span>
                </KanbanCard>
              </KanbanColumnContent>
            </KanbanColumn>
          )}
        </Kanban>
      </Example>
    </Block>
  );
}

function StatsBlock() {
  return (
    <Block
      description="StatCard: reui's nested frame (a 12px outer frame, 4px of padding, an 8px inner panel one step darker), a 13px muted label with the … menu in its corner, the 22px value, a tinted delta chip with an arrow and a matching border (green up, red down, a neutral bordered chip at zero) and a 12px footer under a hairline; StatGrid lays them out two, then four across. Meter is a labelled 4px bar, neutral ink by default (the number carries the value); a fixed tone only where it must alarm; `inline` is a 64px bar with the value on its right (list rows)."
      title="Stat card and meter"
      wide
    >
      <Example label="Four stats with deltas" stack>
        <StatGrid aria-label="This month">
          <StatCard
            action={
              <Button
                aria-label="More for Applications"
                className="text-muted-foreground"
                size="icon-sm"
                variant="ghost"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            }
            delta={{ direction: "up", label: "+12%" }}
            footer="vs. 25 last month"
            label="Applications"
            value={28}
          />
          <StatCard
            delta={{ direction: "down", label: "−3" }}
            footer="vs. 9 last month"
            label="Interviews"
            value={6}
          />
          <StatCard
            delta={{ direction: "flat", label: "0" }}
            footer="vs. 1 last month"
            label="Offers"
            value={1}
          />
          <StatCard
            footer="No earlier period"
            label="Response rate"
            value="32%"
          />
        </StatGrid>
      </Example>
      <Example
        label="Meters: neutral at any value, one fixed tone, inline"
        stack
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Meter label="Match" value={86} />
          <Meter label="Match" value={58} />
          <Meter label="Match" value={21} />
          <Meter
            label="Quota"
            tone="destructive"
            value={95}
            valueLabel="19 / 20"
          />
        </div>
        <div className="flex flex-wrap gap-6">
          <Meter inline value={87} />
          <Meter inline value={42} />
        </div>
      </Example>
    </Block>
  );
}

function IdentityBlock() {
  return (
    <Block
      description="EntityAvatar: up to two initials from a name (or the image), round or square. PropertyChip: a 32px outlined fact chip (8px corners) with an icon and a muted label; propertyChipClassName gives a select trigger the same chip. Badge tone: a 4px status chip on a 12% tint with a dot and tone text (stages: neutral, violet, blue, amber, success, destructive); `dot={false}` makes the 20px borderless mini-badge beside a label (a value's provenance: From CV, Suggested; see Settings below). SectionCard: the nested frame (title on a 12px frame, content in an 8px inner panel), or flat inside a sheet."
      title="Avatar, property chips, section card"
      wide
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Example label="Sizes and shapes" stack>
          <div className="flex items-center gap-3">
            <EntityAvatar name="Acme Robotics" size="xs" />
            <EntityAvatar name="Acme Robotics" size="sm" />
            <EntityAvatar name="Acme Robotics" size="default" />
            <EntityAvatar name="Acme Robotics" size="lg" />
            <EntityAvatar fallback="rina@example.com" name="" shape="square" />
            <EntityAvatar name="Rina Kartika" shape="square" size="lg" />
          </div>
        </Example>
        <Example label="Properties under a record's title" stack>
          <div className="flex flex-wrap gap-1.5">
            <PropertyChip icon={<Sparkles aria-hidden="true" />} label="Match">
              82%
            </PropertyChip>
            <PropertyChip icon={<MapPin aria-hidden="true" />} label="Location">
              Jakarta · Hybrid
            </PropertyChip>
            <PropertyChip icon={<Globe aria-hidden="true" />} label="Source">
              Greenhouse
            </PropertyChip>
            <PropertyChip
              icon={<CalendarCheck aria-hidden="true" />}
              label="Applied"
            >
              12 Nov
            </PropertyChip>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">Saved</Badge>
            <Badge tone="violet">Preparing</Badge>
            <Badge tone="blue">Ready</Badge>
            <Badge tone="amber">Applied</Badge>
            <Badge tone="success">Interviewing</Badge>
            <Badge tone="destructive">Rejected</Badge>
          </div>
        </Example>
        <Example label="Section card" stack>
          <SectionCard
            action={
              <Button size="xs" variant="ghost">
                <Plus aria-hidden="true" data-icon="inline-start" />
                Add
              </Button>
            }
            id="pattern-notes"
            title="Notes"
          >
            <p className="type-body text-muted-foreground">
              Recruiter asked for a portfolio link before Friday.
            </p>
          </SectionCard>
          <div className="flex flex-col divide-y divide-border *:py-4">
            <SectionCard flat id="pattern-flat-next" title="Next step">
              <p className="type-body text-pretty">
                Flat: no box, split from the next section by a hairline.
              </p>
            </SectionCard>
            <SectionCard flat id="pattern-flat-notes" title="Interviews">
              <p className="type-caption text-muted-foreground">
                No interviews yet.
              </p>
            </SectionCard>
          </div>
        </Example>
      </div>
    </Block>
  );
}

const SETTINGS_NAV = [
  { value: "account", label: "Account", icon: UserRound },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "security", label: "Security", icon: Shield },
] as const;

function SettingsBlock() {
  const [tab, setTab] =
    useState<(typeof SETTINGS_NAV)[number]["value"]>("account");
  return (
    <Block
      description="SubNavLayout: a page title, a left sub-nav (a fading tab row on phones) and a content column held to 640px. SettingsCard: reui's nested frame — the title (weight 500) and description on a 12px outer frame, SettingsRows split by hairlines in an 8px inner panel one step darker (a 2 / 3 grid: a weight-500 label and a one-line description, then the control, full width or control end for a switch or button; stacked on phones; optional icon tile and badge), and Cancel (left) / Save (right) on the frame below the panel; tone destructive for a danger zone."
      title="Settings"
      wide
    >
      <Example>
        <SubNavLayout
          description="How the dashboard works for you."
          items={SETTINGS_NAV}
          label="Settings sections"
          onChange={setTab}
          title="Settings"
          value={tab}
        >
          <SettingsCard
            description="Shown on your CV and in emails to recruiters."
            footer={
              <>
                <Button size="sm" variant="outline">
                  Cancel
                </Button>
                <Button disabled size="sm">
                  Save changes
                </Button>
              </>
            }
            id="pattern-settings-profile"
            title="Profile"
          >
            <SettingsRow
              badge={
                <Badge dot={false} tone="neutral">
                  From CV
                </Badge>
              }
              description="As it appears on applications."
              htmlFor="pattern-name"
              label="Full name"
            >
              <Input defaultValue="Rina Kartika" id="pattern-name" />
            </SettingsRow>
            <SettingsRow
              badge={
                <Badge dot={false} tone="blue">
                  Suggested
                </Badge>
              }
              description="Where recruiters reply."
              htmlFor="pattern-email"
              label="Email"
            >
              <Input
                id="pattern-email"
                placeholder="you@example.com"
                type="email"
              />
            </SettingsRow>
            <SettingsRow
              badge={<Badge variant="secondary">Beta</Badge>}
              control="end"
              description="A daily digest of new matches."
              icon={Bell}
              label="Email digest"
            >
              <Switch aria-label="Email digest" defaultChecked />
            </SettingsRow>
          </SettingsCard>
          <SettingsCard
            description="Removes every application and file."
            id="pattern-settings-danger"
            inset={false}
            title="Delete account"
            tone="destructive"
          >
            <Button className="self-start" size="sm" variant="destructive">
              Delete account
            </Button>
          </SettingsCard>
        </SubNavLayout>
      </Example>
    </Block>
  );
}

function PageBlock() {
  return (
    <Block
      description="The frame of an app screen: PageHeader (title, count badge, description, actions, an optional row under it), PageContent and PageSection on one gutter, held to a 1024px reading column unless wide."
      title="Page frame"
      wide
    >
      <Example>
        <PageHeader
          actions={
            <Button size="sm">
              <Plus aria-hidden="true" data-icon="inline-start" />
              New job
            </Button>
          }
          count={28}
          description="Every application you are tracking, by stage."
          title="Board"
        />
        <PageContent>
          <p className="type-body text-muted-foreground">
            PageContent holds a block of content to the column.
          </p>
        </PageContent>
        <PageSection
          description="A label column beside its content."
          id="pattern-page-section"
          title="Page section"
        >
          <p className="type-body text-muted-foreground">Section content.</p>
        </PageSection>
        <PageGutter className="pb-6">
          <p className="type-caption text-muted-foreground">
            PageGutter: a plain block on the shared gutter.
          </p>
        </PageGutter>
      </Example>
    </Block>
  );
}

function DocHeaderBlock() {
  return (
    <Block
      description="DocHeader: the docs-style header of a document form (cursor.com/docs) — a muted 13px area line, the title (36px at weight 400 from md up, 22px on phones) and a muted 16px lead, 8px apart with 16px above the lead. The builders put it on top of their form columns with 32px to the first section."
      title="Document header"
    >
      <Example>
        <DocHeader
          area="CV builder"
          lead="Fill in your details; the preview and the PDF follow as you type."
          title="Your CV"
        />
      </Example>
    </Block>
  );
}

function ChromeBlock() {
  return (
    <Block
      description="AppBrand: the mark and name at the left of a toolbar (the name hides on phones). UserMenu: the account row at the foot of a sidebar and its menu, items passed in. GhostPage: an empty document in A4 proportions. WindowFrame: a desktop window for product shots."
      title="App chrome"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Example
          label="Brand in a toolbar; user menu, open and collapsed"
          stack
        >
          <div className="flex h-12 items-center border-border border-b">
            <AppBrand name="CV Builder" src="/favicon-32x32.png" />
          </div>
          <div className="flex items-end gap-3">
            <div className="w-60 rounded-lg border border-border bg-sidebar p-1">
              <UserMenu
                email="rina@example.com"
                label="Account: rina@example.com"
                name="Rina Kartika"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <UserRound aria-hidden="true" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings aria-hidden="true" />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <Keyboard aria-hidden="true" />
                    Keyboard shortcuts
                    <DropdownMenuShortcut>?</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <LogOut aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </UserMenu>
            </div>
            <div className="w-14 rounded-lg border border-border bg-sidebar p-1">
              <UserMenu
                collapsed
                email="rina@example.com"
                label="Account: rina@example.com"
              >
                <DropdownMenuItem>
                  <LogOut aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </UserMenu>
            </div>
          </div>
        </Example>
        <Example label="Ghost pages: portrait, landscape" stack>
          <div className="grid grid-cols-[2fr_3fr] items-start gap-3 bg-card p-3">
            <GhostPage
              description="Start filling in the form."
              title="Your CV is empty"
            />
            <GhostPage
              description="Add a project to see the deck."
              orientation="landscape"
            />
          </div>
        </Example>
      </div>
      <Example label="Window frame">
        <div className="bg-stage-warm p-6">
          <WindowFrame
            className="w-full max-w-xl"
            title="pilihpendidikan — cv.json"
          >
            <div className="grid h-40 place-items-center bg-pane">
              <span className="type-caption text-muted-foreground">
                Product shot
              </span>
            </div>
          </WindowFrame>
        </div>
      </Example>
    </Block>
  );
}

// Renders: Kanban (+ parts), StatCard, StatGrid, Meter, EntityAvatar,
// PropertyChip, SectionCard, SubNavLayout, SettingsCard, SettingsRow,
// PageHeader, PageContent, PageSection, PageGutter, AppBrand, UserMenu,
// GhostPage, WindowFrame.
export function PatternsSection() {
  return (
    <Section
      id="patterns"
      lead="Composites from packages/ui/src/blocks: screen frames, settings, a kanban, stats and app chrome. They take their content as props, so every app lays out the same screens."
      title="Patterns"
    >
      <BlockGrid>
        <PageBlock />
        <DocHeaderBlock />
        <SettingsBlock />
        <KanbanBlock />
        <StatsBlock />
        <IdentityBlock />
        <ChromeBlock />
      </BlockGrid>
    </Section>
  );
}
