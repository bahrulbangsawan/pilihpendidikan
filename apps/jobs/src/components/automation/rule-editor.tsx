// The rule editor Sheet (12 §6.2): criteria, limits (D-35), allowed domains
// and CV policy. Validation mirrors the API (19 §8.3) so an `auto` rule is
// explained before it is sent; the server still has the last word.

import type {
  RuleMode,
  WorkplaceType,
} from "@pilihpendidikan/jobs-contracts/enums";
import {
  RULE_MODES,
  WORKPLACE_TYPES,
} from "@pilihpendidikan/jobs-contracts/enums";
import type { AutomationRuleRecord } from "@pilihpendidikan/jobs-contracts/records";
import { RULE_LIMIT_DEFAULTS } from "@pilihpendidikan/jobs-contracts/records";
import type { SeniorityLevel } from "@pilihpendidikan/jobs-contracts/scoring";
import { SENIORITY_LEVELS } from "@pilihpendidikan/jobs-contracts/scoring";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rulisme/ui/ui/field";
import { Input } from "@rulisme/ui/ui/input";
import { Kbd } from "@rulisme/ui/ui/kbd";
import { RadioGroup, RadioGroupItem } from "@rulisme/ui/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Separator } from "@rulisme/ui/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@rulisme/ui/ui/sheet";
import { Slider } from "@rulisme/ui/ui/slider";
import { Switch } from "@rulisme/ui/ui/switch";
import type { FormEvent, ReactNode } from "react";
import { useId, useState } from "react";
import { useBaseCvs } from "@/hooks/use-cvs";
import { useRuleSources } from "@/hooks/use-rules";
import { useTranslation } from "@/i18n";
import { modeLabel } from "@/lib/labels";
import type { RuleForm, RuleProblems } from "@/lib/rules-form";
import {
  activationSentence,
  emptyRuleForm,
  formCriteria,
  formLimits,
  hasProblems,
  normalizeDomain,
  RULE_LIST_LIMITS,
  ruleToForm,
  validateRuleForm,
  withMode,
} from "@/lib/rules-form";
import { ChipsInput } from "./chips-input";

const NO_CV = "none";
const SCORE_STEP = 5;

function toggle<T>(values: readonly T[], value: T, on: boolean): T[] {
  return on
    ? [...values.filter((entry) => entry !== value), value]
    : values.filter((entry) => entry !== value);
}

function Problem({
  problems,
  field,
}: {
  problems: RuleProblems;
  field: keyof RuleProblems;
}) {
  const { t } = useTranslation();
  const key = problems[field];
  return key ? <FieldError>{t(key)}</FieldError> : null;
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <FieldSet className="gap-4">
      <FieldLegend>{legend}</FieldLegend>
      {children}
    </FieldSet>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  description,
  problem,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  description?: string;
  problem?: ReactNode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        className="field-touch w-28 tabular-nums"
        id={id}
        inputMode="numeric"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={Number.isFinite(value) ? value : ""}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {problem}
    </Field>
  );
}

export function RuleEditor({
  open,
  rule,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  /** The rule being edited, or null for a new one. */
  rule: AutomationRuleRecord | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: RuleForm) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const cvs = useBaseCvs(open);
  const sources = useRuleSources();
  // The parent remounts the editor per rule (key), so a background refetch
  // of the rules never resets what the user is typing.
  const [form, setForm] = useState<RuleForm>(() =>
    rule ? ruleToForm(rule) : emptyRuleForm()
  );
  const [submitted, setSubmitted] = useState(false);
  const now = Date.now();
  const problems = validateRuleForm(form, now);
  const shown: RuleProblems = submitted ? problems : {};
  const set = (patch: Partial<RuleForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const bases = (cvs.data ?? []).filter((cv) => !cv.is_tailored);
  const auto = form.mode === "auto";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!hasProblems(problems)) {
      onSave(form);
    }
  }

  const preview = auto
    ? activationSentence(
        t,
        {
          mode: form.mode,
          criteria: formCriteria(form),
          limits: formLimits(form, now),
          allowed_domains: form.allowedDomains
            .map((domain) => normalizeDomain(domain))
            .filter((domain): domain is string => domain !== null),
        },
        { until: form.expiresOn || null }
      )
    : null;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="sm:max-w-xl">
        <form className="flex h-full flex-col" noValidate onSubmit={submit}>
          <SheetHeader>
            <SheetTitle>
              {rule ? t("rules.editTitle") : t("rules.newTitle")}
            </SheetTitle>
            <SheetDescription>{t("rules.sheetHelp")}</SheetDescription>
          </SheetHeader>
          <FieldGroup className="flex-1 gap-6 overflow-y-auto px-4 pb-6">
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>{t("rules.name")}</FieldLabel>
              <Input
                aria-invalid={shown.name ? true : undefined}
                className="field-touch"
                id={`${id}-name`}
                maxLength={120}
                onChange={(event) => set({ name: event.target.value })}
                value={form.name}
              />
              <Problem field="name" problems={shown} />
            </Field>
            <FieldSet>
              <FieldLegend>{t("rules.mode")}</FieldLegend>
              <RadioGroup
                className="flex flex-col gap-3"
                onValueChange={(value) =>
                  setForm((current) =>
                    withMode(current, value as RuleMode, Date.now())
                  )
                }
                value={form.mode}
              >
                {RULE_MODES.map((mode) => (
                  <div className="flex items-start gap-2" key={mode}>
                    <RadioGroupItem
                      className="mt-0.5"
                      id={`${id}-mode-${mode}`}
                      value={mode}
                    />
                    <label
                      className="flex flex-col gap-0.5"
                      htmlFor={`${id}-mode-${mode}`}
                    >
                      <span className="type-body text-foreground">
                        {modeLabel(t, mode)}
                      </span>
                      <span className="type-caption text-muted-foreground">
                        {t(`rules.modeHelp.${mode}`)}
                      </span>
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </FieldSet>
            <Separator />
            <Group legend={t("rules.criteria")}>
              <Field>
                <FieldLabel htmlFor={`${id}-score`}>
                  {t("rules.minScore", { score: form.minScore })}
                </FieldLabel>
                <Slider
                  aria-label={t("rules.minScoreLabel")}
                  id={`${id}-score`}
                  max={100}
                  min={0}
                  onValueChange={([value]) =>
                    set({ minScore: value ?? form.minScore })
                  }
                  step={SCORE_STEP}
                  value={[form.minScore]}
                />
                {auto ? (
                  <FieldDescription>
                    {t("rules.autoMinScoreHelp", {
                      score: RULE_LIMIT_DEFAULTS.auto_min_score,
                    })}
                  </FieldDescription>
                ) : null}
                <Problem field="minScore" problems={shown} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-keywords`}>
                  {t("rules.keywords")}
                </FieldLabel>
                <ChipsInput
                  id={`${id}-keywords`}
                  max={RULE_LIST_LIMITS.keywords}
                  onChange={(keywords) => set({ keywords })}
                  placeholder={t("rules.chipsPlaceholder")}
                  values={form.keywords}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-titles`}>
                  {t("rules.titlePatterns")}
                </FieldLabel>
                <ChipsInput
                  id={`${id}-titles`}
                  max={RULE_LIST_LIMITS.titlePatterns}
                  onChange={(titlePatterns) => set({ titlePatterns })}
                  placeholder={t("rules.titlePatternsPlaceholder")}
                  values={form.titlePatterns}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-companies`}>
                    {t("rules.companies")}
                  </FieldLabel>
                  <ChipsInput
                    id={`${id}-companies`}
                    max={RULE_LIST_LIMITS.companies}
                    onChange={(companies) => set({ companies })}
                    values={form.companies}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-exclude`}>
                    {t("rules.excludeCompanies")}
                  </FieldLabel>
                  <ChipsInput
                    id={`${id}-exclude`}
                    max={RULE_LIST_LIMITS.excludeCompanies}
                    onChange={(excludeCompanies) => set({ excludeCompanies })}
                    values={form.excludeCompanies}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-locations`}>
                  {t("rules.locations")}
                </FieldLabel>
                <ChipsInput
                  id={`${id}-locations`}
                  max={RULE_LIST_LIMITS.locations}
                  onChange={(locations) => set({ locations })}
                  values={form.locations}
                />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">{t("rules.sources")}</FieldLegend>
                {sources.sources.length === 0 ? (
                  <FieldDescription>{t("rules.noSources")}</FieldDescription>
                ) : (
                  <div className="flex flex-col gap-2">
                    {sources.sources.map((source) => (
                      <Field key={source.id} orientation="horizontal">
                        <Checkbox
                          checked={form.sourceIds.includes(source.id)}
                          id={`${id}-src-${source.id}`}
                          onCheckedChange={(value) =>
                            set({
                              sourceIds: toggle(
                                form.sourceIds,
                                source.id,
                                value === true
                              ),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`${id}-src-${source.id}`}>
                          {source.label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                )}
                <Problem field="criteria" problems={shown} />
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">
                  {t("rules.workplaceTypes")}
                </FieldLegend>
                <div className="flex flex-wrap gap-4">
                  {WORKPLACE_TYPES.filter((type) => type !== "unknown").map(
                    (type) => (
                      <Field key={type} orientation="horizontal">
                        <Checkbox
                          checked={form.workplaceTypes.includes(type)}
                          id={`${id}-wp-${type}`}
                          onCheckedChange={(value) =>
                            set({
                              workplaceTypes: toggle<WorkplaceType>(
                                form.workplaceTypes,
                                type,
                                value === true
                              ),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`${id}-wp-${type}`}>
                          {t(`workplace.${type}`)}
                        </FieldLabel>
                      </Field>
                    )
                  )}
                </div>
              </FieldSet>
              <FieldSet>
                <FieldLegend variant="label">
                  {t("rules.seniority")}
                </FieldLegend>
                <div className="flex flex-wrap gap-4">
                  {SENIORITY_LEVELS.filter((level) => level !== "unknown").map(
                    (level) => (
                      <Field key={level} orientation="horizontal">
                        <Checkbox
                          checked={form.seniority.includes(level)}
                          id={`${id}-sen-${level}`}
                          onCheckedChange={(value) =>
                            set({
                              seniority: toggle<SeniorityLevel>(
                                form.seniority,
                                level,
                                value === true
                              ),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`${id}-sen-${level}`}>
                          {t(`rules.seniorityLevels.${level}`)}
                        </FieldLabel>
                      </Field>
                    )
                  )}
                </div>
              </FieldSet>
              <NumberField
                description={t("rules.maxScoreAgeHelp")}
                id={`${id}-age`}
                label={t("rules.maxScoreAge")}
                max={365}
                min={1}
                onChange={(maxScoreAgeDays) => set({ maxScoreAgeDays })}
                problem={<Problem field="maxScoreAgeDays" problems={shown} />}
                value={form.maxScoreAgeDays}
              />
              <Field orientation="horizontal">
                <Switch
                  checked={form.requireAi}
                  id={`${id}-ai`}
                  onCheckedChange={(requireAi) => set({ requireAi })}
                />
                <FieldLabel htmlFor={`${id}-ai`}>
                  {t("rules.requireAi")}
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  checked={form.excludePossibleGates}
                  id={`${id}-gates`}
                  onCheckedChange={(excludePossibleGates) =>
                    set({ excludePossibleGates })
                  }
                />
                <FieldLabel htmlFor={`${id}-gates`}>
                  {t("rules.excludePossibleGates")}
                </FieldLabel>
              </Field>
              <FieldDescription>
                {t("rules.blockingAlwaysExcluded")}
              </FieldDescription>
            </Group>
            <Separator />
            <Group legend={t("rules.limits")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  description={t("rules.maxPerDayHelp", {
                    max: RULE_LIMIT_DEFAULTS.max_per_day_ceiling,
                  })}
                  id={`${id}-day`}
                  label={t("rules.maxPerDay")}
                  max={RULE_LIMIT_DEFAULTS.max_per_day_ceiling}
                  min={1}
                  onChange={(maxPerDay) => set({ maxPerDay })}
                  problem={<Problem field="maxPerDay" problems={shown} />}
                  value={form.maxPerDay}
                />
                <NumberField
                  description={t("rules.maxPerCompanyHelp", {
                    max: RULE_LIMIT_DEFAULTS.max_per_company_per_30d_ceiling,
                  })}
                  id={`${id}-company`}
                  label={t("rules.maxPerCompany")}
                  max={RULE_LIMIT_DEFAULTS.max_per_company_per_30d_ceiling}
                  min={1}
                  onChange={(maxPerCompany) => set({ maxPerCompany })}
                  problem={<Problem field="maxPerCompany" problems={shown} />}
                  value={form.maxPerCompany}
                />
              </div>
              <Field orientation="horizontal">
                <Switch
                  checked={form.activeHours !== null}
                  id={`${id}-hours-on`}
                  onCheckedChange={(on) =>
                    set({
                      activeHours: on ? { start: "08:00", end: "20:00" } : null,
                    })
                  }
                />
                <FieldLabel htmlFor={`${id}-hours-on`}>
                  {t("rules.activeHours")}
                </FieldLabel>
              </Field>
              {form.activeHours ? (
                <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
                  <Field>
                    <FieldLabel htmlFor={`${id}-start`}>
                      {t("rules.from")}
                    </FieldLabel>
                    <Input
                      className="field-touch"
                      id={`${id}-start`}
                      onChange={(event) =>
                        set({
                          activeHours: {
                            start: event.target.value,
                            end: form.activeHours?.end ?? "20:00",
                          },
                        })
                      }
                      type="time"
                      value={form.activeHours.start}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-end`}>
                      {t("rules.to")}
                    </FieldLabel>
                    <Input
                      className="field-touch"
                      id={`${id}-end`}
                      onChange={(event) =>
                        set({
                          activeHours: {
                            start: form.activeHours?.start ?? "08:00",
                            end: event.target.value,
                          },
                        })
                      }
                      type="time"
                      value={form.activeHours.end}
                    />
                  </Field>
                  <Problem field="activeHours" problems={shown} />
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${id}-expires`}>
                  {t("rules.expiresOn")}
                </FieldLabel>
                <Input
                  className="field-touch w-48"
                  id={`${id}-expires`}
                  onChange={(event) => set({ expiresOn: event.target.value })}
                  type="date"
                  value={form.expiresOn}
                />
                <FieldDescription>
                  {auto ? t("rules.autoExpiryHelp") : t("rules.expiryHelp")}
                </FieldDescription>
                <Problem field="expiresOn" problems={shown} />
              </Field>
            </Group>
            <Separator />
            <Group legend={t("rules.allowedDomains")}>
              <Field>
                <FieldLabel htmlFor={`${id}-domains`}>
                  {t("rules.addDomain")}
                </FieldLabel>
                <ChipsInput
                  describedBy={`${id}-domains-help`}
                  id={`${id}-domains`}
                  invalidMessage={t("rules.errors.domainInvalid")}
                  max={RULE_LIST_LIMITS.allowedDomains}
                  normalize={normalizeDomain}
                  onChange={(allowedDomains) => set({ allowedDomains })}
                  placeholder="greenhouse.io"
                  values={form.allowedDomains}
                />
                <FieldDescription id={`${id}-domains-help`}>
                  {auto ? t("rules.domainsAutoHelp") : t("rules.domainsHelp")}
                </FieldDescription>
                <Problem field="allowedDomains" problems={shown} />
              </Field>
            </Group>
            <Separator />
            <Group legend={t("rules.cvPolicy")}>
              <Field>
                <FieldLabel htmlFor={`${id}-cv`}>
                  {t("rules.baseCv")}
                </FieldLabel>
                <Select
                  onValueChange={(value) =>
                    set({ baseCvId: value === NO_CV ? null : value })
                  }
                  value={form.baseCvId ?? NO_CV}
                >
                  <SelectTrigger className="w-full" id={`${id}-cv`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CV}>
                      {t("rules.applicationCv")}
                    </SelectItem>
                    {bases.map((cv) => (
                      <SelectItem key={cv.id} value={cv.id}>
                        {cv.full_name || cv.id} · {cv.job_title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  checked={form.tailor}
                  id={`${id}-tailor`}
                  onCheckedChange={(tailor) => set({ tailor })}
                />
                <FieldLabel htmlFor={`${id}-tailor`}>
                  {t("rules.tailor")}
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  checked={form.requireCvApproval}
                  id={`${id}-cv-approval`}
                  onCheckedChange={(requireCvApproval) =>
                    set({ requireCvApproval })
                  }
                />
                <FieldLabel htmlFor={`${id}-cv-approval`}>
                  {t("rules.requireCvApproval")}
                </FieldLabel>
              </Field>
            </Group>
            <Separator />
            <Field orientation="horizontal">
              <Switch
                checked={form.enabled}
                id={`${id}-enabled`}
                onCheckedChange={(enabled) => set({ enabled })}
              />
              <FieldLabel htmlFor={`${id}-enabled`}>
                {t("rules.enabled")}
              </FieldLabel>
            </Field>
            {auto && form.enabled ? (
              <FieldDescription>
                {t("rules.autoActivationHelp")}
              </FieldDescription>
            ) : null}
            {preview ? (
              <p className="type-caption border border-line bg-pane/50 p-3 text-foreground">
                {preview}
              </p>
            ) : null}
            {submitted && hasProblems(problems) ? (
              <p className="type-caption text-destructive" role="alert">
                {t("rules.fixProblems")}
              </p>
            ) : null}
          </FieldGroup>
          <SheetFooter className="flex-row justify-end border-line border-t">
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={busy} type="submit">
              {t("common.save")}
              <Kbd aria-hidden="true">↵</Kbd>
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
