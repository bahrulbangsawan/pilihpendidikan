// Settings (12 §9, 05 §10a), laid out like reui's account-settings blocks: a
// left sub-nav (Account, Language, AI, Your data) and cards of rows. Account
// shows who is signed in; Language saves the UI language and the timezone;
// AI holds the consent and the sensitive-scoring switch (11 §11); Your data
// exports or deletes the account (11 §10). Every change is a PATCH with
// base_revision under the conflict rules.

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
import { useEffect, useId, useState } from "react";
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

  useEffect(() => {
    if (record) {
      setTimezone(record.timezone);
    }
  }, [record]);

  const dirty =
    record !== undefined &&
    timezone.trim() !== "" &&
    timezone.trim() !== record.timezone;

  async function pickLocale(locale: Locale) {
    try {
      await changeLocale(locale);
    } catch {
      toast.error(t("settings.localeFailed"));
    }
  }

  return (
    <SettingsCard
      description={t("settings.displayHelp")}
      footer={
        <>
          <Button
            disabled={!dirty}
            onClick={() => record && setTimezone(record.timezone)}
            size="sm"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => change({ timezone: timezone.trim() })}
            size="sm"
          >
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
          onValueChange={(value) => pickLocale(value as Locale)}
          value={session.locale}
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
  return (
    <SettingsCard
      description={t("settings.aiHelp")}
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
          checked={record.ai_consent_at !== null}
          id={`${id}-ai`}
          onCheckedChange={(value) => change({ ai_consent: value })}
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
          checked={record.ai_scoring_sensitive}
          disabled={record.ai_consent_at === null}
          id={`${id}-sensitive`}
          onCheckedChange={(value) => change({ ai_scoring_sensitive: value })}
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

  let body: ReactNode;
  if (section === "account") {
    body = <AccountSection />;
  } else if (section === "language") {
    body = <LanguageSection change={change} record={record} />;
  } else if (section === "data") {
    body = <DataSection />;
  } else if (record) {
    body = <AiSection change={change} record={record} />;
  } else if (settings.isError) {
    body = (
      <p className="type-body text-destructive">{t("settings.loadFailed")}</p>
    );
  } else {
    body = <Skeleton className="h-40 w-full rounded-lg" />;
  }

  return (
    <SubNavLayout
      description={t("settings.intro")}
      items={items}
      label={t("settings.sectionsLabel")}
      onChange={onSectionChange}
      title={t("settings.title")}
      value={section}
    >
      {body}
    </SubNavLayout>
  );
}
