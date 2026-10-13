// Settings (12 §9, 05 §10a): account, language and theme, automation defaults,
// AI consent (11 §11), evidence screenshots and retention, the MCP approvals
// switch (11 §4.9) and, in a destructive band, export and delete (11 §10).
// Every change is a PATCH with base_revision under the conflict rules.

import type { UpdateSettingsRequest } from "@pilihpendidikan/jobs-contracts/api";
import type {
  ApplicationMode,
  EvidenceScreenshotMode,
  Locale,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  APPLICATION_MODES,
  EVIDENCE_SCREENSHOT_MODES,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { UserSettingsRecord } from "@pilihpendidikan/jobs-contracts/records";
import { EVIDENCE_RETENTION_DAYS } from "@pilihpendidikan/jobs-contracts/records";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Band, Rail } from "@rulisme/ui/ui/rails";
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
import { Download, LogOut, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import type { SessionState } from "@/functions/session.functions";
import { setLocale } from "@/functions/session.functions";
import { useConflictWrite } from "@/hooks/use-conflict-write";
import { useSettings } from "@/hooks/use-profile";
import { useSession, useSignOut } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api-client";
import { newIdempotencyKey } from "@/lib/idempotency";
import { modeLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query";

type SettingsPatch = Omit<UpdateSettingsRequest, "base_revision">;

const SETTINGS_FIELDS = [
  "locale",
  "timezone",
  "default_mode",
  "automation_paused",
  "generated_text_allowed",
  "allow_mcp_approvals",
  "ai_consent_at",
  "ai_scoring_sensitive",
  "evidence_screenshots",
  "evidence_retention_days",
] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Band asChild>
      <section aria-labelledby={id}>
        <Rail
          className="grid gap-4 px-4 py-6 sm:px-8 md:grid-cols-[240px_1fr]"
          nodes={false}
        >
          <div className="flex flex-col gap-1">
            <h2 className="type-subtitle weight-semibold" id={id}>
              {title}
            </h2>
            {description ? (
              <p className="type-caption text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-5">{children}</div>
        </Rail>
      </section>
    </Band>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field orientation="horizontal">
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onChange}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  );
}

function DangerZone() {
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
    <Band asChild>
      <section aria-labelledby="danger-heading">
        <Rail className="px-4 py-6 sm:px-8" nodes={false}>
          <div className="flex flex-col gap-4 border border-destructive/25 p-4">
            <h2 className="type-subtitle weight-semibold" id="danger-heading">
              {t("settings.dangerTitle")}
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <p className="type-body weight-semibold text-foreground">
                  {t("settings.exportTitle")}
                </p>
                <p className="type-caption text-muted-foreground">
                  {t("settings.exportBody")}
                </p>
              </div>
              <Button
                className="shrink-0"
                onClick={exportData}
                variant="outline"
              >
                <Download aria-hidden="true" data-icon="inline-start" />
                {t("settings.export")}
              </Button>
            </div>
            <div className="flex flex-col gap-3 border-destructive/25 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <p className="type-body weight-semibold text-foreground">
                  {t("settings.deleteTitle")}
                </p>
                <p className="type-caption text-muted-foreground">
                  {t("settings.deleteBody")}
                </p>
              </div>
              <AlertDialog onOpenChange={() => setConfirmText("")}>
                <AlertDialogTrigger asChild>
                  <Button className="shrink-0" variant="destructive">
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
            </div>
          </div>
        </Rail>
      </section>
    </Band>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const id = useId();
  const session = useSession();
  const signOut = useSignOut();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const write = useConflictWrite();
  const { resolvedTheme, setTheme } = useTheme();
  const [retention, setRetention] = useState("");
  const [timezone, setTimezone] = useState("");
  const record = settings.data;

  useEffect(() => {
    if (record) {
      setRetention(String(record.evidence_retention_days));
      setTimezone(record.timezone);
    }
  }, [record]);

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

  async function changeLocale(locale: Locale) {
    await setLocale({
      data: { locale, ...(record ? { base_revision: record.revision } : {}) },
    });
    queryClient.setQueryData<SessionState>(queryKeys.session, (state) =>
      state ? { ...state, locale } : state
    );
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
  }

  return (
    <div className="flex flex-col">
      <Band>
        <Rail className="flex flex-col gap-1 px-4 py-6 sm:px-8" nodes={false}>
          <h1 className="type-title">{t("settings.title")}</h1>
          <p className="type-caption text-muted-foreground">
            {t("settings.intro")}
          </p>
        </Rail>
      </Band>
      <Section id="account-heading" title={t("settings.account")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="type-caption text-muted-foreground">
              {t("settings.email")}
            </span>
            <span className="type-body text-foreground">{session.email}</span>
          </div>
          <Button onClick={() => signOut()} variant="outline">
            <LogOut aria-hidden="true" data-icon="inline-start" />
            {t("settings.signOut")}
          </Button>
        </div>
      </Section>
      <Section
        description={t("settings.displayHelp")}
        id="display-heading"
        title={t("settings.display")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-locale`}>
              {t("settings.locale")}
            </FieldLabel>
            <Select
              onValueChange={(value) => changeLocale(value as Locale)}
              value={session.locale}
            >
              <SelectTrigger className="w-full" id={`${id}-locale`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="id">Bahasa Indonesia</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-theme`}>
              {t("settings.theme")}
            </FieldLabel>
            <Select
              onValueChange={setTheme}
              value={resolvedTheme === "dark" ? "dark" : "light"}
            >
              <SelectTrigger className="w-full" id={`${id}-theme`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  {t("settings.themeLight")}
                </SelectItem>
                <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-tz`}>
              {t("settings.timezone")}
            </FieldLabel>
            <Input
              className="field-touch"
              disabled={!record}
              id={`${id}-tz`}
              onBlur={() =>
                record &&
                timezone.trim() &&
                timezone !== record.timezone &&
                change({ timezone: timezone.trim() })
              }
              onChange={(event) => setTimezone(event.target.value)}
              value={timezone}
            />
          </Field>
        </div>
      </Section>
      {record ? (
        <>
          <Section
            description={t("settings.automationHelp")}
            id="automation-heading"
            title={t("settings.automation")}
          >
            <Field>
              <FieldLabel htmlFor={`${id}-mode`}>
                {t("settings.defaultMode")}
              </FieldLabel>
              <Select
                onValueChange={(value) =>
                  change({ default_mode: value as ApplicationMode })
                }
                value={record.default_mode}
              >
                <SelectTrigger className="w-full sm:w-64" id={`${id}-mode`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPLICATION_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {modeLabel(t, mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {t("settings.defaultModeHelp")}
              </FieldDescription>
            </Field>
            <SwitchRow
              checked={record.automation_paused}
              description={t("settings.pausedHelp")}
              id={`${id}-paused`}
              label={t("settings.paused")}
              onChange={(value) => change({ automation_paused: value })}
            />
            <SwitchRow
              checked={record.allow_mcp_approvals}
              description={t("settings.mcpHelp")}
              id={`${id}-mcp`}
              label={t("settings.mcp")}
              onChange={(value) => change({ allow_mcp_approvals: value })}
            />
          </Section>
          <Section
            description={t("settings.aiHelp")}
            id="ai-heading"
            title={t("settings.ai")}
          >
            <SwitchRow
              checked={record.ai_consent_at !== null}
              description={t("settings.aiConsentHelp")}
              id={`${id}-ai`}
              label={t("settings.aiConsent")}
              onChange={(value) => change({ ai_consent: value })}
            />
            <SwitchRow
              checked={record.ai_scoring_sensitive}
              description={t("settings.aiSensitiveHelp")}
              disabled={record.ai_consent_at === null}
              id={`${id}-sensitive`}
              label={t("settings.aiSensitive")}
              onChange={(value) => change({ ai_scoring_sensitive: value })}
            />
            <SwitchRow
              checked={record.generated_text_allowed}
              description={t("settings.generatedTextHelp")}
              disabled={record.ai_consent_at === null}
              id={`${id}-generated`}
              label={t("settings.generatedText")}
              onChange={(value) => change({ generated_text_allowed: value })}
            />
          </Section>
          <Section
            description={t("settings.evidenceHelp")}
            id="evidence-heading"
            title={t("settings.evidence")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-shots`}>
                  {t("settings.screenshots")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    change({
                      evidence_screenshots: value as EvidenceScreenshotMode,
                    })
                  }
                  value={record.evidence_screenshots}
                >
                  <SelectTrigger className="w-full" id={`${id}-shots`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_SCREENSHOT_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`settings.screenshotModes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-retention`}>
                  {t("settings.retention")}
                </FieldLabel>
                <Input
                  className="field-touch"
                  id={`${id}-retention`}
                  max={EVIDENCE_RETENTION_DAYS.max}
                  min={EVIDENCE_RETENTION_DAYS.min}
                  onBlur={() => {
                    const days = Number.parseInt(retention, 10);
                    if (
                      Number.isInteger(days) &&
                      days >= EVIDENCE_RETENTION_DAYS.min &&
                      days <= EVIDENCE_RETENTION_DAYS.max &&
                      days !== record.evidence_retention_days
                    ) {
                      change({ evidence_retention_days: days });
                    }
                  }}
                  onChange={(event) => setRetention(event.target.value)}
                  type="number"
                  value={retention}
                />
                <FieldDescription>
                  {t("settings.retentionHelp", {
                    min: EVIDENCE_RETENTION_DAYS.min,
                    max: EVIDENCE_RETENTION_DAYS.max,
                  })}
                </FieldDescription>
              </Field>
            </div>
          </Section>
        </>
      ) : (
        <Band>
          <Rail className="px-4 py-6 sm:px-8" nodes={false}>
            {settings.isError ? (
              <p className="type-body text-destructive">
                {t("settings.loadFailed")}
              </p>
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </Rail>
        </Band>
      )}
      <DangerZone />
    </div>
  );
}
