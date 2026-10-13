import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AwardEntry,
  CertificateEntry,
  CVData,
  CVSectionId,
  EducationCategory,
  EducationEntry,
  ExperienceEntry,
  LanguageEntry,
  LocationPolicy,
  PersonalInfo,
  ProjectEntry,
  SkillCategory,
  VolunteerEntry,
  WorkType,
} from "@pilihpendidikan/cv-engine/types";
import { FormField } from "@rulisme/ui/form/form-field";
import { MonthPicker } from "@rulisme/ui/form/month-picker";
import { SectionList } from "@rulisme/ui/form/section-list";
import { cn } from "@rulisme/ui/lib/utils";
import { PhoneInput } from "@rulisme/ui/reui/phone-input";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
import { Checkbox } from "@rulisme/ui/ui/checkbox";
import { Input } from "@rulisme/ui/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@rulisme/ui/ui/input-group";
import { Label } from "@rulisme/ui/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Switch } from "@rulisme/ui/ui/switch";
import { Textarea } from "@rulisme/ui/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { GripVertical, Info, Trash2, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { preprocessImage } from "@/lib/preprocess-image";

// Profile photos render into a ~64px avatar in the preview and a small fixed box
// in every PDF template, so 480px on the long edge is retina-sharp yet tiny.
const PHOTO_MAX_EDGE = 480;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL_PATTERN = /^https?:\/\/.+/;

type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string;

const WORK_TYPE_OPTIONS: { value: WorkType; labelKey: string }[] = [
  { value: "", labelKey: "options.notSpecified" },
  { value: "full-time", labelKey: "options.workType.fullTime" },
  { value: "part-time", labelKey: "options.workType.partTime" },
  { value: "internship", labelKey: "options.workType.internship" },
];

const LOCATION_POLICY_OPTIONS: {
  value: LocationPolicy;
  labelKey: string;
}[] = [
  { value: "", labelKey: "options.notSpecified" },
  {
    value: "work-from-office",
    labelKey: "options.locationPolicy.workFromOffice",
  },
  {
    value: "work-from-anywhere",
    labelKey: "options.locationPolicy.workFromAnywhere",
  },
  { value: "hybrid", labelKey: "options.locationPolicy.hybrid" },
];

const EDUCATION_CATEGORY_OPTIONS: {
  value: EducationCategory;
  labelKey: string;
}[] = [
  { value: "", labelKey: "options.notSpecified" },
  { value: "university", labelKey: "options.educationCategory.university" },
  { value: "college", labelKey: "options.educationCategory.college" },
  { value: "school", labelKey: "options.educationCategory.school" },
  { value: "polytechnic", labelKey: "options.educationCategory.polytechnic" },
  { value: "academy", labelKey: "options.educationCategory.academy" },
  {
    value: "language-center",
    labelKey: "options.educationCategory.languageCenter",
  },
  {
    value: "online-platform",
    labelKey: "options.educationCategory.onlinePlatform",
  },
  {
    value: "professional-association",
    labelKey: "options.educationCategory.professionalAssociation",
  },
];

function dateDiffLabel(from: Date, to: Date, t: Translate) {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  let d = to.getDate() - from.getDate();
  if (d < 0) {
    m--;
    d += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y--;
    m += 12;
  }
  const p: string[] = [];
  if (y > 0) {
    p.push(t(y === 1 ? "form.year" : "form.years", { n: y }));
  }
  if (m > 0) {
    p.push(t(m === 1 ? "form.month" : "form.months", { n: m }));
  }
  if (d > 0) {
    p.push(t(d === 1 ? "form.day" : "form.days", { n: d }));
  }
  return p.join(", ") || t("form.zeroDays");
}

interface CVFormProps {
  data: CVData;
  onChange: (data: CVData) => void;
}

const currentMonth = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

// Section headings and the editable section titles share one role: the
// subtitle at the semibold weight (as in `SectionList`).
const SECTION_TITLE_INPUT_CLASS =
  "type-subtitle weight-semibold field-touch -ml-1.5 h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard placeholder:text-muted-foreground hover:border-input focus-visible:border-ring focus-visible:bg-card/60 focus-visible:ring-3 focus-visible:ring-ring/20";

// Meta beside a section title or an entry summary (durations, counts).
const META_CLASS =
  "type-caption flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums";

// The "Present" box under an end date: checking it clears the end date.
function PresentCheckbox({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Label className="w-fit">
      <Checkbox
        aria-label={label}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      {t("form.present")}
    </Label>
  );
}

export function CVForm({ data, onChange }: CVFormProps) {
  const { t } = useTranslation();
  const [skillInputs, setSkillInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // --- Error management ---
  function updateError(key: string, error: string | undefined) {
    setErrors((prev) => {
      if (error) {
        return { ...prev, [key]: error };
      }
      if (!(key in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handlePhotoFile(file: File) {
    try {
      const photoUrl = await preprocessImage(file, { maxEdge: PHOTO_MAX_EDGE });
      updateError("photo", undefined);
      onChange({
        ...data,
        personalInfo: { ...data.personalInfo, photoUrl },
      });
    } catch {
      updateError("photo", t("errors.imageProcess"));
    }
  }

  // --- Personal info ---
  function updatePersonal(field: keyof PersonalInfo, value: string) {
    onChange({
      ...data,
      personalInfo: { ...data.personalInfo, [field]: value },
    });
  }

  // --- Experience ---
  function addExperience() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      experience: [
        ...data.experience,
        {
          id,
          company: "",
          url: "",
          title: "",
          workType: "" as WorkType,
          locationPolicy: "" as LocationPolicy,
          startDate: "",
          endDate: "",
          current: false,
          description: "",
        },
      ],
    });
  }

  function removeExperience(id: string) {
    onChange({
      ...data,
      experience: data.experience.filter((e) => e.id !== id),
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`exp-${id}-company`];
      delete next[`exp-${id}-title`];
      delete next[`exp-${id}-url`];
      return next;
    });
  }

  function updateExperience(
    id: string,
    field: keyof Omit<ExperienceEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      experience: data.experience.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  // --- Education ---
  function addEducation() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      education: [
        ...data.education,
        {
          id,
          category: "" as EducationCategory,
          institution: "",
          degree: "",
          gpa: "",
          startDate: "",
          endDate: "",
          current: false,
        },
      ],
    });
  }

  function removeEducation(id: string) {
    onChange({
      ...data,
      education: data.education.filter((e) => e.id !== id),
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`edu-${id}-institution`];
      delete next[`edu-${id}-degree`];
      return next;
    });
  }

  function updateEducation(
    id: string,
    field: keyof Omit<EducationEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      education: data.education.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  // --- Skills ---
  function addSkillCategory() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      skills: [...data.skills, { id, name: "", items: [] }],
    });
  }

  function removeSkillCategory(id: string) {
    onChange({ ...data, skills: data.skills.filter((c) => c.id !== id) });
    setSkillInputs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function updateSkillCategoryName(id: string, name: string) {
    onChange({
      ...data,
      skills: data.skills.map((c) => (c.id === id ? { ...c, name } : c)),
    });
  }

  function handleCategorySkillKeyDown(
    categoryId: string,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = (skillInputs[categoryId] ?? "").trim();
      const category = data.skills.find((c) => c.id === categoryId);
      if (trimmed && category && !category.items.includes(trimmed)) {
        onChange({
          ...data,
          skills: data.skills.map((c) =>
            c.id === categoryId ? { ...c, items: [...c.items, trimmed] } : c
          ),
        });
        setSkillInputs((prev) => ({ ...prev, [categoryId]: "" }));
      }
    }
  }

  function removeSkillFromCategory(categoryId: string, skill: string) {
    onChange({
      ...data,
      skills: data.skills.map((c) =>
        c.id === categoryId
          ? { ...c, items: c.items.filter((s) => s !== skill) }
          : c
      ),
    });
  }

  // --- Awards ---
  function addAward() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      awards: [
        ...data.awards,
        { id, title: "", issuer: "", date: "", description: "", url: "" },
      ],
    });
  }

  function removeAward(id: string) {
    onChange({ ...data, awards: data.awards.filter((e) => e.id !== id) });
  }

  function updateAward(
    id: string,
    field: keyof Omit<AwardEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      awards: data.awards.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  // --- Certificates ---
  function addCertificate() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      certificates: [
        ...data.certificates,
        {
          id,
          name: "",
          issuer: "",
          date: "",
          expiryDate: "",
          credentialId: "",
          url: "",
        },
      ],
    });
  }

  function removeCertificate(id: string) {
    onChange({
      ...data,
      certificates: data.certificates.filter((e) => e.id !== id),
    });
  }

  function updateCertificate(
    id: string,
    field: keyof Omit<CertificateEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      certificates: data.certificates.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  // --- Languages ---
  function addLanguage() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      languages: [...data.languages, { id, language: "", proficiency: "" }],
    });
  }

  function removeLanguage(id: string) {
    onChange({
      ...data,
      languages: data.languages.filter((e) => e.id !== id),
    });
  }

  function updateLanguage(
    id: string,
    field: keyof Omit<LanguageEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      languages: data.languages.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  function addProject() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      projects: [...data.projects, { id, name: "", url: "", description: "" }],
    });
  }

  function removeProject(id: string) {
    onChange({
      ...data,
      projects: data.projects.filter((e) => e.id !== id),
    });
  }

  function updateProject(
    id: string,
    field: keyof Omit<ProjectEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      projects: data.projects.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  // --- Volunteer ---
  function addVolunteer() {
    const id = crypto.randomUUID();
    onChange({
      ...data,
      volunteer: [
        ...data.volunteer,
        {
          id,
          organization: "",
          role: "",
          startDate: "",
          endDate: "",
          current: false,
          description: "",
        },
      ],
    });
  }

  function removeVolunteer(id: string) {
    onChange({
      ...data,
      volunteer: data.volunteer.filter((e) => e.id !== id),
    });
  }

  function updateVolunteer(
    id: string,
    field: keyof Omit<VolunteerEntry, "id">,
    value: string
  ) {
    onChange({
      ...data,
      volunteer: data.volunteer.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    });
  }

  // --- Accordion summaries ---
  function experienceSummary(entry: ExperienceEntry, index: number) {
    if (entry.title && entry.company) {
      return t("form.summaryAt", {
        title: entry.title,
        company: entry.company,
      });
    }
    return (
      entry.title ||
      entry.company ||
      t("form.experienceFallback", { index: index + 1 })
    );
  }

  const totalExperience = useMemo(() => {
    const now = new Date();
    const intervals = data.experience.reduce<{ start: Date; end: Date }[]>(
      (acc, e) => {
        if (!e.startDate) {
          return acc;
        }
        const start = new Date(`${e.startDate}-01`);
        const end = e.current || !e.endDate ? now : new Date(`${e.endDate}-01`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return acc;
        }
        acc.push({ start, end });
        return acc;
      },
      []
    );
    if (intervals.length === 0) {
      return null;
    }

    const earliest = new Date(
      Math.min(...intervals.map((i) => i.start.getTime()))
    );
    const since = earliest.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    const spanLabel = dateDiffLabel(earliest, now, t);

    const sorted = [...intervals].sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
    const merged: { start: Date; end: Date }[] = [];
    for (const iv of sorted) {
      const last = merged.at(-1);
      if (last && iv.start <= last.end) {
        if (iv.end > last.end) {
          last.end = iv.end;
        }
      } else {
        merged.push({ start: new Date(iv.start), end: new Date(iv.end) });
      }
    }
    let totalMs = 0;
    for (const block of merged) {
      totalMs += block.end.getTime() - block.start.getTime();
    }
    const totalDays = Math.floor(totalMs / (1000 * 60 * 60 * 24));
    const refEnd = new Date(totalDays * 24 * 60 * 60 * 1000);
    const actualLabel = dateDiffLabel(new Date(0), refEnd, t);

    return { label: spanLabel, since, actualLabel };
  }, [data.experience, t]);

  const sinceGraduation = useMemo(() => {
    const now = new Date();
    const uniEntries = data.education.filter(
      (e) => e.category === "university" && (e.endDate || e.current)
    );
    if (uniEntries.length === 0) {
      return null;
    }

    const endDates = uniEntries
      .map((e) => (e.current ? now : new Date(`${e.endDate}-01`)))
      .filter((d) => !Number.isNaN(d.getTime()));
    if (endDates.length === 0) {
      return null;
    }

    const latest = new Date(Math.max(...endDates.map((d) => d.getTime())));
    const label = dateDiffLabel(latest, now, t);
    const since = latest.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });

    return { label, since };
  }, [data.education, t]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const dndContextId = useId();

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = data.sectionOrder.indexOf(active.id as CVSectionId);
    const newIndex = data.sectionOrder.indexOf(over.id as CVSectionId);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    onChange({
      ...data,
      sectionOrder: arrayMove(data.sectionOrder, oldIndex, newIndex),
    });
  }

  function renderSection(sectionId: CVSectionId): ReactNode {
    switch (sectionId) {
      case "summary":
        return (
          <section className="flex flex-col gap-3">
            <div className="flex items-center">
              <input
                aria-label={t("a11y2.summarySectionTitle")}
                className={SECTION_TITLE_INPUT_CLASS}
                onChange={(e) =>
                  onChange({ ...data, summaryTitle: e.target.value })
                }
                placeholder={t("placeholders.summaryTitle")}
                value={data.summaryTitle}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Textarea
                aria-invalid={!!errors.summary}
                onBlur={(e) => {
                  updateError(
                    "summary",
                    e.target.value.length > 500
                      ? t("errors.maxFiveHundredChars")
                      : undefined
                  );
                }}
                onChange={(e) => {
                  onChange({ ...data, summary: e.target.value });
                  if (errors.summary && e.target.value.length <= 500) {
                    updateError("summary", undefined);
                  }
                }}
                placeholder={t("placeholders.summary")}
                value={data.summary}
              />
              <div className="flex justify-between gap-3">
                {errors.summary ? (
                  <p className="type-caption text-destructive">
                    {errors.summary}
                  </p>
                ) : (
                  <span />
                )}
                <p
                  className={cn(
                    "type-caption tabular-nums",
                    data.summary.length > 500
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {t("form.charCounter", { count: data.summary.length })}
                </p>
              </div>
            </div>
          </section>
        );
      case "experience":
        return renderExperienceSection();
      case "education":
        return renderEducationSection();
      case "skills":
        return renderSkillsSection();
      case "awards":
        return renderAwardsSection();
      case "certificates":
        return renderCertificatesSection();
      case "languages":
        return renderLanguagesSection();
      case "projects":
        return renderProjectsSection();
      case "volunteer":
        return renderVolunteerSection();
      default:
        return null;
    }
  }

  // Every section is a band on the form pane, ruled off by a full-width
  // hairline; the reorderable ones carry a drag grip in the left gutter.
  return (
    <div>
      {/* ── Personal Info ── */}
      <section className="flex flex-col gap-3 border-line border-b px-4 py-6 sm:px-6">
        <h2 className="type-subtitle weight-semibold flex h-8 items-center">
          {t("form.personalInformation")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Full Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fullName">{t("form.fullName")}</Label>
            <Input
              aria-invalid={!!errors.fullName}
              id="fullName"
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (!value) {
                  updateError("fullName", t("errors.fullNameRequired"));
                  return;
                }
                updateError(
                  "fullName",
                  value.length < 2 ? t("errors.minTwoChars") : undefined
                );
              }}
              onChange={(e) => {
                updatePersonal("fullName", e.target.value);
                if (errors.fullName && e.target.value.trim().length >= 2) {
                  updateError("fullName", undefined);
                }
              }}
              placeholder={t("placeholders.fullName")}
              value={data.personalInfo.fullName}
            />
            {errors.fullName && (
              <p className="type-caption text-destructive">{errors.fullName}</p>
            )}
          </div>

          {/* Job Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jobTitle">{t("form.jobTitle")}</Label>
            <Input
              id="jobTitle"
              onChange={(e) => updatePersonal("jobTitle", e.target.value)}
              placeholder={t("placeholders.jobTitle")}
              value={data.personalInfo.jobTitle}
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t("form.email")}</Label>
            <Input
              aria-invalid={!!errors.email}
              id="email"
              onBlur={(e) => {
                const value = e.target.value;
                if (!value.trim()) {
                  updateError("email", t("errors.emailRequired"));
                  return;
                }
                updateError(
                  "email",
                  EMAIL_PATTERN.test(value)
                    ? undefined
                    : t("errors.invalidEmail")
                );
              }}
              onChange={(e) => {
                updatePersonal("email", e.target.value);
                if (errors.email && EMAIL_PATTERN.test(e.target.value)) {
                  updateError("email", undefined);
                }
              }}
              placeholder={t("placeholders.email")}
              type="email"
              value={data.personalInfo.email}
            />
            {errors.email && (
              <p className="type-caption text-destructive">{errors.email}</p>
            )}
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("form.phone")}</Label>
            <PhoneInput
              defaultCountry="ID"
              onChange={(value) => {
                updatePersonal("phone", String(value ?? ""));
                if (errors.phone) {
                  updateError("phone", undefined);
                }
              }}
              placeholder={t("placeholders.phone")}
              value={data.personalInfo.phone || undefined}
            />
          </div>

          {/* Location */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location">{t("form.location")}</Label>
            <Input
              id="location"
              onChange={(e) => updatePersonal("location", e.target.value)}
              placeholder={t("placeholders.location")}
              value={data.personalInfo.location}
            />
          </div>

          {/* LinkedIn */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="linkedIn">{t("form.linkedIn")}</Label>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <InputGroupText>linkedin.com/in/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="linkedIn"
                onChange={(e) => updatePersonal("linkedIn", e.target.value)}
                placeholder={t("placeholders.linkedIn")}
                value={data.personalInfo.linkedIn}
              />
            </InputGroup>
          </div>

          {/* Photo Profile */}
          <div className="col-span-full flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={data.personalInfo.usePhoto}
                id="usePhoto"
                onCheckedChange={(checked) =>
                  onChange({
                    ...data,
                    personalInfo: { ...data.personalInfo, usePhoto: checked },
                  })
                }
              />
              <Label htmlFor="usePhoto">{t("form.usePhotoProfile")}</Label>
            </div>
            {data.personalInfo.usePhoto && (
              <div className="flex items-center gap-3">
                {data.personalInfo.photoUrl ? (
                  <>
                    <img
                      alt={t("a11y2.profile")}
                      className="size-16 rounded-sm border border-border object-cover"
                      decoding="async"
                      height={64}
                      loading="lazy"
                      src={data.personalInfo.photoUrl}
                      width={64}
                    />
                    <Button
                      onClick={() =>
                        onChange({
                          ...data,
                          personalInfo: { ...data.personalInfo, photoUrl: "" },
                        })
                      }
                      size="sm"
                      variant="outline"
                    >
                      <Trash2 data-icon="inline-start" />
                      {t("form.remove")}
                    </Button>
                  </>
                ) : (
                  <label className="type-body flex cursor-pointer items-center gap-2 rounded-md border border-line border-dashed bg-card/60 px-3 py-2.5 text-foreground transition-[background-color,border-color,box-shadow] duration-150 ease-standard hover:bg-pane/70 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/20">
                    <Upload
                      aria-hidden="true"
                      className="size-3.5 text-muted-foreground"
                    />
                    {t("form.uploadPhoto")}
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      aria-label={t("a11y2.uploadProfilePhoto")}
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) {
                          await handlePhotoFile(file);
                        }
                      }}
                      type="file"
                    />
                  </label>
                )}
                {errors.photo && (
                  <p className="type-caption text-destructive">
                    {errors.photo}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <DndContext
        collisionDetection={closestCenter}
        id={dndContextId}
        onDragEnd={handleSectionDragEnd}
        sensors={sensors}
      >
        <SortableContext
          items={data.sectionOrder}
          strategy={verticalListSortingStrategy}
        >
          {data.sectionOrder.map((sectionId) => (
            <SortableSection id={sectionId} key={sectionId}>
              {renderSection(sectionId)}
            </SortableSection>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );

  function renderExperienceSection() {
    return (
      <SectionList<ExperienceEntry>
        addLabel={t("form.addExperience")}
        hasError={(entry) =>
          !!(
            errors[`exp-${entry.id}-company`] || errors[`exp-${entry.id}-title`]
          )
        }
        items={data.experience}
        onAdd={addExperience}
        onRemove={removeExperience}
        onReorder={(items) => onChange({ ...data, experience: items })}
        onTitleChange={(v) => onChange({ ...data, experienceTitle: v })}
        placeholder={t("placeholders.workExperience")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                error={errors[`exp-${entry.id}-company`]}
                label={t("form.company")}
                onBlur={() => {
                  updateError(
                    `exp-${entry.id}-company`,
                    entry.company.trim()
                      ? undefined
                      : t("errors.companyRequired")
                  );
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "company", v);
                  if (errors[`exp-${entry.id}-company`] && v.trim()) {
                    updateError(`exp-${entry.id}-company`, undefined);
                  }
                }}
                placeholder={t("placeholders.companyName")}
                value={entry.company}
              />
              <FormField
                error={errors[`exp-${entry.id}-title`]}
                label={t("form.jobTitle")}
                onBlur={() => {
                  updateError(
                    `exp-${entry.id}-title`,
                    entry.title.trim()
                      ? undefined
                      : t("errors.jobTitleRequired")
                  );
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "title", v);
                  if (errors[`exp-${entry.id}-title`] && v.trim()) {
                    updateError(`exp-${entry.id}-title`, undefined);
                  }
                }}
                placeholder={t("placeholders.yourRole")}
                value={entry.title}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                error={errors[`exp-${entry.id}-url`]}
                label={t("form.companyUrl")}
                onBlur={() => {
                  updateError(
                    `exp-${entry.id}-url`,
                    entry.url && !HTTP_URL_PATTERN.test(entry.url)
                      ? t("errors.invalidUrl")
                      : undefined
                  );
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "url", v);
                  if (
                    errors[`exp-${entry.id}-url`] &&
                    (!v || HTTP_URL_PATTERN.test(v))
                  ) {
                    updateError(`exp-${entry.id}-url`, undefined);
                  }
                }}
                placeholder={t("placeholders.url")}
                type="url"
                value={entry.url}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`exp-${entry.id}-work-type`}>
                  {t("form.workType")}
                </Label>
                <Select
                  onValueChange={(v) =>
                    updateExperience(
                      entry.id,
                      "workType",
                      v === "__empty__" ? "" : v
                    )
                  }
                  value={entry.workType || "__empty__"}
                >
                  <SelectTrigger
                    className="w-full"
                    id={`exp-${entry.id}-work-type`}
                  >
                    <SelectValue placeholder={t("placeholders.selectType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {WORK_TYPE_OPTIONS.map((opt) => (
                        <SelectItem
                          key={opt.value || "__empty__"}
                          value={opt.value || "__empty__"}
                        >
                          {t(opt.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`exp-${entry.id}-location-policy`}>
                  {t("form.locationPolicy")}
                </Label>
                <Select
                  onValueChange={(v) =>
                    updateExperience(
                      entry.id,
                      "locationPolicy",
                      v === "__empty__" ? "" : v
                    )
                  }
                  value={entry.locationPolicy || "__empty__"}
                >
                  <SelectTrigger
                    className="w-full"
                    id={`exp-${entry.id}-location-policy`}
                  >
                    <SelectValue placeholder={t("placeholders.selectPolicy")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {LOCATION_POLICY_OPTIONS.map((opt) => (
                        <SelectItem
                          key={opt.value || "__empty__"}
                          value={opt.value || "__empty__"}
                        >
                          {t(opt.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label={t("form.startDate")}
                onChange={(v) => updateExperience(entry.id, "startDate", v)}
                type="month"
                value={entry.startDate}
              />
              <div className="flex flex-col gap-1.5">
                <Label id={`exp-${entry.id}-end-date`}>
                  {t("form.endDate")}
                </Label>
                <MonthPicker
                  aria-labelledby={`exp-${entry.id}-end-date`}
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateExperience(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <PresentCheckbox
                  checked={entry.current}
                  label={t("a11y2.currentlyWorkingHere")}
                  onCheckedChange={(checked) => {
                    onChange({
                      ...data,
                      experience: data.experience.map((exp) =>
                        exp.id === entry.id
                          ? {
                              ...exp,
                              current: checked,
                              endDate: checked ? "" : exp.endDate,
                            }
                          : exp
                      ),
                    });
                  }}
                />
              </div>
            </div>
            <FormField
              label={t("form.description")}
              multiline
              onChange={(v) => updateExperience(entry.id, "description", v)}
              placeholder={t("placeholders.experienceDescription")}
              value={entry.description}
            />
          </div>
        )}
        summary={experienceSummary}
        title={data.experienceTitle}
        titleExtra={
          totalExperience && (
            <span className={META_CLASS}>
              {totalExperience.label}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent
                    className="flex-col items-start gap-0.5"
                    side="bottom"
                  >
                    <p>
                      {t("form.careerSpan", { value: totalExperience.label })}
                    </p>
                    <p>
                      {t("form.actualWorking", {
                        value: totalExperience.actualLabel,
                      })}
                    </p>
                    <p className="mt-1 opacity-70">
                      {t("form.since", { since: totalExperience.since })}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          )
        }
        triggerExtra={(entry) =>
          entry.startDate ? (
            <span className={META_CLASS} suppressHydrationWarning>
              {dateDiffLabel(
                new Date(`${entry.startDate}-01`),
                entry.current || !entry.endDate
                  ? new Date()
                  : new Date(`${entry.endDate}-01`),
                t
              )}
            </span>
          ) : null
        }
      />
    );
  }

  function renderEducationSection() {
    return (
      <SectionList<EducationEntry>
        addLabel={t("form.addEducation")}
        hasError={(entry) =>
          !!(
            errors[`edu-${entry.id}-institution`] ||
            errors[`edu-${entry.id}-degree`]
          )
        }
        items={data.education}
        onAdd={addEducation}
        onRemove={removeEducation}
        onReorder={(items) => onChange({ ...data, education: items })}
        onTitleChange={(v) => onChange({ ...data, educationTitle: v })}
        placeholder={t("placeholders.education")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`edu-${entry.id}-category`}>
                {t("form.category")}
              </Label>
              <Select
                onValueChange={(v) =>
                  updateEducation(
                    entry.id,
                    "category",
                    v === "__empty__" ? "" : v
                  )
                }
                value={entry.category || "__empty__"}
              >
                <SelectTrigger
                  className="w-full"
                  id={`edu-${entry.id}-category`}
                >
                  <SelectValue placeholder={t("placeholders.selectCategory")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {EDUCATION_CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value || "__empty__"}
                        value={opt.value || "__empty__"}
                      >
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                error={errors[`edu-${entry.id}-institution`]}
                label={t("form.institution")}
                onBlur={() => {
                  updateError(
                    `edu-${entry.id}-institution`,
                    entry.institution.trim()
                      ? undefined
                      : t("errors.institutionRequired")
                  );
                }}
                onChange={(v) => {
                  updateEducation(entry.id, "institution", v);
                  if (errors[`edu-${entry.id}-institution`] && v.trim()) {
                    updateError(`edu-${entry.id}-institution`, undefined);
                  }
                }}
                placeholder={t("placeholders.universityName")}
                value={entry.institution}
              />
              <FormField
                error={errors[`edu-${entry.id}-degree`]}
                label={t("form.degree")}
                onBlur={() => {
                  updateError(
                    `edu-${entry.id}-degree`,
                    entry.degree.trim() ? undefined : t("errors.degreeRequired")
                  );
                }}
                onChange={(v) => {
                  updateEducation(entry.id, "degree", v);
                  if (errors[`edu-${entry.id}-degree`] && v.trim()) {
                    updateError(`edu-${entry.id}-degree`, undefined);
                  }
                }}
                placeholder={t("placeholders.degree")}
                value={entry.degree}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                label={t("form.gpa")}
                max={4}
                min={0}
                onChange={(v) => updateEducation(entry.id, "gpa", v)}
                placeholder={t("placeholders.gpa")}
                step={0.01}
                type="number"
                value={entry.gpa}
              />
              <FormField
                label={t("form.startDate")}
                onChange={(v) => updateEducation(entry.id, "startDate", v)}
                type="month"
                value={entry.startDate}
              />
              <div className="flex flex-col gap-1.5">
                <Label id={`edu-${entry.id}-end-date`}>
                  {t("form.endDate")}
                </Label>
                <MonthPicker
                  aria-labelledby={`edu-${entry.id}-end-date`}
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateEducation(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <PresentCheckbox
                  checked={entry.current}
                  label={t("a11y2.currentlyEnrolled")}
                  onCheckedChange={(checked) => {
                    onChange({
                      ...data,
                      education: data.education.map((edu) =>
                        edu.id === entry.id
                          ? {
                              ...edu,
                              current: checked,
                              endDate: checked ? "" : edu.endDate,
                            }
                          : edu
                      ),
                    });
                  }}
                />
              </div>
            </div>
          </div>
        )}
        summary={(entry, index) => {
          if (entry.degree && entry.institution) {
            return t("form.summaryDash", {
              a: entry.degree,
              b: entry.institution,
            });
          }
          return (
            entry.degree ||
            entry.institution ||
            t("form.educationFallback", { index: index + 1 })
          );
        }}
        title={data.educationTitle}
        titleExtra={
          sinceGraduation && (
            <span className={META_CLASS}>
              {sinceGraduation.label}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent
                    className="flex-col items-start gap-0.5"
                    side="bottom"
                  >
                    <p>{t("form.sinceLastGraduation")}</p>
                    <p>
                      {t("form.graduated", { date: sinceGraduation.since })}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          )
        }
        triggerExtra={(entry) =>
          entry.startDate ? (
            <span className={META_CLASS} suppressHydrationWarning>
              {dateDiffLabel(
                new Date(`${entry.startDate}-01`),
                entry.current || !entry.endDate
                  ? new Date()
                  : new Date(`${entry.endDate}-01`),
                t
              )}
            </span>
          ) : null
        }
      />
    );
  }

  function renderSkillsSection() {
    return (
      <SectionList<SkillCategory>
        addLabel={t("form.addCategory")}
        items={data.skills}
        onAdd={addSkillCategory}
        onRemove={removeSkillCategory}
        onReorder={(items) => onChange({ ...data, skills: items })}
        onTitleChange={(v) => onChange({ ...data, skillsTitle: v })}
        placeholder={t("placeholders.skills")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(category) => (
          <div className="flex flex-col gap-3">
            <FormField
              label={t("form.categoryName")}
              onChange={(v) => updateSkillCategoryName(category.id, v)}
              placeholder={t("placeholders.categoryItems")}
              value={category.name}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`skill-entry-${category.id}`}>
                {t("form.skills")}
              </Label>
              <Input
                id={`skill-entry-${category.id}`}
                onChange={(e) =>
                  setSkillInputs((prev) => ({
                    ...prev,
                    [category.id]: e.target.value,
                  }))
                }
                onKeyDown={(e) => handleCategorySkillKeyDown(category.id, e)}
                placeholder={t("placeholders.skillEntry")}
                value={skillInputs[category.id] ?? ""}
              />
            </div>
            {category.items.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {category.items.map((skill) => (
                  <Badge
                    asChild
                    className="press cursor-pointer hover:bg-pane-2"
                    key={skill}
                    variant="secondary"
                  >
                    <button
                      aria-label={t("a11y.removeItem", { item: skill })}
                      onClick={() => {
                        removeSkillFromCategory(category.id, skill);
                        // The chip unmounts; keep keyboard focus in the field.
                        document
                          .getElementById(`skill-entry-${category.id}`)
                          ?.focus();
                      }}
                      type="button"
                    >
                      {skill}
                      <X aria-hidden="true" data-icon="inline-end" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
        summary={(category) => {
          if (category.name && category.items.length > 0) {
            return `${category.name} (${category.items.length})`;
          }
          return category.name || t("form.untitledCategory");
        }}
        title={data.skillsTitle}
        titleExtra={
          data.skills.length > 0 && (
            <span className={META_CLASS}>
              {t("form.skillsCount", {
                count: data.skills.reduce((sum, c) => sum + c.items.length, 0),
              })}
            </span>
          )
        }
      />
    );
  }

  function renderAwardsSection() {
    return (
      <SectionList<AwardEntry>
        addLabel={t("form.addAward")}
        items={data.awards}
        onAdd={addAward}
        onRemove={removeAward}
        onReorder={(items) => onChange({ ...data, awards: items })}
        onTitleChange={(v) => onChange({ ...data, awardsTitle: v })}
        placeholder={t("placeholders.awards")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label={t("form.title")}
                onChange={(v) => updateAward(entry.id, "title", v)}
                placeholder={t("placeholders.awardName")}
                value={entry.title}
              />
              <FormField
                label={t("form.issuer")}
                onChange={(v) => updateAward(entry.id, "issuer", v)}
                placeholder={t("placeholders.issuingOrganization")}
                value={entry.issuer}
              />
              <FormField
                label={t("form.date")}
                onChange={(v) => updateAward(entry.id, "date", v)}
                type="month"
                value={entry.date}
              />
            </div>
            <FormField
              label={t("form.description")}
              multiline
              onChange={(v) => updateAward(entry.id, "description", v)}
              placeholder={t("placeholders.briefDescription")}
              value={entry.description}
            />
            <FormField
              error={errors[`award-${entry.id}-url`]}
              label={t("form.url")}
              onBlur={() => {
                updateError(
                  `award-${entry.id}-url`,
                  entry.url && !HTTP_URL_PATTERN.test(entry.url)
                    ? t("errors.invalidUrl")
                    : undefined
                );
              }}
              onChange={(v) => {
                updateAward(entry.id, "url", v);
                if (
                  errors[`award-${entry.id}-url`] &&
                  (!v || HTTP_URL_PATTERN.test(v))
                ) {
                  updateError(`award-${entry.id}-url`, undefined);
                }
              }}
              placeholder={t("placeholders.url")}
              type="url"
              value={entry.url}
            />
          </>
        )}
        summary={(entry, index) => {
          if (entry.title && entry.issuer) {
            return t("form.summaryDash", { a: entry.title, b: entry.issuer });
          }
          return (
            entry.title ||
            entry.issuer ||
            t("form.awardFallback", { index: index + 1 })
          );
        }}
        title={data.awardsTitle}
        titleExtra={
          data.awards.length > 0 && (
            <span className={META_CLASS}>
              {t(
                data.awards.length === 1
                  ? "form.awardCount"
                  : "form.awardCountPlural",
                { count: data.awards.length }
              )}
            </span>
          )
        }
      />
    );
  }

  function renderCertificatesSection() {
    return (
      <SectionList<CertificateEntry>
        addLabel={t("form.addCertificate")}
        items={data.certificates}
        onAdd={addCertificate}
        onRemove={removeCertificate}
        onReorder={(items) => onChange({ ...data, certificates: items })}
        onTitleChange={(v) => onChange({ ...data, certificatesTitle: v })}
        placeholder={t("placeholders.certificates")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label={t("form.certificateName")}
                onChange={(v) => updateCertificate(entry.id, "name", v)}
                placeholder={t("placeholders.certificateName")}
                value={entry.name}
              />
              <FormField
                label={t("form.issuer")}
                onChange={(v) => updateCertificate(entry.id, "issuer", v)}
                placeholder={t("placeholders.issuingOrganization")}
                value={entry.issuer}
              />
              <FormField
                label={t("form.issuedDate")}
                onChange={(v) => updateCertificate(entry.id, "date", v)}
                type="month"
                value={entry.date}
              />
              <FormField
                label={t("form.expiryDate")}
                onChange={(v) => updateCertificate(entry.id, "expiryDate", v)}
                type="month"
                value={entry.expiryDate}
              />
              <FormField
                label={t("form.credentialId")}
                onChange={(v) => updateCertificate(entry.id, "credentialId", v)}
                placeholder={t("placeholders.credentialId")}
                value={entry.credentialId}
              />
              <FormField
                error={errors[`cert-${entry.id}-url`]}
                label={t("form.url")}
                onBlur={() => {
                  updateError(
                    `cert-${entry.id}-url`,
                    entry.url && !HTTP_URL_PATTERN.test(entry.url)
                      ? t("errors.invalidUrl")
                      : undefined
                  );
                }}
                onChange={(v) => {
                  updateCertificate(entry.id, "url", v);
                  if (
                    errors[`cert-${entry.id}-url`] &&
                    (!v || HTTP_URL_PATTERN.test(v))
                  ) {
                    updateError(`cert-${entry.id}-url`, undefined);
                  }
                }}
                placeholder={t("placeholders.url")}
                type="url"
                value={entry.url}
              />
            </div>
          </>
        )}
        summary={(entry, index) => {
          if (entry.name && entry.issuer) {
            return t("form.summaryDash", { a: entry.name, b: entry.issuer });
          }
          return (
            entry.name ||
            entry.issuer ||
            t("form.certificateFallback", { index: index + 1 })
          );
        }}
        title={data.certificatesTitle}
        titleExtra={
          data.certificates.length > 0 && (
            <span className={META_CLASS}>
              {t(
                data.certificates.length === 1
                  ? "form.certificateCount"
                  : "form.certificateCountPlural",
                { count: data.certificates.length }
              )}
            </span>
          )
        }
        triggerExtra={(entry) => {
          if (!entry.expiryDate) {
            return null;
          }
          const expiry = new Date(`${entry.expiryDate}-01`);
          if (Number.isNaN(expiry.getTime())) {
            return null;
          }
          const now = new Date();
          const isExpired =
            expiry < new Date(now.getFullYear(), now.getMonth(), 1);
          if (isExpired) {
            return (
              <span
                className={cn(META_CLASS, "text-destructive")}
                suppressHydrationWarning
              >
                {t("form.expiredAgo", {
                  duration: dateDiffLabel(expiry, now, t),
                })}
              </span>
            );
          }
          return (
            <span className={META_CLASS} suppressHydrationWarning>
              {t("form.expiresIn", { duration: dateDiffLabel(now, expiry, t) })}
            </span>
          );
        }}
      />
    );
  }

  function renderLanguagesSection() {
    return (
      <SectionList<LanguageEntry>
        addLabel={t("form.addLanguage")}
        items={data.languages}
        onAdd={addLanguage}
        onRemove={removeLanguage}
        onReorder={(items) => onChange({ ...data, languages: items })}
        onTitleChange={(v) => onChange({ ...data, languagesTitle: v })}
        placeholder={t("placeholders.languages")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label={t("form.language")}
              onChange={(v) => updateLanguage(entry.id, "language", v)}
              placeholder={t("placeholders.languageName")}
              value={entry.language}
            />
            <FormField
              label={t("form.proficiency")}
              onChange={(v) => updateLanguage(entry.id, "proficiency", v)}
              placeholder={t("placeholders.proficiency")}
              value={entry.proficiency}
            />
          </div>
        )}
        summary={(entry, index) => {
          if (entry.language && entry.proficiency) {
            return t("form.summaryDash", {
              a: entry.language,
              b: entry.proficiency,
            });
          }
          return (
            entry.language || t("form.languageFallback", { index: index + 1 })
          );
        }}
        title={data.languagesTitle}
        titleExtra={
          data.languages.length > 0 && (
            <span className={META_CLASS}>
              {t(
                data.languages.length === 1
                  ? "form.languageCount"
                  : "form.languageCountPlural",
                { count: data.languages.length }
              )}
            </span>
          )
        }
      />
    );
  }

  function renderProjectsSection() {
    return (
      <SectionList<ProjectEntry>
        addLabel={t("form.addProject")}
        items={data.projects}
        onAdd={addProject}
        onRemove={removeProject}
        onReorder={(items) => onChange({ ...data, projects: items })}
        onTitleChange={(v) => onChange({ ...data, projectsTitle: v })}
        placeholder={t("placeholders.projects")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <div className="grid gap-3">
            <FormField
              label={t("form.name")}
              onChange={(v) => updateProject(entry.id, "name", v)}
              placeholder={t("placeholders.projectName")}
              value={entry.name}
            />
            <FormField
              label={t("form.url")}
              onChange={(v) => updateProject(entry.id, "url", v)}
              placeholder={t("placeholders.url")}
              type="url"
              value={entry.url}
            />
            <FormField
              label={t("form.description")}
              multiline
              onChange={(v) => updateProject(entry.id, "description", v)}
              placeholder={t("placeholders.projectDescription")}
              rows={2}
              value={entry.description}
            />
          </div>
        )}
        summary={(entry, index) =>
          entry.name || t("form.projectFallback", { index: index + 1 })
        }
        title={data.projectsTitle}
        titleExtra={
          data.projects.length > 0 && (
            <span className={META_CLASS}>
              {t(
                data.projects.length === 1
                  ? "form.projectCount"
                  : "form.projectCountPlural",
                { count: data.projects.length }
              )}
            </span>
          )
        }
      />
    );
  }

  function renderVolunteerSection() {
    return (
      <SectionList<VolunteerEntry>
        addLabel={t("form.addVolunteer")}
        items={data.volunteer}
        onAdd={addVolunteer}
        onRemove={removeVolunteer}
        onReorder={(items) => onChange({ ...data, volunteer: items })}
        onTitleChange={(v) => onChange({ ...data, volunteerTitle: v })}
        placeholder={t("placeholders.volunteer")}
        removeLabel={t("form.remove")}
        reorderLabel={t("form.dragToReorder")}
        renderContent={(entry) => (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label={t("form.organization")}
                onChange={(v) => updateVolunteer(entry.id, "organization", v)}
                placeholder={t("placeholders.organizationName")}
                value={entry.organization}
              />
              <FormField
                label={t("form.role")}
                onChange={(v) => updateVolunteer(entry.id, "role", v)}
                placeholder={t("placeholders.yourRole")}
                value={entry.role}
              />
              <FormField
                label={t("form.startDate")}
                onChange={(v) => updateVolunteer(entry.id, "startDate", v)}
                type="month"
                value={entry.startDate}
              />
              <div className="flex flex-col gap-1.5">
                <Label id={`vol-${entry.id}-end-date`}>
                  {t("form.endDate")}
                </Label>
                <MonthPicker
                  aria-labelledby={`vol-${entry.id}-end-date`}
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateVolunteer(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <PresentCheckbox
                  checked={entry.current}
                  label={t("a11y2.currentlyVolunteeringHere")}
                  onCheckedChange={(checked) => {
                    onChange({
                      ...data,
                      volunteer: data.volunteer.map((vol) =>
                        vol.id === entry.id
                          ? {
                              ...vol,
                              current: checked,
                              endDate: checked ? "" : vol.endDate,
                            }
                          : vol
                      ),
                    });
                  }}
                />
              </div>
            </div>
            <FormField
              label={t("form.description")}
              multiline
              onChange={(v) => updateVolunteer(entry.id, "description", v)}
              placeholder={t("placeholders.volunteerDescription")}
              value={entry.description}
            />
          </div>
        )}
        summary={(entry, index) => {
          if (entry.role && entry.organization) {
            return t("form.summaryAt", {
              title: entry.role,
              company: entry.organization,
            });
          }
          return (
            entry.role ||
            entry.organization ||
            t("form.volunteerFallback", { index: index + 1 })
          );
        }}
        title={data.volunteerTitle}
        titleExtra={
          data.volunteer.length > 0 && (
            <span className={META_CLASS}>
              {t(
                data.volunteer.length === 1
                  ? "form.activityCount"
                  : "form.activityCountPlural",
                { count: data.volunteer.length }
              )}
            </span>
          )
        }
        triggerExtra={(entry) =>
          entry.startDate ? (
            <span className={META_CLASS} suppressHydrationWarning>
              {dateDiffLabel(
                new Date(`${entry.startDate}-01`),
                entry.current || !entry.endDate
                  ? new Date()
                  : new Date(`${entry.endDate}-01`),
                t
              )}
            </span>
          ) : null
        }
      />
    );
  }
}

// Drag-to-reorder is direct feedback, so it keeps moving (DESIGN.md §
// Deviations), on the system duration and curve (`--motion-duration` /
// `--motion-ease` in @pilihpendidikan/config/motion.css) rather than
// dnd-kit's `250ms ease`. Same values as `SectionList`.
const SORTABLE_TRANSITION = {
  duration: 150,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

function SortableSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, transition: SORTABLE_TRANSITION });
  const { t } = useTranslation();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  // One band of the form, ruled off by a full-width hairline. The grip sits
  // in the left gutter, level with the section title's 32px row.
  return (
    <div
      className={cn(
        "relative border-line border-b bg-background px-4 py-6 sm:px-6",
        // Above the neighbouring bands, under the sticky toolbar (z-10).
        isDragging && "z-5"
      )}
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 200px",
      }}
    >
      <button
        aria-label={t("form.dragToReorder")}
        className="absolute top-6 left-0 flex h-8 w-4 cursor-grab items-center justify-center rounded-sm text-muted-foreground outline-none transition-[color] duration-150 ease-standard hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 active:cursor-grabbing sm:left-1"
        title={t("form.dragToReorder")}
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="size-3.5" />
      </button>
      {children}
    </div>
  );
}
