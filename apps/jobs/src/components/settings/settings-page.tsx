// Settings (12 §9, 05 §10a), laid out like reui's account-settings blocks:
// every section stacked on one page (Account, Language & region, AI, Your
// data) and a left sub-nav of anchor links that highlights the section in
// view (`?section=` scrolls to it). Account shows who is signed in; Language
// stages the UI language and the timezone; AI stages the consent and the
// sensitive-scoring switch (11 §11); both save from their Cancel / Save
// footer. Your data exports or deletes the account (11 §10). Every change is
// a PATCH with base_revision under the conflict rules.

import type { UpdateSettingsRequest } from "@pilihpendidikan/jobs-contracts/api";
import type { Locale } from "@pilihpendidikan/jobs-contracts/enums";
import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
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
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import { Field, FieldLabel } from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Skeleton } from "@rulisme/ui/ui/skeleton";
import { Switch } from "@rulisme/ui/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  Database,
  Download,
  Globe,
  Languages,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { SubNavItem } from "@rulisme/ui/blocks/settings";
import {
  SettingsCard,
  SettingsRow,
  SubNavLayout,
} from "@rulisme/ui/blocks/settings";
import { useChangeLocale } from "@/components/shell/use-change-locale";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import { useSettings } from "@/hooks/use-profile";
import { useSession, useSignOut } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { queryKeys } from "@/lib/query";

type SettingsPatch = Omit<UpdateSettingsRequest, "base_revision">;

export const SETTINGS_SECTIONS = ["account", "language", "ai", "data"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SECTION_ICONS = {
  account: UserRound,
  language: Languages,
  ai: Sparkles,
  data: Database,
} as const;

const SETTINGS_FIELDS = [
  "locale",
  "timezone",
  "ai_consent_at",
  "ai_scoring_sensitive",
] as const;

/** The anchor id of a section (`#settings-language`). */
function sectionAnchor(section: SettingsSection): string {
  return `settings-section-${section}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToSection(section: SettingsSection, smooth: boolean) {
  document.getElementById(sectionAnchor(section))?.scrollIntoView({
    behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
    block: "start",
  });
}

/** Line under the top bar where a section counts as "in view". */
const SPY_LINE_PX = 120;

/** The section in view while the page scrolls: the last one whose top has
 * passed the line under the top bar. A section picked from the sub-nav (or
 * `?section=` on load) stays current until the reader scrolls by hand, so a
 * short last section that cannot reach the top still lights up. */
function useSectionInView(initial: SettingsSection): {
  active: SettingsSection;
  pick: (section: SettingsSection) => void;
} {
  const [active, setActive] = useState<SettingsSection>(initial);
  const [initialSection] = useState(initial);
  const pinned = useRef<SettingsSection | null>(
    initial === "account" ? null : initial
  );

  useEffect(() => {
    if (initialSection !== "account") {
      scrollToSection(initialSection, false);
    }
  }, [initialSection]);

  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      if (pinned.current) {
        setActive(pinned.current);
        return;
      }
      let current: SettingsSection = SETTINGS_SECTIONS[0];
      for (const value of SETTINGS_SECTIONS) {
        const element = document.getElementById(sectionAnchor(value));
        if (element && element.getBoundingClientRect().top <= SPY_LINE_PX) {
          current = value;
        }
      }
      setActive(current);
    }
    function onScroll() {
      if (frame === 0) {
        frame = window.requestAnimationFrame(measure);
      }
    }
    function release() {
      pinned.current = null;
    }
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const pick = useCallback((section: SettingsSection) => {
    pinned.current = section;
    setActive(section);
    scrollToSection(section, true);
  }, []);

  return { active, pick };
}

function AccountSection() {
  const { t } = useTranslation();
  const session = useSession();
  const signOut = useSignOut();
  return (
    <SettingsCard
      description={t("settings.accountHelp")}
      id="settings-account"
      title={t("settings.account")}
    >
      <SettingsRow
        control="end"
        description={t("settings.emailHelp")}
        icon={Mail}
        label={t("settings.email")}
      >
        <span className="type-body truncate text-foreground">
          {session.email}
        </span>
      </SettingsRow>
      <SettingsRow
        description={t("settings.signOutHelp")}
        icon={LogOut}
        control="end"
        label={t("settings.signOut")}
      >
        <Button onClick={() => signOut()} size="sm" variant="outline">
          {t("settings.signOut")}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

function LanguageSection({
  record,
  change,
}: {
  record: UserSettingsRecord | undefined;
  change: (patch: SettingsPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const session = useSession();
  const changeLocale = useChangeLocale();
  const [timezone, setTimezone] = useState("");
  const [locale, setLocale] = useState<Locale>(session.locale);

  useEffect(() => {
    if (record) {
      setTimezone(record.timezone);
    }
  }, [record]);

  useEffect(() => {
    setLocale(session.locale);
  }, [session.locale]);

  const timezoneDirty =
    record !== undefined &&
    timezone.trim() !== "" &&
    timezone.trim() !== record.timezone;
  const localeDirty = locale !== session.locale;
  const dirty = timezoneDirty || localeDirty;

  function cancel() {
    setLocale(session.locale);
    if (record) {
      setTimezone(record.timezone);
    }
  }

  async function save() {
    if (timezoneDirty) {
      await change({ timezone: timezone.trim() });
    }
    if (localeDirty) {
      try {
        await changeLocale(locale);
      } catch {
        toast.error(t("settings.localeFailed"));
      }
    }
  }

  return (
    <SettingsCard
      description={t("settings.displayHelp")}
      footer={
        <>
          <Button
            disabled={!dirty}
            onClick={cancel}
            size="sm"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={!dirty} onClick={save} size="sm">
            {t("settings.saveChanges")}
          </Button>
        </>
      }
      id="settings-language"
      title={t("settings.display")}
    >
      <SettingsRow
        description={t("settings.localeHelp")}
        htmlFor={`${id}-locale`}
        icon={Languages}
        label={t("settings.locale")}
      >
        <Select
          onValueChange={(value) => setLocale(value as Locale)}
          value={locale}
        >
          <SelectTrigger className="w-full" id={`${id}-locale`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">
              <Globe aria-hidden="true" />
              English
            </SelectItem>
            <SelectItem value="id">
              <Globe aria-hidden="true" />
              Bahasa Indonesia
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        description={t("settings.timezoneHelp")}
        htmlFor={`${id}-tz`}
        icon={Clock}
        label={t("settings.timezone")}
      >
        <Input
          className="field-touch w-full"
          disabled={!record}
          id={`${id}-tz`}
          onChange={(event) => setTimezone(event.target.value)}
          placeholder={t("settings.timezonePlaceholder")}
          value={timezone}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

function AiSection({
  record,
  change,
}: {
  record: UserSettingsRecord;
  change: (patch: SettingsPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [consent, setConsent] = useState(record.ai_consent_at !== null);
  const [sensitive, setSensitive] = useState(record.ai_scoring_sensitive);

  useEffect(() => {
    setConsent(record.ai_consent_at !== null);
    setSensitive(record.ai_scoring_sensitive);
  }, [record]);

  const consentDirty = consent !== (record.ai_consent_at !== null);
  const sensitiveDirty = sensitive !== record.ai_scoring_sensitive;
  const dirty = consentDirty || sensitiveDirty;

  function cancel() {
    setConsent(record.ai_consent_at !== null);
    setSensitive(record.ai_scoring_sensitive);
  }

  async function save() {
    const patch: SettingsPatch = {};
    if (consentDirty) {
      patch.ai_consent = consent;
    }
    if (sensitiveDirty) {
      patch.ai_scoring_sensitive = sensitive;
    }
    await change(patch);
  }

  return (
    <SettingsCard
      description={t("settings.aiHelp")}
      footer={
        <>
          <Button
            disabled={!dirty}
            onClick={cancel}
            size="sm"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={!dirty} onClick={save} size="sm">
            {t("settings.saveChanges")}
          </Button>
        </>
      }
      id="settings-ai"
      title={t("settings.ai")}
    >
      <SettingsRow
        description={t("settings.aiConsentHelp")}
        htmlFor={`${id}-ai`}
        icon={Sparkles}
        control="end"
        label={t("settings.aiConsent")}
      >
        <Switch
          checked={consent}
          id={`${id}-ai`}
          onCheckedChange={setConsent}
        />
      </SettingsRow>
      <SettingsRow
        description={t("settings.aiSensitiveHelp")}
        htmlFor={`${id}-sensitive`}
        icon={ShieldCheck}
        control="end"
        label={t("settings.aiSensitive")}
      >
        <Switch
          checked={sensitive}
          disabled={!consent}
          id={`${id}-sensitive`}
          onCheckedChange={setSensitive}
        />
      </SettingsRow>
    </SettingsCard>
  );
}

function DataSection() {
  const { t } = useTranslation();
  const id = useId();
  const [confirmText, setConfirmText] = useState("");
  const [alsoCvs, setAlsoCvs] = useState(false);
  const word = t("settings.deleteWord");

  async function exportData() {
    try {
      await api("POST /api/v1/account/export", {
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("settings.exportStarted"));
    } catch {
      toast.error(t("settings.exportFailed"));
    }
  }

  async function deleteAccount() {
    try {
      await api("POST /api/v1/account/delete", {
        body: { also_delete_cvs: alsoCvs },
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(t("settings.deleteRequested"));
    } catch {
      toast.error(t("settings.deleteFailed"));
    }
  }

  return (
    <SettingsCard
      description={t("settings.dataHelp")}
      id="settings-data"
      title={t("settings.dangerTitle")}
      tone="destructive"
    >
      <SettingsRow
        description={t("settings.exportBody")}
        icon={Download}
        control="end"
        label={t("settings.exportTitle")}
      >
        <Button onClick={exportData} size="sm" variant="outline">
          <Download aria-hidden="true" data-icon="inline-start" />
          {t("settings.export")}
        </Button>
      </SettingsRow>
      <SettingsRow
        description={t("settings.deleteBody")}
        icon={Trash2}
        control="end"
        label={t("settings.deleteTitle")}
      >
        <AlertDialog onOpenChange={() => setConfirmText("")}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              {t("settings.delete")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings.deleteConfirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.deleteConfirmBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Field orientation="horizontal">
              <Checkbox
                checked={alsoCvs}
                id={`${id}-cvs`}
                onCheckedChange={(value) => setAlsoCvs(value === true)}
              />
              <FieldLabel htmlFor={`${id}-cvs`}>
                {t("settings.alsoCvs")}
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-confirm`}>
                {t("settings.deleteType", { word })}
              </FieldLabel>
              <Input
                autoComplete="off"
                className="field-touch"
                id={`${id}-confirm`}
                onChange={(event) => setConfirmText(event.target.value)}
                value={confirmText}
              />
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={
                  confirmText.trim().toLocaleLowerCase() !==
                  word.toLocaleLowerCase()
                }
                onClick={deleteAccount}
                variant="destructive"
              >
                {t("settings.deleteAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsRow>
    </SettingsCard>
  );
}

export function SettingsPage({
  section,
  onSectionChange,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const write = useConflictWrite();
  const record = settings.data;
  const { active, pick } = useSectionInView(section);

  async function change(patch: SettingsPatch) {
    if (!record) {
      return;
    }
    await write<UserSettingsRecord>(
      {
        base: record,
        changes: patch,
        fields: SETTINGS_FIELDS,
        send: async (baseRevision, changes) =>
          (
            await api("PATCH /api/v1/settings", {
              body: {
                ...(changes as SettingsPatch),
                base_revision: baseRevision,
              },
              idempotencyKey: newIdempotencyKey(),
            })
          ).settings,
      },
      {
        what: t("settings.what"),
        onSaved: (saved) => queryClient.setQueryData(queryKeys.settings, saved),
      }
    );
  }

  const items: SubNavItem<SettingsSection>[] = SETTINGS_SECTIONS.map(
    (value) => ({
      value,
      icon: SECTION_ICONS[value],
      label: t(`settings.sections.${value}`),
    })
  );

  let ai: ReactNode;
  if (record) {
    ai = <AiSection change={change} record={record} />;
  } else if (settings.isError) {
    ai = (
      <p className="type-body text-destructive">{t("settings.loadFailed")}</p>
    );
  } else {
    ai = <Skeleton className="h-40 w-full rounded-xl" />;
  }

  const bodies: Record<SettingsSection, ReactNode> = {
    account: <AccountSection />,
    language: <LanguageSection change={change} record={record} />,
    ai,
    data: <DataSection />,
  };

  return (
    <SubNavLayout
      description={t("settings.intro")}
      hrefOf={(value) => `#${sectionAnchor(value)}`}
      items={items}
      label={t("settings.sectionsLabel")}
      onChange={(value) => {
        pick(value);
        onSectionChange(value);
      }}
      title={t("settings.title")}
      value={active}
    >
      {SETTINGS_SECTIONS.map((value) => (
        <div
          className="scroll-mt-16"
          data-settings-section={value}
          id={sectionAnchor(value)}
          key={value}
        >
          {bodies[value]}
        </div>
      ))}
    </SubNavLayout>
  );
}
