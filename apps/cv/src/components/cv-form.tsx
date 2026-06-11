import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { FormField } from "@rulisme/ui/form/form-field"
import { MonthPicker } from "@rulisme/ui/form/month-picker"
import { SectionList } from "@rulisme/ui/form/section-list"
import { PhoneInput } from "@rulisme/ui/reui/phone-input"
import { Badge } from "@rulisme/ui/ui/badge"
import { Button } from "@rulisme/ui/ui/button"
import { Input } from "@rulisme/ui/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@rulisme/ui/ui/input-group"
import { Label } from "@rulisme/ui/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select"
import { Separator } from "@rulisme/ui/ui/separator"
import { Switch } from "@rulisme/ui/ui/switch"
import { Textarea } from "@rulisme/ui/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@rulisme/ui/ui/tooltip"
import { GripVertical, Info, Trash2, Upload, X } from "lucide-react"
import { type ReactNode, useId, useMemo, useState } from "react"
import { useTranslation } from "@/i18n"
import { preprocessImage } from "@/lib/preprocess-image"

// Profile photos render into a ~64px avatar in the preview and a small fixed box
// in every PDF template, so 480px on the long edge is retina-sharp yet tiny.
const PHOTO_MAX_EDGE = 480

type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string

export interface PersonalInfo {
  fullName: string
  jobTitle: string
  email: string
  phone: string
  location: string
  linkedIn: string
  photoUrl: string
  usePhoto: boolean
}

export type WorkType = "" | "full-time" | "part-time" | "internship"
export type LocationPolicy =
  | ""
  | "work-from-office"
  | "work-from-anywhere"
  | "hybrid"

const WORK_TYPE_OPTIONS: { value: WorkType; labelKey: string }[] = [
  { value: "", labelKey: "options.notSpecified" },
  { value: "full-time", labelKey: "options.workType.fullTime" },
  { value: "part-time", labelKey: "options.workType.partTime" },
  { value: "internship", labelKey: "options.workType.internship" },
]

const LOCATION_POLICY_OPTIONS: {
  value: LocationPolicy
  labelKey: string
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
]

export interface ExperienceEntry {
  id: string
  company: string
  url: string
  title: string
  workType: WorkType
  locationPolicy: LocationPolicy
  startDate: string
  endDate: string
  current: boolean
  description: string
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
  | "professional-association"

const EDUCATION_CATEGORY_OPTIONS: {
  value: EducationCategory
  labelKey: string
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
]

export interface EducationEntry {
  id: string
  category: EducationCategory
  institution: string
  degree: string
  gpa: string
  startDate: string
  endDate: string
  current: boolean
}

export interface AwardEntry {
  id: string
  title: string
  issuer: string
  date: string
  description: string
  url: string
}

export interface CertificateEntry {
  id: string
  name: string
  issuer: string
  date: string
  expiryDate: string
  credentialId: string
  url: string
}

export interface LanguageEntry {
  id: string
  language: string
  proficiency: string
}

export interface ProjectEntry {
  id: string
  name: string
  url: string
  description: string
}

export interface VolunteerEntry {
  id: string
  organization: string
  role: string
  startDate: string
  endDate: string
  current: boolean
  description: string
}

export type CVStyle = "basic" | "harvard" | "simple" | "standard"

export interface SkillCategory {
  id: string
  name: string
  items: string[]
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
  | "volunteer"

export interface CVData {
  /**
   * Selected template. Persisted so the chosen layout round-trips into the
   * print view / PDF (the `/cv/<slug>.pdf` redirect renders whatever is saved
   * here). Optional for backwards-compat with documents stored before the
   * field existed — consumers default to "basic".
   */
  style?: CVStyle
  personalInfo: PersonalInfo
  sectionOrder: CVSectionId[]
  summaryTitle: string
  summary: string
  experienceTitle: string
  experience: ExperienceEntry[]
  educationTitle: string
  education: EducationEntry[]
  skillsTitle: string
  skills: SkillCategory[]
  awardsTitle: string
  awards: AwardEntry[]
  certificatesTitle: string
  certificates: CertificateEntry[]
  languagesTitle: string
  languages: LanguageEntry[]
  projectsTitle: string
  projects: ProjectEntry[]
  volunteerTitle: string
  volunteer: VolunteerEntry[]
}

function dateDiffLabel(from: Date, to: Date, t: Translate) {
  let y = to.getFullYear() - from.getFullYear()
  let m = to.getMonth() - from.getMonth()
  let d = to.getDate() - from.getDate()
  if (d < 0) {
    m--
    d += new Date(to.getFullYear(), to.getMonth(), 0).getDate()
  }
  if (m < 0) {
    y--
    m += 12
  }
  const p: string[] = []
  if (y > 0) {
    p.push(t(y === 1 ? "form.year" : "form.years", { n: y }))
  }
  if (m > 0) {
    p.push(t(m === 1 ? "form.month" : "form.months", { n: m }))
  }
  if (d > 0) {
    p.push(t(d === 1 ? "form.day" : "form.days", { n: d }))
  }
  return p.join(", ") || t("form.zeroDays")
}

interface CVFormProps {
  data: CVData
  onChange: (data: CVData) => void
}

const currentMonth = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
})()

export function CVForm({ data, onChange }: CVFormProps) {
  const { t } = useTranslation()
  const [skillInputs, setSkillInputs] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // --- Error management ---
  function updateError(key: string, error: string | undefined) {
    setErrors((prev) => {
      if (error) {
        return { ...prev, [key]: error }
      }
      if (!(key in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handlePhotoFile(file: File) {
    try {
      const photoUrl = await preprocessImage(file, { maxEdge: PHOTO_MAX_EDGE })
      updateError("photo", undefined)
      onChange({
        ...data,
        personalInfo: { ...data.personalInfo, photoUrl },
      })
    } catch {
      updateError("photo", t("errors.imageProcess"))
    }
  }

  // --- Personal info ---
  function updatePersonal(field: keyof PersonalInfo, value: string) {
    onChange({
      ...data,
      personalInfo: { ...data.personalInfo, [field]: value },
    })
  }

  // --- Experience ---
  function addExperience() {
    const id = crypto.randomUUID()
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
    })
  }

  function removeExperience(id: string) {
    onChange({
      ...data,
      experience: data.experience.filter((e) => e.id !== id),
    })
    setErrors((prev) => {
      const next = { ...prev }
      delete next[`exp-${id}-company`]
      delete next[`exp-${id}-title`]
      delete next[`exp-${id}-url`]
      return next
    })
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
    })
  }

  // --- Education ---
  function addEducation() {
    const id = crypto.randomUUID()
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
    })
  }

  function removeEducation(id: string) {
    onChange({
      ...data,
      education: data.education.filter((e) => e.id !== id),
    })
    setErrors((prev) => {
      const next = { ...prev }
      delete next[`edu-${id}-institution`]
      delete next[`edu-${id}-degree`]
      return next
    })
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
    })
  }

  // --- Skills ---
  function addSkillCategory() {
    const id = crypto.randomUUID()
    onChange({
      ...data,
      skills: [...data.skills, { id, name: "", items: [] }],
    })
  }

  function removeSkillCategory(id: string) {
    onChange({ ...data, skills: data.skills.filter((c) => c.id !== id) })
    setSkillInputs((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function updateSkillCategoryName(id: string, name: string) {
    onChange({
      ...data,
      skills: data.skills.map((c) => (c.id === id ? { ...c, name } : c)),
    })
  }

  function handleCategorySkillKeyDown(
    categoryId: string,
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Enter") {
      e.preventDefault()
      const trimmed = (skillInputs[categoryId] ?? "").trim()
      const category = data.skills.find((c) => c.id === categoryId)
      if (trimmed && category && !category.items.includes(trimmed)) {
        onChange({
          ...data,
          skills: data.skills.map((c) =>
            c.id === categoryId ? { ...c, items: [...c.items, trimmed] } : c
          ),
        })
        setSkillInputs((prev) => ({ ...prev, [categoryId]: "" }))
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
    })
  }

  // --- Awards ---
  function addAward() {
    const id = crypto.randomUUID()
    onChange({
      ...data,
      awards: [
        ...data.awards,
        { id, title: "", issuer: "", date: "", description: "", url: "" },
      ],
    })
  }

  function removeAward(id: string) {
    onChange({ ...data, awards: data.awards.filter((e) => e.id !== id) })
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
    })
  }

  // --- Certificates ---
  function addCertificate() {
    const id = crypto.randomUUID()
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
    })
  }

  function removeCertificate(id: string) {
    onChange({
      ...data,
      certificates: data.certificates.filter((e) => e.id !== id),
    })
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
    })
  }

  // --- Languages ---
  function addLanguage() {
    const id = crypto.randomUUID()
    onChange({
      ...data,
      languages: [...data.languages, { id, language: "", proficiency: "" }],
    })
  }

  function removeLanguage(id: string) {
    onChange({
      ...data,
      languages: data.languages.filter((e) => e.id !== id),
    })
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
    })
  }

  function addProject() {
    const id = crypto.randomUUID()
    onChange({
      ...data,
      projects: [...data.projects, { id, name: "", url: "", description: "" }],
    })
  }

  function removeProject(id: string) {
    onChange({
      ...data,
      projects: data.projects.filter((e) => e.id !== id),
    })
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
    })
  }

  // --- Volunteer ---
  function addVolunteer() {
    const id = crypto.randomUUID()
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
    })
  }

  function removeVolunteer(id: string) {
    onChange({
      ...data,
      volunteer: data.volunteer.filter((e) => e.id !== id),
    })
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
    })
  }

  // --- Accordion summaries ---
  function experienceSummary(entry: ExperienceEntry, index: number) {
    if (entry.title && entry.company) {
      return t("form.summaryAt", { title: entry.title, company: entry.company })
    }
    return (
      entry.title ||
      entry.company ||
      t("form.experienceFallback", { index: index + 1 })
    )
  }

  const totalExperience = useMemo(() => {
    const now = new Date()
    const intervals = data.experience.reduce<{ start: Date; end: Date }[]>(
      (acc, e) => {
        if (!e.startDate) {
          return acc
        }
        const start = new Date(`${e.startDate}-01`)
        const end = e.current || !e.endDate ? now : new Date(`${e.endDate}-01`)
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return acc
        }
        acc.push({ start, end })
        return acc
      },
      []
    )
    if (intervals.length === 0) {
      return null
    }

    const earliest = new Date(
      Math.min(...intervals.map((i) => i.start.getTime()))
    )
    const since = earliest.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    })
    const spanLabel = dateDiffLabel(earliest, now, t)

    const sorted = [...intervals].sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    )
    const merged: { start: Date; end: Date }[] = []
    for (const iv of sorted) {
      const last = merged.at(-1)
      if (last && iv.start <= last.end) {
        if (iv.end > last.end) {
          last.end = iv.end
        }
      } else {
        merged.push({ start: new Date(iv.start), end: new Date(iv.end) })
      }
    }
    let totalMs = 0
    for (const block of merged) {
      totalMs += block.end.getTime() - block.start.getTime()
    }
    const totalDays = Math.floor(totalMs / (1000 * 60 * 60 * 24))
    const refEnd = new Date(totalDays * 24 * 60 * 60 * 1000)
    const actualLabel = dateDiffLabel(new Date(0), refEnd, t)

    return { label: spanLabel, since, actualLabel }
  }, [data.experience, t])

  const sinceGraduation = useMemo(() => {
    const now = new Date()
    const uniEntries = data.education.filter(
      (e) => e.category === "university" && (e.endDate || e.current)
    )
    if (uniEntries.length === 0) {
      return null
    }

    const endDates = uniEntries
      .map((e) => (e.current ? now : new Date(`${e.endDate}-01`)))
      .filter((d) => !Number.isNaN(d.getTime()))
    if (endDates.length === 0) {
      return null
    }

    const latest = new Date(Math.max(...endDates.map((d) => d.getTime())))
    const label = dateDiffLabel(latest, now, t)
    const since = latest.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    })

    return { label, since }
  }, [data.education, t])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )
  const dndContextId = useId()

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }
    const oldIndex = data.sectionOrder.indexOf(active.id as CVSectionId)
    const newIndex = data.sectionOrder.indexOf(over.id as CVSectionId)
    if (oldIndex === -1 || newIndex === -1) {
      return
    }
    onChange({
      ...data,
      sectionOrder: arrayMove(data.sectionOrder, oldIndex, newIndex),
    })
  }

  function renderSection(sectionId: CVSectionId): ReactNode {
    switch (sectionId) {
      case "summary":
        return (
          <section>
            <input
              aria-label={t("a11y2.summarySectionTitle")}
              className="w-full bg-transparent text-body-sm font-medium outline-none placeholder:text-muted-foreground"
              onChange={(e) =>
                onChange({ ...data, summaryTitle: e.target.value })
              }
              placeholder={t("placeholders.summaryTitle")}
              value={data.summaryTitle}
            />
            <div className="mt-3">
              <Textarea
                aria-invalid={!!errors.summary}
                onBlur={(e) => {
                  updateError(
                    "summary",
                    e.target.value.length > 500
                      ? t("errors.maxFiveHundredChars")
                      : undefined
                  )
                }}
                onChange={(e) => {
                  onChange({ ...data, summary: e.target.value })
                  if (errors.summary && e.target.value.length <= 500) {
                    updateError("summary", undefined)
                  }
                }}
                placeholder={t("placeholders.summary")}
                value={data.summary}
              />
              <div className="mt-1 flex justify-between">
                {errors.summary ? (
                  <p className="text-xs text-destructive">{errors.summary}</p>
                ) : (
                  <span />
                )}
                <p
                  className={`text-xs ${data.summary.length > 500 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {t("form.charCounter", { count: data.summary.length })}
                </p>
              </div>
            </div>
          </section>
        )
      case "experience":
        return renderExperienceSection()
      case "education":
        return renderEducationSection()
      case "skills":
        return renderSkillsSection()
      case "awards":
        return renderAwardsSection()
      case "certificates":
        return renderCertificatesSection()
      case "languages":
        return renderLanguagesSection()
      case "projects":
        return renderProjectsSection()
      case "volunteer":
        return renderVolunteerSection()
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Personal Info ── */}
      <section>
        <h2 className="text-body-sm font-medium">
          {t("form.personalInformation")}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Full Name */}
          <div className="space-y-1.5">
            <Label htmlFor="fullName">{t("form.fullName")}</Label>
            <Input
              aria-invalid={!!errors.fullName}
              id="fullName"
              onBlur={(e) => {
                const v = e.target.value.trim()
                updateError(
                  "fullName",
                  v
                    ? v.length < 2
                      ? t("errors.minTwoChars")
                      : undefined
                    : t("errors.fullNameRequired")
                )
              }}
              onChange={(e) => {
                updatePersonal("fullName", e.target.value)
                if (errors.fullName && e.target.value.trim().length >= 2) {
                  updateError("fullName", undefined)
                }
              }}
              placeholder={t("placeholders.fullName")}
              value={data.personalInfo.fullName}
            />
            {errors.fullName && (
              <p className="text-xs text-destructive">{errors.fullName}</p>
            )}
          </div>

          {/* Job Title */}
          <div className="space-y-1.5">
            <Label htmlFor="jobTitle">{t("form.jobTitle")}</Label>
            <Input
              id="jobTitle"
              onChange={(e) => updatePersonal("jobTitle", e.target.value)}
              placeholder={t("placeholders.jobTitle")}
              value={data.personalInfo.jobTitle}
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("form.email")}</Label>
            <Input
              aria-invalid={!!errors.email}
              id="email"
              onBlur={(e) => {
                const v = e.target.value
                updateError(
                  "email",
                  v.trim()
                    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
                      ? undefined
                      : t("errors.invalidEmail")
                    : t("errors.emailRequired")
                )
              }}
              onChange={(e) => {
                updatePersonal("email", e.target.value)
                if (
                  errors.email &&
                  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value)
                ) {
                  updateError("email", undefined)
                }
              }}
              placeholder={t("placeholders.email")}
              type="email"
              value={data.personalInfo.email}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label>{t("form.phone")}</Label>
            <PhoneInput
              defaultCountry="ID"
              onChange={(value) => {
                updatePersonal("phone", String(value ?? ""))
                if (errors.phone) {
                  updateError("phone", undefined)
                }
              }}
              placeholder={t("placeholders.phone")}
              value={data.personalInfo.phone || undefined}
            />
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="location">{t("form.location")}</Label>
            <Input
              id="location"
              onChange={(e) => updatePersonal("location", e.target.value)}
              placeholder={t("placeholders.location")}
              value={data.personalInfo.location}
            />
          </div>

          {/* LinkedIn */}
          <div className="space-y-1.5">
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
              <Label htmlFor="usePhoto">{t("form.usePhotoProfile")}</Label>
            </div>
            {data.personalInfo.usePhoto && (
              <div className="flex items-center gap-3">
                {data.personalInfo.photoUrl ? (
                  <>
                    <img
                      alt={t("a11y2.profile")}
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
                      <Trash2 className="size-3" /> {t("form.remove")}
                    </Button>
                  </>
                ) : (
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-xs text-muted-foreground hover:border-foreground/30">
                    <Upload className="size-4" />
                    {t("form.uploadPhoto")}
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      aria-label={t("a11y2.uploadProfilePhoto")}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ""
                        if (file) {
                          void handlePhotoFile(file)
                        }
                      }}
                      type="file"
                    />
                  </label>
                )}
                {errors.photo && (
                  <p className="text-xs text-destructive">{errors.photo}</p>
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
  )

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
        renderContent={(entry) => (
          <div className="space-y-3">
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
                  )
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "company", v)
                  if (errors[`exp-${entry.id}-company`] && v.trim()) {
                    updateError(`exp-${entry.id}-company`, undefined)
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
                  )
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "title", v)
                  if (errors[`exp-${entry.id}-title`] && v.trim()) {
                    updateError(`exp-${entry.id}-title`, undefined)
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
                    entry.url && !/^https?:\/\/.+/.test(entry.url)
                      ? t("errors.invalidUrl")
                      : undefined
                  )
                }}
                onChange={(v) => {
                  updateExperience(entry.id, "url", v)
                  if (
                    errors[`exp-${entry.id}-url`] &&
                    (!v || /^https?:\/\/.+/.test(v))
                  ) {
                    updateError(`exp-${entry.id}-url`, undefined)
                  }
                }}
                placeholder={t("placeholders.url")}
                type="url"
                value={entry.url}
              />
              <div className="space-y-1.5">
                <Label>{t("form.workType")}</Label>
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
                    <SelectValue placeholder={t("placeholders.selectType")} />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_TYPE_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value || "__empty__"}
                        value={opt.value || "__empty__"}
                      >
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("form.locationPolicy")}</Label>
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
                    <SelectValue placeholder={t("placeholders.selectPolicy")} />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_POLICY_OPTIONS.map((opt) => (
                      <SelectItem
                        key={opt.value || "__empty__"}
                        value={opt.value || "__empty__"}
                      >
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
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
              <div className="space-y-1.5">
                <Label>{t("form.endDate")}</Label>
                <MonthPicker
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateExperience(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    aria-label={t("a11y2.currentlyWorkingHere")}
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
                      })
                    }}
                    type="checkbox"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("form.present")}
                  </span>
                </label>
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
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
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
            <span
              className="shrink-0 text-xs text-muted-foreground"
              suppressHydrationWarning
            >
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
    )
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
        renderContent={(entry) => (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("form.category")}</Label>
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
                  <SelectValue placeholder={t("placeholders.selectCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {EDUCATION_CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value || "__empty__"}
                      value={opt.value || "__empty__"}
                    >
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
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
                  )
                }}
                onChange={(v) => {
                  updateEducation(entry.id, "institution", v)
                  if (errors[`edu-${entry.id}-institution`] && v.trim()) {
                    updateError(`edu-${entry.id}-institution`, undefined)
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
                  )
                }}
                onChange={(v) => {
                  updateEducation(entry.id, "degree", v)
                  if (errors[`edu-${entry.id}-degree`] && v.trim()) {
                    updateError(`edu-${entry.id}-degree`, undefined)
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
              <div className="space-y-1.5">
                <Label>{t("form.endDate")}</Label>
                <MonthPicker
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateEducation(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    aria-label={t("a11y2.currentlyEnrolled")}
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
                      })
                    }}
                    type="checkbox"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("form.present")}
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}
        summary={(entry, index) => {
          if (entry.degree && entry.institution) {
            return t("form.summaryDash", {
              a: entry.degree,
              b: entry.institution,
            })
          }
          return (
            entry.degree ||
            entry.institution ||
            t("form.educationFallback", { index: index + 1 })
          )
        }}
        title={data.educationTitle}
        titleExtra={
          sinceGraduation && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
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
            <span
              className="shrink-0 text-xs text-muted-foreground"
              suppressHydrationWarning
            >
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
    )
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
        renderContent={(category) => (
          <div className="space-y-3">
            <FormField
              label={t("form.categoryName")}
              onChange={(v) => updateSkillCategoryName(category.id, v)}
              placeholder={t("placeholders.categoryItems")}
              value={category.name}
            />
            <div className="space-y-1.5">
              <Label>{t("form.skills")}</Label>
              <Input
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
            return `${category.name} (${category.items.length})`
          }
          return category.name || t("form.untitledCategory")
        }}
        title={data.skillsTitle}
        titleExtra={
          data.skills.length > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t("form.skillsCount", {
                count: data.skills.reduce((sum, c) => sum + c.items.length, 0),
              })}
            </span>
          )
        }
      />
    )
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
                  entry.url && !/^https?:\/\/.+/.test(entry.url)
                    ? t("errors.invalidUrl")
                    : undefined
                )
              }}
              onChange={(v) => {
                updateAward(entry.id, "url", v)
                if (
                  errors[`award-${entry.id}-url`] &&
                  (!v || /^https?:\/\/.+/.test(v))
                ) {
                  updateError(`award-${entry.id}-url`, undefined)
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
            return t("form.summaryDash", { a: entry.title, b: entry.issuer })
          }
          return (
            entry.title ||
            entry.issuer ||
            t("form.awardFallback", { index: index + 1 })
          )
        }}
        title={data.awardsTitle}
        titleExtra={
          data.awards.length > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
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
    )
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
                    entry.url && !/^https?:\/\/.+/.test(entry.url)
                      ? t("errors.invalidUrl")
                      : undefined
                  )
                }}
                onChange={(v) => {
                  updateCertificate(entry.id, "url", v)
                  if (
                    errors[`cert-${entry.id}-url`] &&
                    (!v || /^https?:\/\/.+/.test(v))
                  ) {
                    updateError(`cert-${entry.id}-url`, undefined)
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
            return t("form.summaryDash", { a: entry.name, b: entry.issuer })
          }
          return (
            entry.name ||
            entry.issuer ||
            t("form.certificateFallback", { index: index + 1 })
          )
        }}
        title={data.certificatesTitle}
        titleExtra={
          data.certificates.length > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
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
            return null
          }
          const expiry = new Date(`${entry.expiryDate}-01`)
          if (Number.isNaN(expiry.getTime())) {
            return null
          }
          const now = new Date()
          const isExpired =
            expiry < new Date(now.getFullYear(), now.getMonth(), 1)
          if (isExpired) {
            return (
              <span
                className="shrink-0 text-xs text-destructive"
                suppressHydrationWarning
              >
                {t("form.expiredAgo", {
                  duration: dateDiffLabel(expiry, now, t),
                })}
              </span>
            )
          }
          return (
            <span
              className="shrink-0 text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {t("form.expiresIn", { duration: dateDiffLabel(now, expiry, t) })}
            </span>
          )
        }}
      />
    )
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
            })
          }
          return (
            entry.language || t("form.languageFallback", { index: index + 1 })
          )
        }}
        title={data.languagesTitle}
        titleExtra={
          data.languages.length > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
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
    )
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
            <span className="shrink-0 text-xs text-muted-foreground">
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
    )
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
        renderContent={(entry) => (
          <div className="space-y-3">
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
              <div className="space-y-1.5">
                <Label>{t("form.endDate")}</Label>
                <MonthPicker
                  disabled={entry.current}
                  max={currentMonth}
                  onChange={(v) => updateVolunteer(entry.id, "endDate", v)}
                  value={entry.current ? "" : entry.endDate}
                />
                <label className="flex items-center gap-1.5">
                  <input
                    aria-label={t("a11y2.currentlyVolunteeringHere")}
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
                      })
                    }}
                    type="checkbox"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("form.present")}
                  </span>
                </label>
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
            })
          }
          return (
            entry.role ||
            entry.organization ||
            t("form.volunteerFallback", { index: index + 1 })
          )
        }}
        title={data.volunteerTitle}
        titleExtra={
          data.volunteer.length > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
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
            <span
              className="shrink-0 text-xs text-muted-foreground"
              suppressHydrationWarning
            >
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
    )
  }
}

function SortableSection({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
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
  )
}
