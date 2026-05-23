import {
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { FormField } from "@rulisme/ui/form/form-field";
import { MonthPicker } from "@rulisme/ui/form/month-picker";
import { SectionList } from "@rulisme/ui/form/section-list";
import { PhoneInput } from "@rulisme/ui/reui/phone-input";
import { Badge } from "@rulisme/ui/ui/badge";
import { Button } from "@rulisme/ui/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select";
import { Separator } from "@rulisme/ui/ui/separator";
import { Switch } from "@rulisme/ui/ui/switch";
import { Textarea } from "@rulisme/ui/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip";
import { GripVertical, Info, Trash2, Upload, X } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";

export interface PersonalInfo {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  location: string;
  linkedIn: string;
  photoUrl: string;
  usePhoto: boolean;
}

export type WorkType = "" | "full-time" | "part-time" | "internship";
export type LocationPolicy =
  | ""
  | "work-from-office"
  | "work-from-anywhere"
  | "hybrid";

const WORK_TYPE_OPTIONS: { value: WorkType; label: string }[] = [
  { value: "", label: "Not specified" },
  { value: "full-time", label: "Full-Time" },
  { value: "part-time", label: "Part-Time" },
  { value: "internship", label: "Internship" },
];

const LOCATION_POLICY_OPTIONS: {
  value: LocationPolicy;
  label: string;
}[] = [
  { value: "", label: "Not specified" },
  { value: "work-from-office", label: "Work From Office" },
  { value: "work-from-anywhere", label: "Work From Anywhere" },
  { value: "hybrid", label: "Hybrid" },
];

export interface ExperienceEntry {
  id: string;
  company: string;
  url: string;
  title: string;
  workType: WorkType;
  locationPolicy: LocationPolicy;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export type EducationCategory =
  | ""
  | "university"
  | "college"
  | "school"
  | "polytechnic"
  | "academy"
  | "language-center"
  | "online-platform"
  | "professional-association";

const EDUCATION_CATEGORY_OPTIONS: {
  value: EducationCategory;
  label: string;
}[] = [
  { value: "", label: "Not specified" },
  { value: "university", label: "University" },
  { value: "college", label: "College / Institute" },
  { value: "school", label: "School (K-12)" },
  { value: "polytechnic", label: "Polytechnic / Vocational" },
  { value: "academy", label: "Academy" },
  { value: "language-center", label: "Language / Tuition Center" },
  { value: "online-platform", label: "Online Learning Platform" },
  { value: "professional-association", label: "Professional Association" },
];

export interface EducationEntry {
  id: string;
  category: EducationCategory;
  institution: string;
  degree: string;
  gpa: string;
  startDate: string;
  endDate: string;
  current: boolean;
}

export interface AwardEntry {
  id: string;
  title: string;
  issuer: string;
  date: string;
  description: string;
  url: string;
}

export interface CertificateEntry {
  id: string;
  name: string;
  issuer: string;
  date: string;
  expiryDate: string;
  credentialId: string;
  url: string;
}

export interface LanguageEntry {
  id: string;
  language: string;
  proficiency: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  url: string;
  description: string;
}

export interface VolunteerEntry {
  id: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export type CVStyle = "basic" | "harvard" | "simple" | "standard";

export interface SkillCategory {
  id: string;
  name: string;
  items: string[];
}

export type CVSectionId =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "awards"
  | "certificates"
  | "languages"
  | "projects"
  | "volunteer";

export interface CVData {
  personalInfo: PersonalInfo;
  sectionOrder: CVSectionId[];
  summaryTitle: string;
  summary: string;
  experienceTitle: string;
  experience: ExperienceEntry[];
  educationTitle: string;
  education: EducationEntry[];
  skillsTitle: string;
  skills: SkillCategory[];
  awardsTitle: string;
  awards: AwardEntry[];
  certificatesTitle: string;
  certificates: CertificateEntry[];
  languagesTitle: string;
  languages: LanguageEntry[];
  projectsTitle: string;
  projects: ProjectEntry[];
  volunteerTitle: string;
  volunteer: VolunteerEntry[];
}

function dateDiffLabel(from: Date, to: Date) {
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
    p.push(`${y} Year${y > 1 ? "s" : ""}`);
  }
  if (m > 0) {
    p.push(`${m} Month${m > 1 ? "s" : ""}`);
  }
  if (d > 0) {
    p.push(`${d} Day${d > 1 ? "s" : ""}`);
  }
  return p.join(", ") || "0 Days";
}

interface CVFormProps {
  data: CVData;
  onChange: (data: CVData) => void;
}

const currentMonth = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

export function CVForm({ data, onChange }: CVFormProps) {
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
      return `${entry.title} at ${entry.company}`;
    }
    return entry.title || entry.company || `Experience #${index + 1}`;
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
    const spanLabel = dateDiffLabel(earliest, now);

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
    const actualLabel = dateDiffLabel(new Date(0), refEnd);

    return { label: spanLabel, since, actualLabel };
  }, [data.experience]);

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
    const label = dateDiffLabel(latest, now);
    const since = latest.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });

    return { label, since };
  }, [data.education]);

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
          <section>
            <input
              aria-label="Summary section title"
              className="w-full bg-transparent font-medium text-base outline-none placeholder:text-muted-foreground md:text-sm"
              onChange={(e) =>
                onChange({ ...data, summaryTitle: e.target.value })
              }
              placeholder="Professional Summary"
              value={data.summaryTitle}
            />
            <div className="mt-3">
              <Textarea
                aria-invalid={!!errors.summary}
                onBlur={(e) => {
                  updateError(
                    "summary",
                    e.target.value.length > 500
                      ? "Maximum 500 characters"
                      : undefined
                  );
                }}
                onChange={(e) => {
                  onChange({ ...data, summary: e.target.value });
                  if (errors.summary && e.target.value.length <= 500) {
                    updateError("summary", undefined);
                  }
                }}
                placeholder="Write a brief professional summary..."
                value={data.summary}
              />
              <div className="mt-1 flex justify-between">
                {errors.summary ? (
                  <p className="text-destructive text-xs">{errors.summary}</p>
                ) : (
                  <span />
                )}
                <p
                  className={`text-xs ${data.summary.length > 500 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {data.summary.length}/500
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

  return (
    <div className="space-y-6">
      {/* ── Personal Info ── */}
      <section>
        <h2 className="font-medium text-base md:text-sm">
          Personal Information
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Full Name */}
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              aria-invalid={!!errors.fullName}
              id="fullName"
              onBlur={(e) => {
                const v = e.target.value.trim();
                updateError(
                  "fullName",
                  v
                    ? v.length < 2
                      ? "At least 2 characters"
                      : undefined
                    : "Full name is required"
                );
              }}
              onChange={(e) => {
                updatePersonal("fullName", e.target.value);
                if (errors.fullName && e.target.value.trim().length >= 2) {
                  updateError("fullName", undefined);
                }
              }}
              placeholder="Bahrul Bangsawan"
              value={data.personalInfo.fullName}
            />
            {errors.fullName && (
              <p className="text-destructive text-xs">{errors.fullName}</p>
            )}
          </div>

          {/* Job Title */}
          <div className="space-y-1.5">
            <Label htmlFor="jobTitle">Job Title</Label>
            <Input
              id="jobTitle"
              onChange={(e) => updatePersonal("jobTitle", e.target.value)}
              placeholder="Growthacker"
              value={data.personalInfo.jobTitle}
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              aria-invalid={!!errors.email}
              id="email"
              onBlur={(e) => {
                const v = e.target.value;
                updateError(
                  "email",
                  v.trim()
                    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
                      ? undefined
                      : "Invalid email format"
                    : "Email is required"
                );
              }}
              onChange={(e) => {
                updatePersonal("email", e.target.value);
                if (
                  errors.email &&
                  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value)
                ) {
                  updateError("email", undefined);
                }
              }}
              placeholder="saya@bahrul.me"
              type="email"
              value={data.personalInfo.email}
            />
            {errors.email && (
              <p className="text-destructive text-xs">{errors.email}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <PhoneInput
              defaultCountry="ID"
              onChange={(value) => {
                updatePersonal("phone", String(value ?? ""));
                if (errors.phone) {
                  updateError("phone", undefined);
                }
              }}
              placeholder="Enter phone number"
              value={data.personalInfo.phone || undefined}
            />
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              onChange={(e) => updatePersonal("location", e.target.value)}
              placeholder="Makassar, Indonesia"
              value={data.personalInfo.location}
            />
          </div>

          {/* LinkedIn */}
          <div className="space-y-1.5">
            <Label htmlFor="linkedIn">LinkedIn</Label>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <InputGroupText>linkedin.com/in/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="linkedIn"
                onChange={(e) => updatePersonal("linkedIn", e.target.value)}
                placeholder="bahrulbangsawan"
                value={data.personalInfo.linkedIn}
              />
            </InputGroup>
          </div>

          {/* Photo Profile */}
          <div className="col-span-full space-y-3">
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
              <Label htmlFor="usePhoto">Use Photo Profile</Label>
            </div>
            {data.personalInfo.usePhoto && (
              <div className="flex items-center gap-3">
                {data.personalInfo.photoUrl ? (
                  <>
                    <img
                      alt="Profile"
                      className="size-16 rounded-full border border-border object-cover"
                      src={data.personalInfo.photoUrl}
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
                      <Trash2 className="size-3" /> Remove
                    </Button>
                  </>
                ) : (
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border border-dashed px-4 py-3 text-base text-muted-foreground hover:border-foreground/30 md:min-h-0 md:text-sm">
                    <Upload className="size-4" />
                    Upload Photo
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      aria-label="Upload profile photo"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        if (file.size > 2 * 1024 * 1024) {
                          updateError("photo", "Max file size is 2MB");
                          return;
                        }
                        updateError("photo", undefined);
                        const reader = new FileReader();
                        reader.onload = () => {
                          onChange({
                            ...data,
                            personalInfo: {
                              ...data.personalInfo,
                              photoUrl: reader.result as string,
                            },
                          });
                        };
                        reader.readAsDataURL(file);
                      }}
                      type="file"
                    />
                  </label>
                )}
                {errors.photo && (
                  <p className="text-destructive text-xs">{errors.photo}</p>
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
        addLabel="Add Experience"
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
        placeholder="Work Experience"
        renderContent={(entry) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                error={errors[`exp-${entry.id}-company`]}
                label="Company"
                onBlur={() => {
                  updateError(
                    `exp-${entry.id}-company`,
                    entry.company.trim() ? undefined : "Company is required"
                  );
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "company", v);
                  if (errors[`exp-${entry.id}-company`] && v.trim()) {
                    updateError(`exp-${entry.id}-company`, undefined);
                  }
                }}
                placeholder="Company name"
                value={entry.company}
              />
              <FormField
                error={errors[`exp-${entry.id}-title`]}
                label="Job Title"
                onBlur={() => {
                  updateError(
                    `exp-${entry.id}-title`,
                    entry.title.trim() ? undefined : "Job title is required"
                  );
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "title", v);
                  if (errors[`exp-${entry.id}-title`] && v.trim()) {
                    updateError(`exp-${entry.id}-title`, undefined);
                  }
                }}
                placeholder="Your role"
                value={entry.title}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                error={errors[`exp-${entry.id}-url`]}
                label="Company URL"
                onBlur={() => {
                  updateError(
                    `exp-${entry.id}-url`,
                    entry.url && !/^https?:\/\/.+/.test(entry.url)
                      ? "Must start with http:// or https://"
                      : undefined
                  );
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "url", v);
                  if (
                    errors[`exp-${entry.id}-url`] &&
                    (!v || /^https?:\/\/.+/.test(v))
                  ) {
                    updateError(`exp-${entry.id}-url`, undefined);
                  }
                }}
                placeholder="https://..."
                type="url"
                value={entry.url}
              />
              <div className="space-y-1.5">
                <Label>Work Type</Label>
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
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_TYPE_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value || "__empty__"}
                        value={opt.value || "__empty__"}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Location Policy</Label>
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
                  <SelectTrigger>
                    <SelectValue placeholder="Select policy" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_POLICY_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value || "__empty__"}
                        value={opt.value || "__empty__"}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Start Date"
                onChange={(v) => updateExperience(entry.id, "startDate", v)}
                type="month"
                value={entry.startDate}
              />
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <MonthPicker
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateExperience(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    aria-label="Currently working here"
                    checked={entry.current}
                    className="accent-primary"
                    onChange={(e) => {
                      onChange({
                        ...data,
                        experience: data.experience.map((exp) =>
                          exp.id === entry.id
                            ? {
                                ...exp,
                                current: e.target.checked,
                                endDate: e.target.checked ? "" : exp.endDate,
                              }
                            : exp
                        ),
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="text-muted-foreground text-xs">Present</span>
                </label>
              </div>
            </div>
            <FormField
              label="Description"
              multiline
              onChange={(v) => updateExperience(entry.id, "description", v)}
              placeholder="Describe your responsibilities (one bullet per line)"
              value={entry.description}
            />
          </div>
        )}
        summary={experienceSummary}
        title={data.experienceTitle}
        titleExtra={
          totalExperience && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
              {totalExperience.label}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent
                    className="flex-col items-start text-xs leading-relaxed"
                    side="bottom"
                  >
                    <p>Career span: {totalExperience.label}</p>
                    <p>Actual working: {totalExperience.actualLabel}</p>
                    <p className="mt-1 opacity-70">
                      Since {totalExperience.since}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          )
        }
        triggerExtra={(entry) =>
          entry.startDate ? (
            <span
              className="shrink-0 text-muted-foreground text-xs"
              suppressHydrationWarning
            >
              {dateDiffLabel(
                new Date(`${entry.startDate}-01`),
                entry.current || !entry.endDate
                  ? new Date()
                  : new Date(`${entry.endDate}-01`)
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
        addLabel="Add Education"
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
        placeholder="Education"
        renderContent={(entry) => (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
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
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {EDUCATION_CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value || "__empty__"}
                      value={opt.value || "__empty__"}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                error={errors[`edu-${entry.id}-institution`]}
                label="Institution"
                onBlur={() => {
                  updateError(
                    `edu-${entry.id}-institution`,
                    entry.institution.trim()
                      ? undefined
                      : "Institution is required"
                  );
                }}
                onChange={(v) => {
                  updateEducation(entry.id, "institution", v);
                  if (errors[`edu-${entry.id}-institution`] && v.trim()) {
                    updateError(`edu-${entry.id}-institution`, undefined);
                  }
                }}
                placeholder="University name"
                value={entry.institution}
              />
              <FormField
                error={errors[`edu-${entry.id}-degree`]}
                label="Degree"
                onBlur={() => {
                  updateError(
                    `edu-${entry.id}-degree`,
                    entry.degree.trim() ? undefined : "Degree is required"
                  );
                }}
                onChange={(v) => {
                  updateEducation(entry.id, "degree", v);
                  if (errors[`edu-${entry.id}-degree`] && v.trim()) {
                    updateError(`edu-${entry.id}-degree`, undefined);
                  }
                }}
                placeholder="B.S. Computer Science"
                value={entry.degree}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                label="GPA"
                max={4}
                min={0}
                onChange={(v) => updateEducation(entry.id, "gpa", v)}
                placeholder="3.50"
                step={0.01}
                type="number"
                value={entry.gpa}
              />
              <FormField
                label="Start Date"
                onChange={(v) => updateEducation(entry.id, "startDate", v)}
                type="month"
                value={entry.startDate}
              />
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <MonthPicker
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateEducation(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    aria-label="Currently enrolled"
                    checked={entry.current}
                    className="accent-primary"
                    onChange={(e) => {
                      onChange({
                        ...data,
                        education: data.education.map((edu) =>
                          edu.id === entry.id
                            ? {
                                ...edu,
                                current: e.target.checked,
                                endDate: e.target.checked ? "" : edu.endDate,
                              }
                            : edu
                        ),
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="text-muted-foreground text-xs">Present</span>
                </label>
              </div>
            </div>
          </div>
        )}
        summary={(entry, index) => {
          if (entry.degree && entry.institution) {
            return `${entry.degree} – ${entry.institution}`;
          }
          return entry.degree || entry.institution || `Education #${index + 1}`;
        }}
        title={data.educationTitle}
        titleExtra={
          sinceGraduation && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
              {sinceGraduation.label}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent
                    className="flex-col items-start text-xs leading-relaxed"
                    side="bottom"
                  >
                    <p>Since last university graduation</p>
                    <p>Graduated: {sinceGraduation.since}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          )
        }
        triggerExtra={(entry) =>
          entry.startDate ? (
            <span
              className="shrink-0 text-muted-foreground text-xs"
              suppressHydrationWarning
            >
              {dateDiffLabel(
                new Date(`${entry.startDate}-01`),
                entry.current || !entry.endDate
                  ? new Date()
                  : new Date(`${entry.endDate}-01`)
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
        addLabel="Add Category"
        items={data.skills}
        onAdd={addSkillCategory}
        onRemove={removeSkillCategory}
        onReorder={(items) => onChange({ ...data, skills: items })}
        onTitleChange={(v) => onChange({ ...data, skillsTitle: v })}
        placeholder="Skills"
        renderContent={(category) => (
          <div className="space-y-3">
            <FormField
              label="Category Name"
              onChange={(v) => updateSkillCategoryName(category.id, v)}
              placeholder="e.g. Hard Skills, Soft Skills, Tools"
              value={category.name}
            />
            <div className="space-y-1.5">
              <Label>Skills</Label>
              <Input
                onChange={(e) =>
                  setSkillInputs((prev) => ({
                    ...prev,
                    [category.id]: e.target.value,
                  }))
                }
                onKeyDown={(e) => handleCategorySkillKeyDown(category.id, e)}
                placeholder="Type a skill and press Enter"
                value={skillInputs[category.id] ?? ""}
              />
            </div>
            {category.items.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {category.items.map((skill) => (
                  <Badge
                    className="cursor-pointer"
                    key={skill}
                    onClick={() => removeSkillFromCategory(category.id, skill)}
                    variant="secondary"
                  >
                    {skill}
                    <X className="size-2.5" />
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
          return category.name || "Untitled Category";
        }}
        title={data.skillsTitle}
        titleExtra={
          data.skills.length > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {data.skills.reduce((sum, c) => sum + c.items.length, 0)} skills
            </span>
          )
        }
      />
    );
  }

  function renderAwardsSection() {
    return (
      <SectionList<AwardEntry>
        addLabel="Add Award"
        items={data.awards}
        onAdd={addAward}
        onRemove={removeAward}
        onReorder={(items) => onChange({ ...data, awards: items })}
        onTitleChange={(v) => onChange({ ...data, awardsTitle: v })}
        placeholder="Awards"
        renderContent={(entry) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Title"
                onChange={(v) => updateAward(entry.id, "title", v)}
                placeholder="Award name"
                value={entry.title}
              />
              <FormField
                label="Issuer"
                onChange={(v) => updateAward(entry.id, "issuer", v)}
                placeholder="Issuing organization"
                value={entry.issuer}
              />
              <FormField
                label="Date"
                onChange={(v) => updateAward(entry.id, "date", v)}
                type="month"
                value={entry.date}
              />
            </div>
            <FormField
              label="Description"
              multiline
              onChange={(v) => updateAward(entry.id, "description", v)}
              placeholder="Brief description"
              value={entry.description}
            />
            <FormField
              error={errors[`award-${entry.id}-url`]}
              label="URL"
              onBlur={() => {
                updateError(
                  `award-${entry.id}-url`,
                  entry.url && !/^https?:\/\/.+/.test(entry.url)
                    ? "Must start with http:// or https://"
                    : undefined
                );
              }}
              onChange={(v) => {
                updateAward(entry.id, "url", v);
                if (
                  errors[`award-${entry.id}-url`] &&
                  (!v || /^https?:\/\/.+/.test(v))
                ) {
                  updateError(`award-${entry.id}-url`, undefined);
                }
              }}
              placeholder="https://..."
              type="url"
              value={entry.url}
            />
          </>
        )}
        summary={(entry, index) => {
          if (entry.title && entry.issuer) {
            return `${entry.title} – ${entry.issuer}`;
          }
          return entry.title || entry.issuer || `Award #${index + 1}`;
        }}
        title={data.awardsTitle}
        titleExtra={
          data.awards.length > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {data.awards.length}{" "}
              {data.awards.length === 1 ? "award" : "awards"}
            </span>
          )
        }
      />
    );
  }

  function renderCertificatesSection() {
    return (
      <SectionList<CertificateEntry>
        addLabel="Add Certificate"
        items={data.certificates}
        onAdd={addCertificate}
        onRemove={removeCertificate}
        onReorder={(items) => onChange({ ...data, certificates: items })}
        onTitleChange={(v) => onChange({ ...data, certificatesTitle: v })}
        placeholder="Certificates"
        renderContent={(entry) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Certificate Name"
                onChange={(v) => updateCertificate(entry.id, "name", v)}
                placeholder="Certificate name"
                value={entry.name}
              />
              <FormField
                label="Issuer"
                onChange={(v) => updateCertificate(entry.id, "issuer", v)}
                placeholder="Issuing organization"
                value={entry.issuer}
              />
              <FormField
                label="Issued Date"
                onChange={(v) => updateCertificate(entry.id, "date", v)}
                type="month"
                value={entry.date}
              />
              <FormField
                label="Expiry Date"
                onChange={(v) => updateCertificate(entry.id, "expiryDate", v)}
                type="month"
                value={entry.expiryDate}
              />
              <FormField
                label="Credential ID"
                onChange={(v) => updateCertificate(entry.id, "credentialId", v)}
                placeholder="Optional credential ID"
                value={entry.credentialId}
              />
              <FormField
                error={errors[`cert-${entry.id}-url`]}
                label="URL"
                onBlur={() => {
                  updateError(
                    `cert-${entry.id}-url`,
                    entry.url && !/^https?:\/\/.+/.test(entry.url)
                      ? "Must start with http:// or https://"
                      : undefined
                  );
                }}
                onChange={(v) => {
                  updateCertificate(entry.id, "url", v);
                  if (
                    errors[`cert-${entry.id}-url`] &&
                    (!v || /^https?:\/\/.+/.test(v))
                  ) {
                    updateError(`cert-${entry.id}-url`, undefined);
                  }
                }}
                placeholder="https://..."
                type="url"
                value={entry.url}
              />
            </div>
          </>
        )}
        summary={(entry, index) => {
          if (entry.name && entry.issuer) {
            return `${entry.name} – ${entry.issuer}`;
          }
          return entry.name || entry.issuer || `Certificate #${index + 1}`;
        }}
        title={data.certificatesTitle}
        titleExtra={
          data.certificates.length > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {data.certificates.length}{" "}
              {data.certificates.length === 1 ? "certificate" : "certificates"}
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
                className="shrink-0 text-destructive text-xs"
                suppressHydrationWarning
              >
                Expired {dateDiffLabel(expiry, now)} ago
              </span>
            );
          }
          return (
            <span
              className="shrink-0 text-muted-foreground text-xs"
              suppressHydrationWarning
            >
              Expires in {dateDiffLabel(now, expiry)}
            </span>
          );
        }}
      />
    );
  }

  function renderLanguagesSection() {
    return (
      <SectionList<LanguageEntry>
        addLabel="Add Language"
        items={data.languages}
        onAdd={addLanguage}
        onRemove={removeLanguage}
        onReorder={(items) => onChange({ ...data, languages: items })}
        onTitleChange={(v) => onChange({ ...data, languagesTitle: v })}
        placeholder="Languages"
        renderContent={(entry) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              label="Language"
              onChange={(v) => updateLanguage(entry.id, "language", v)}
              placeholder="e.g. English"
              value={entry.language}
            />
            <FormField
              label="Proficiency"
              onChange={(v) => updateLanguage(entry.id, "proficiency", v)}
              placeholder="e.g. Native, Fluent, Intermediate"
              value={entry.proficiency}
            />
          </div>
        )}
        summary={(entry, index) => {
          if (entry.language && entry.proficiency) {
            return `${entry.language} – ${entry.proficiency}`;
          }
          return entry.language || `Language #${index + 1}`;
        }}
        title={data.languagesTitle}
        titleExtra={
          data.languages.length > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {data.languages.length}{" "}
              {data.languages.length === 1 ? "language" : "languages"}
            </span>
          )
        }
      />
    );
  }

  function renderProjectsSection() {
    return (
      <SectionList<ProjectEntry>
        addLabel="Add Project"
        items={data.projects}
        onAdd={addProject}
        onRemove={removeProject}
        onReorder={(items) => onChange({ ...data, projects: items })}
        onTitleChange={(v) => onChange({ ...data, projectsTitle: v })}
        placeholder="Projects"
        renderContent={(entry) => (
          <div className="grid gap-3">
            <FormField
              label="Name"
              onChange={(v) => updateProject(entry.id, "name", v)}
              placeholder="e.g. My Project"
              value={entry.name}
            />
            <FormField
              label="URL"
              onChange={(v) => updateProject(entry.id, "url", v)}
              placeholder="https://..."
              type="url"
              value={entry.url}
            />
            <FormField
              label="Description"
              multiline
              onChange={(v) => updateProject(entry.id, "description", v)}
              placeholder="Brief description of the project"
              rows={2}
              value={entry.description}
            />
          </div>
        )}
        summary={(entry, index) => entry.name || `Project ${index + 1}`}
        title={data.projectsTitle}
        titleExtra={
          data.projects.length > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {data.projects.length}{" "}
              {data.projects.length === 1 ? "project" : "projects"}
            </span>
          )
        }
      />
    );
  }

  function renderVolunteerSection() {
    return (
      <SectionList<VolunteerEntry>
        addLabel="Add Volunteer"
        items={data.volunteer}
        onAdd={addVolunteer}
        onRemove={removeVolunteer}
        onReorder={(items) => onChange({ ...data, volunteer: items })}
        onTitleChange={(v) => onChange({ ...data, volunteerTitle: v })}
        placeholder="Volunteer & Community"
        renderContent={(entry) => (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Organization"
                onChange={(v) => updateVolunteer(entry.id, "organization", v)}
                placeholder="Organization name"
                value={entry.organization}
              />
              <FormField
                label="Role"
                onChange={(v) => updateVolunteer(entry.id, "role", v)}
                placeholder="Your role"
                value={entry.role}
              />
              <FormField
                label="Start Date"
                onChange={(v) => updateVolunteer(entry.id, "startDate", v)}
                type="month"
                value={entry.startDate}
              />
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <MonthPicker
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateVolunteer(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    aria-label="Currently volunteering here"
                    checked={entry.current}
                    className="accent-primary"
                    onChange={(e) => {
                      onChange({
                        ...data,
                        volunteer: data.volunteer.map((vol) =>
                          vol.id === entry.id
                            ? {
                                ...vol,
                                current: e.target.checked,
                                endDate: e.target.checked ? "" : vol.endDate,
                              }
                            : vol
                        ),
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="text-muted-foreground text-xs">Present</span>
                </label>
              </div>
            </div>
            <FormField
              label="Description"
              multiline
              onChange={(v) => updateVolunteer(entry.id, "description", v)}
              placeholder="Describe your contributions (one bullet per line)"
              value={entry.description}
            />
          </div>
        )}
        summary={(entry, index) => {
          if (entry.role && entry.organization) {
            return `${entry.role} at ${entry.organization}`;
          }
          return entry.role || entry.organization || `Volunteer #${index + 1}`;
        }}
        title={data.volunteerTitle}
        titleExtra={
          data.volunteer.length > 0 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {data.volunteer.length}{" "}
              {data.volunteer.length === 1 ? "activity" : "activities"}
            </span>
          )
        }
        triggerExtra={(entry) =>
          entry.startDate ? (
            <span
              className="shrink-0 text-muted-foreground text-xs"
              suppressHydrationWarning
            >
              {dateDiffLabel(
                new Date(`${entry.startDate}-01`),
                entry.current || !entry.endDate
                  ? new Date()
                  : new Date(`${entry.endDate}-01`)
              )}
            </span>
          ) : null
        }
      />
    );
  }
}

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
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      className="relative"
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 200px",
      }}
    >
      <div
        className="absolute top-1 -left-4 cursor-grab text-muted-foreground/50 hover:text-muted-foreground sm:-left-6"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </div>
      <Separator className="mb-6" />
      {children}
    </div>
  );
}
