import { FormField, FormFieldCustom } from "@rulisme/ui/form/form-field"
import { SectionList } from "@rulisme/ui/form/section-list"
import { Badge } from "@rulisme/ui/ui/badge"
import { Button } from "@rulisme/ui/ui/button"
import { Input } from "@rulisme/ui/ui/input"
import { Label } from "@rulisme/ui/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rulisme/ui/ui/select"
import { Trash2, Upload, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "@/i18n"
import {
  type Affiliation,
  type Collaboration,
  type ContactInfo,
  isValidImageRatio,
  LIMITS,
  MAX_PROJECTS,
  type Portfolio,
  type PortfolioOwner,
  type Project,
  type ProjectType,
  RECOMMENDED_IMAGE_SIZE,
  SUBMISSION_TARGET,
  type Track,
} from "@/components/portfolio-data-model"

// Owner-side affiliation/track/collaboration option lists. Concrete values
// only (no empty option) — every list maps onto a required discriminant.
const TRACK_OPTIONS: { value: Track; labelKey: string }[] = [
  { value: "tech", labelKey: "options.track.tech" },
  { value: "design", labelKey: "options.track.design" },
  { value: "domain", labelKey: "options.track.domain" },
]

const AFFILIATION_OPTIONS: { value: Affiliation["kind"]; labelKey: string }[] =
  [
    { value: "student", labelKey: "options.affiliation.student" },
    { value: "alumni", labelKey: "options.affiliation.alumni" },
    { value: "professional", labelKey: "options.affiliation.professional" },
    { value: "independent", labelKey: "options.affiliation.independent" },
  ]

const PROJECT_TYPE_OPTIONS: { value: ProjectType; labelKey: string }[] = [
  { value: "self-initiated", labelKey: "options.projectType.selfInitiated" },
  {
    value: "class-assignment",
    labelKey: "options.projectType.classAssignment",
  },
  { value: "work-assignment", labelKey: "options.projectType.workAssignment" },
]

const COLLABORATION_OPTIONS: {
  value: Collaboration["kind"]
  labelKey: string
}[] = [
  { value: "individual", labelKey: "options.collaboration.individual" },
  { value: "group", labelKey: "options.collaboration.group" },
]

// Reject oversized uploads before decoding. 1920×1080 PNG/JPEG comfortably
// fits under this; the ratio guard (16:9) is the real gate.
const MAX_IMAGE_MB = 5
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024

// ── Factories ──────────────────────────────────────────────

export function makeEmptyProject(order: number): Project {
  return {
    id: crypto.randomUUID(),
    order,
    title: "",
    yearAccomplished: new Date().getFullYear(),
    role: "",
    summary: "",
    description: "",
    projectType: "self-initiated",
    collaboration: { kind: "individual" },
    impact: "",
    learnings: "",
    scopeOfWork: [],
    track: "tech",
    technologies: [],
    skills: [],
    media: [],
  }
}

export function makeEmptyPortfolio(): Portfolio {
  return {
    owner: {
      fullName: "",
      headline: "",
      affiliation: { kind: "student", institution: "", program: "" },
      contact: { email: "", phone: "", websiteUrl: "", socials: [] },
      track: "tech",
    },
    submissionTarget: SUBMISSION_TARGET,
    cohortYear: 2025,
    projects: [],
    updatedAt: "",
  }
}

// Truncate to a hard character cap (the LIMITS clamp). Enforced at the input
// boundary so a field can never exceed its slot in the locked layout.
function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

// ── Reusable chip field (scope of work / technologies / skills) ───

function ChipField({
  label,
  hint,
  items,
  max,
  maxChars,
  placeholder,
  fullLabel,
  onAdd,
  onRemove,
}: {
  label: string
  hint?: string
  items: string[]
  max: number
  maxChars: number
  placeholder: string
  fullLabel: string
  onAdd: (value: string) => void
  onRemove: (value: string) => void
}) {
  const [draft, setDraft] = useState("")
  const full = items.length >= max

  function commit() {
    const value = draft.trim().slice(0, maxChars)
    if (value && !items.includes(value) && !full) {
      onAdd(value)
      setDraft("")
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="shrink-0 text-micro text-muted-foreground">
          {items.length}/{max}
        </span>
      </div>
      <Input
        disabled={full}
        maxLength={maxChars}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={full ? fullLabel : placeholder}
        value={draft}
      />
      {hint && !full && (
        <p className="text-micro text-muted-foreground">{hint}</p>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge
              className="cursor-pointer"
              key={item}
              onClick={() => onRemove(item)}
              variant="secondary"
            >
              {item}
              <X className="size-2.5" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

interface PortfolioFormProps {
  data: Portfolio
  onChange: (data: Portfolio) => void
}

export function PortfolioForm({ data, onChange }: PortfolioFormProps) {
  const { t } = useTranslation()
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})

  const { owner } = data
  const { affiliation, contact } = owner

  function setImageError(projectId: string, message: string | undefined) {
    setImageErrors((prev) => {
      if (message) {
        return { ...prev, [projectId]: message }
      }
      if (!(projectId in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[projectId]
      return next
    })
  }

  // ── Owner mutations ──────────────────────────────────────
  function updateOwner(patch: Partial<PortfolioOwner>) {
    onChange({ ...data, owner: { ...owner, ...patch } })
  }

  function updateContact(patch: Partial<ContactInfo>) {
    updateOwner({ contact: { ...contact, ...patch } })
  }

  function changeAffiliationKind(kind: Affiliation["kind"]) {
    let next: Affiliation
    switch (kind) {
      case "student":
        next = { kind, institution: "", program: "" }
        break
      case "alumni":
        next = { kind, institution: "", program: "" }
        break
      case "professional":
        next = { kind, organization: "", jobTitle: "" }
        break
      default:
        next = { kind: "independent", note: "" }
    }
    updateOwner({ affiliation: next })
  }

  // ── Socials ──────────────────────────────────────────────
  const socials = contact.socials ?? []

  function addSocial() {
    updateContact({ socials: [...socials, { label: "", url: "" }] })
  }

  function updateSocial(
    index: number,
    patch: Partial<{ label: string; url: string }>
  ) {
    updateContact({
      socials: socials.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    })
  }

  function removeSocial(index: number) {
    updateContact({ socials: socials.filter((_, i) => i !== index) })
  }

  // ── Project mutations ────────────────────────────────────
  function addProject() {
    if (data.projects.length >= MAX_PROJECTS) {
      return
    }
    onChange({
      ...data,
      projects: [...data.projects, makeEmptyProject(data.projects.length + 1)],
    })
  }

  function removeProject(id: string) {
    onChange({
      ...data,
      projects: data.projects
        .filter((p) => p.id !== id)
        .map((p, i) => ({ ...p, order: i + 1 })),
    })
    setImageError(id, undefined)
  }

  function reorderProjects(items: Project[]) {
    onChange({
      ...data,
      projects: items.map((p, i) => ({ ...p, order: i + 1 })),
    })
  }

  function updateProject(id: string, patch: Partial<Project>) {
    onChange({
      ...data,
      projects: data.projects.map((p) =>
        p.id === id ? { ...p, ...patch } : p
      ),
    })
  }

  function changeCollaborationKind(id: string, kind: Collaboration["kind"]) {
    const next: Collaboration =
      kind === "group"
        ? { kind, role: "", teamSize: undefined }
        : { kind: "individual" }
    updateProject(id, { collaboration: next })
  }

  // ── Image upload (strict 16:9 guard) ─────────────────────
  function handleImageUpload(project: Project, file: File | undefined) {
    if (!file) {
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(project.id, t("errors.maxFileSize", { mb: MAX_IMAGE_MB }))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img
        if (!isValidImageRatio(w, h)) {
          setImageError(
            project.id,
            t("errors.imageRatio", {
              w: RECOMMENDED_IMAGE_SIZE.width,
              h: RECOMMENDED_IMAGE_SIZE.height,
            })
          )
          return
        }
        setImageError(project.id, undefined)
        const existing = project.media[0]
        updateProject(project.id, {
          media: [
            {
              type: "image",
              url: dataUrl,
              alt: existing?.alt ?? "",
              caption: existing?.caption,
              width: w,
              height: h,
            },
          ],
        })
      }
      img.onerror = () => setImageError(project.id, t("errors.imageDecode"))
      img.src = dataUrl
    }
    reader.onerror = () => setImageError(project.id, t("errors.imageDecode"))
    reader.readAsDataURL(file)
  }

  function updateMediaField(
    project: Project,
    patch: Partial<{ alt: string; caption: string }>
  ) {
    const existing = project.media[0]
    if (!existing) {
      return
    }
    updateProject(project.id, { media: [{ ...existing, ...patch }] })
  }

  function removeMedia(project: Project) {
    updateProject(project.id, { media: [] })
    setImageError(project.id, undefined)
  }

  // ── Renderers ────────────────────────────────────────────
  function renderAffiliationFields() {
    if (affiliation.kind === "student" || affiliation.kind === "alumni") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.institution")}
            onChange={(v) =>
              updateOwner({
                affiliation: {
                  ...affiliation,
                  institution: clamp(v, LIMITS.owner.institution),
                },
              })
            }
            placeholder={t("placeholders.institution")}
            value={affiliation.institution}
          />
          <FormField
            label={t("form.program")}
            onChange={(v) =>
              updateOwner({
                affiliation: {
                  ...affiliation,
                  program: clamp(v, LIMITS.owner.program),
                },
              })
            }
            placeholder={t("placeholders.program")}
            value={affiliation.program ?? ""}
          />
          {affiliation.kind === "student" ? (
            <FormField
              label={t("form.semester")}
              numeric
              onChange={(v) =>
                updateOwner({
                  affiliation: {
                    ...affiliation,
                    semester: v ? Number(v.slice(0, 2)) : undefined,
                  },
                })
              }
              placeholder={t("placeholders.semester")}
              value={affiliation.semester ? String(affiliation.semester) : ""}
            />
          ) : (
            <FormField
              label={t("form.graduationYear")}
              numeric
              onChange={(v) =>
                updateOwner({
                  affiliation: {
                    ...affiliation,
                    graduationYear: v ? Number(v.slice(0, 4)) : undefined,
                  },
                })
              }
              placeholder={t("placeholders.graduationYear")}
              value={
                affiliation.graduationYear
                  ? String(affiliation.graduationYear)
                  : ""
              }
            />
          )}
        </div>
      )
    }

    if (affiliation.kind === "professional") {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.organization")}
            onChange={(v) =>
              updateOwner({
                affiliation: {
                  ...affiliation,
                  organization: clamp(v, LIMITS.owner.organization),
                },
              })
            }
            placeholder={t("placeholders.organization")}
            value={affiliation.organization ?? ""}
          />
          <FormField
            label={t("form.jobTitle")}
            onChange={(v) =>
              updateOwner({
                affiliation: {
                  ...affiliation,
                  jobTitle: clamp(v, LIMITS.owner.jobTitle),
                },
              })
            }
            placeholder={t("placeholders.jobTitle")}
            value={affiliation.jobTitle ?? ""}
          />
          <FormField
            label={t("form.yearsExperience")}
            numeric
            onChange={(v) =>
              updateOwner({
                affiliation: {
                  ...affiliation,
                  yearsExperience: v ? Number(v.slice(0, 2)) : undefined,
                },
              })
            }
            placeholder={t("placeholders.yearsExperience")}
            value={
              affiliation.yearsExperience
                ? String(affiliation.yearsExperience)
                : ""
            }
          />
        </div>
      )
    }

    return (
      <FormField
        label={t("form.note")}
        onChange={(v) =>
          updateOwner({
            affiliation: {
              kind: "independent",
              note: clamp(v, LIMITS.owner.note),
            },
          })
        }
        placeholder={t("placeholders.note")}
        value={affiliation.note ?? ""}
      />
    )
  }

  function renderProjectContent(project: Project) {
    const media = project.media[0]
    const sow = project.scopeOfWork ?? []
    const tech = project.technologies ?? []
    const skills = project.skills ?? []
    return (
      <div className="space-y-3">
        <FormField
          label={t("form.projectTitle")}
          onChange={(v) =>
            updateProject(project.id, { title: clamp(v, LIMITS.project.title) })
          }
          placeholder={t("placeholders.projectTitle")}
          value={project.title}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.yearAccomplished")}
            numeric
            onChange={(v) =>
              updateProject(project.id, {
                yearAccomplished: v ? Number(v.slice(0, 4)) : 0,
              })
            }
            placeholder={t("placeholders.yearAccomplished")}
            value={
              project.yearAccomplished ? String(project.yearAccomplished) : ""
            }
          />
          <FormField
            label={t("form.role")}
            onChange={(v) =>
              updateProject(project.id, { role: clamp(v, LIMITS.project.role) })
            }
            placeholder={t("placeholders.role")}
            value={project.role}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormFieldCustom label={t("form.projectType")}>
            <Select
              onValueChange={(v) =>
                updateProject(project.id, { projectType: v as ProjectType })
              }
              value={project.projectType}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormFieldCustom>
          <FormFieldCustom label={t("form.track")}>
            <Select
              onValueChange={(v) =>
                updateProject(project.id, { track: v as Track })
              }
              value={project.track ?? "tech"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRACK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormFieldCustom>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormFieldCustom label={t("form.collaboration")}>
            <Select
              onValueChange={(v) =>
                changeCollaborationKind(project.id, v as Collaboration["kind"])
              }
              value={project.collaboration.kind}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLABORATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormFieldCustom>
          {project.collaboration.kind === "group" && (
            <FormField
              label={t("form.teamSize")}
              numeric
              onChange={(v) =>
                updateProject(project.id, {
                  collaboration: {
                    kind: "group",
                    role:
                      project.collaboration.kind === "group"
                        ? project.collaboration.role
                        : "",
                    teamSize: v ? Number(v.slice(0, 3)) : undefined,
                  },
                })
              }
              placeholder={t("placeholders.teamSize")}
              value={
                project.collaboration.teamSize
                  ? String(project.collaboration.teamSize)
                  : ""
              }
            />
          )}
        </div>
        {project.collaboration.kind === "group" && (
          <FormField
            label={t("form.groupRole")}
            onChange={(v) =>
              updateProject(project.id, {
                collaboration: {
                  kind: "group",
                  teamSize:
                    project.collaboration.kind === "group"
                      ? project.collaboration.teamSize
                      : undefined,
                  role: clamp(v, LIMITS.project.role),
                },
              })
            }
            placeholder={t("placeholders.groupRole")}
            value={
              project.collaboration.kind === "group"
                ? project.collaboration.role
                : ""
            }
          />
        )}
        <FormField
          label={t("form.summary")}
          multiline
          onChange={(v) =>
            updateProject(project.id, {
              summary: clamp(v, LIMITS.project.summary),
            })
          }
          placeholder={t("placeholders.summary")}
          rows={2}
          value={project.summary}
        />
        <FormField
          label={t("form.description")}
          multiline
          onChange={(v) =>
            updateProject(project.id, {
              description: clamp(v, LIMITS.project.description),
            })
          }
          placeholder={t("placeholders.description")}
          rows={3}
          value={project.description}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.impact")}
            multiline
            onChange={(v) =>
              updateProject(project.id, {
                impact: clamp(v, LIMITS.project.impact),
              })
            }
            placeholder={t("placeholders.impact")}
            rows={3}
            value={project.impact}
          />
          <FormField
            label={t("form.learnings")}
            multiline
            onChange={(v) =>
              updateProject(project.id, {
                learnings: clamp(v, LIMITS.project.learnings),
              })
            }
            placeholder={t("placeholders.learnings")}
            rows={3}
            value={project.learnings}
          />
        </div>
        <ChipField
          fullLabel={t("form.chipFull")}
          items={sow}
          label={t("form.scopeOfWork")}
          max={LIMITS.project.scopeOfWork.maxItems}
          maxChars={LIMITS.project.scopeOfWork.maxCharsPerItem}
          onAdd={(v) => updateProject(project.id, { scopeOfWork: [...sow, v] })}
          onRemove={(v) =>
            updateProject(project.id, {
              scopeOfWork: sow.filter((s) => s !== v),
            })
          }
          placeholder={t("placeholders.scopeOfWork")}
        />
        <ChipField
          fullLabel={t("form.chipFull")}
          items={tech}
          label={t("form.technologies")}
          max={LIMITS.project.technologies.maxItems}
          maxChars={LIMITS.project.technologies.maxCharsPerItem}
          onAdd={(v) =>
            updateProject(project.id, { technologies: [...tech, v] })
          }
          onRemove={(v) =>
            updateProject(project.id, {
              technologies: tech.filter((s) => s !== v),
            })
          }
          placeholder={t("placeholders.technologies")}
        />
        <ChipField
          fullLabel={t("form.chipFull")}
          items={skills}
          label={t("form.disciplines")}
          max={LIMITS.project.skills.maxItems}
          maxChars={LIMITS.project.skills.maxCharsPerItem}
          onAdd={(v) => updateProject(project.id, { skills: [...skills, v] })}
          onRemove={(v) =>
            updateProject(project.id, {
              skills: skills.filter((s) => s !== v),
            })
          }
          placeholder={t("placeholders.disciplines")}
        />
        <FormField
          label={t("form.publicationUrl")}
          onChange={(v) =>
            updateProject(project.id, {
              publicationUrl: clamp(v, LIMITS.project.publicationUrl),
            })
          }
          placeholder={t("placeholders.url")}
          value={project.publicationUrl ?? ""}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.repositoryUrl")}
            onChange={(v) =>
              updateProject(project.id, {
                repositoryUrl: clamp(v, LIMITS.project.publicationUrl),
              })
            }
            placeholder={t("placeholders.url")}
            value={project.repositoryUrl ?? ""}
          />
          <FormField
            label={t("form.documentationUrl")}
            onChange={(v) =>
              updateProject(project.id, {
                documentationUrl: clamp(v, LIMITS.project.publicationUrl),
              })
            }
            placeholder={t("placeholders.url")}
            value={project.documentationUrl ?? ""}
          />
        </div>

        {/* Project image — strict 16:9 slot */}
        <div className="space-y-2">
          <Label>{t("form.projectImage")}</Label>
          {media ? (
            <div className="space-y-2">
              <img
                alt={media.alt || t("form.projectImage")}
                className="aspect-video w-full rounded-lg border border-border object-cover"
                src={media.url}
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => removeMedia(project)}
                  size="sm"
                  variant="outline"
                >
                  <Trash2 className="size-3" /> {t("form.remove")}
                </Button>
                <span className="text-micro text-muted-foreground">
                  {media.width}×{media.height}
                </span>
              </div>
              <FormField
                label={t("form.imageAlt")}
                onChange={(v) =>
                  updateMediaField(project, { alt: clamp(v, LIMITS.media.alt) })
                }
                placeholder={t("placeholders.imageAlt")}
                value={media.alt}
              />
              <FormField
                label={t("form.imageCaption")}
                onChange={(v) =>
                  updateMediaField(project, {
                    caption: clamp(v, LIMITS.media.caption),
                  })
                }
                placeholder={t("placeholders.imageCaption")}
                value={media.caption ?? ""}
              />
            </div>
          ) : (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-base text-muted-foreground hover:border-foreground/30 md:min-h-0 md:text-sm">
              <Upload className="size-4" />
              {t("form.uploadImage")}
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label={t("form.uploadImage")}
                className="hidden"
                onChange={(e) => {
                  handleImageUpload(project, e.target.files?.[0])
                  e.target.value = ""
                }}
                type="file"
              />
            </label>
          )}
          <p className="text-micro text-muted-foreground">
            {t("form.imageHint", {
              w: RECOMMENDED_IMAGE_SIZE.width,
              h: RECOMMENDED_IMAGE_SIZE.height,
            })}
          </p>
          {imageErrors[project.id] && (
            <p className="text-xs text-destructive">
              {imageErrors[project.id]}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Profile ── */}
      <section className="space-y-3">
        <h2 className="text-base font-medium md:text-sm">
          {t("form.profile")}
        </h2>
        <FormField
          label={t("form.fullName")}
          onChange={(v) =>
            updateOwner({ fullName: clamp(v, LIMITS.owner.fullName) })
          }
          placeholder={t("placeholders.fullName")}
          value={owner.fullName}
        />
        <FormField
          label={t("form.headline")}
          onChange={(v) =>
            updateOwner({ headline: clamp(v, LIMITS.owner.headline) })
          }
          placeholder={t("placeholders.headline")}
          value={owner.headline ?? ""}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormFieldCustom label={t("form.track")}>
            <Select
              onValueChange={(v) => updateOwner({ track: v as Track })}
              value={owner.track}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRACK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormFieldCustom>
          <FormFieldCustom label={t("form.affiliation")}>
            <Select
              onValueChange={(v) =>
                changeAffiliationKind(v as Affiliation["kind"])
              }
              value={affiliation.kind}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AFFILIATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormFieldCustom>
        </div>
        {renderAffiliationFields()}
      </section>

      {/* ── Contact ── */}
      <section className="space-y-3">
        <h2 className="text-base font-medium md:text-sm">
          {t("form.contact")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.email")}
            onChange={(v) =>
              updateContact({ email: clamp(v, LIMITS.contact.email) })
            }
            placeholder={t("placeholders.email")}
            type="email"
            value={contact.email}
          />
          <FormField
            label={t("form.phone")}
            onChange={(v) =>
              updateContact({ phone: clamp(v, LIMITS.contact.phone) })
            }
            placeholder={t("placeholders.phone")}
            value={contact.phone ?? ""}
          />
        </div>
        <FormField
          label={t("form.websiteUrl")}
          onChange={(v) =>
            updateContact({ websiteUrl: clamp(v, LIMITS.contact.websiteUrl) })
          }
          placeholder={t("placeholders.url")}
          value={contact.websiteUrl ?? ""}
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("form.socials")}</Label>
            <span className="text-micro text-muted-foreground">
              {socials.length}
            </span>
          </div>
          {socials.map((social, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: socials are controlled rows with no local state; index keying is safe
            <div className="flex items-end gap-2" key={index}>
              <div className="w-28 shrink-0">
                <Input
                  aria-label={t("form.socialLabel")}
                  maxLength={LIMITS.contact.socialLabel}
                  onChange={(e) =>
                    updateSocial(index, {
                      label: clamp(e.target.value, LIMITS.contact.socialLabel),
                    })
                  }
                  placeholder={t("placeholders.socialLabel")}
                  value={social.label}
                />
              </div>
              <Input
                aria-label={t("form.socialUrl")}
                maxLength={LIMITS.contact.socialUrl}
                onChange={(e) =>
                  updateSocial(index, {
                    url: clamp(e.target.value, LIMITS.contact.socialUrl),
                  })
                }
                placeholder={t("placeholders.url")}
                value={social.url}
              />
              <Button
                aria-label={t("form.remove")}
                onClick={() => removeSocial(index)}
                size="icon"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button onClick={addSocial} size="sm" variant="outline">
            {t("form.addSocial")}
          </Button>
        </div>
      </section>

      {/* ── Submission ── */}
      <section className="space-y-3">
        <h2 className="text-base font-medium md:text-sm">
          {t("form.submission")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label={t("form.submissionTarget")}
            onChange={(v) => onChange({ ...data, submissionTarget: v })}
            placeholder={t("placeholders.submissionTarget")}
            value={data.submissionTarget ?? ""}
          />
          <FormField
            label={t("form.cohortYear")}
            numeric
            onChange={(v) =>
              onChange({
                ...data,
                cohortYear: v ? Number(v.slice(0, 4)) : undefined,
              })
            }
            placeholder={t("placeholders.cohortYear")}
            value={data.cohortYear ? String(data.cohortYear) : ""}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("form.trackHint")}</p>
      </section>

      {/* ── Projects (max 5) ── */}
      <SectionList<Project>
        addLabel={
          data.projects.length >= MAX_PROJECTS
            ? t("form.maxProjects", { max: MAX_PROJECTS })
            : t("form.addProject")
        }
        hasError={(p) => Boolean(imageErrors[p.id])}
        items={data.projects}
        onAdd={addProject}
        onRemove={removeProject}
        onReorder={reorderProjects}
        onTitleChange={() => undefined}
        placeholder={t("form.projects")}
        renderContent={renderProjectContent}
        summary={(project, index) =>
          project.title || t("form.projectFallback", { index: index + 1 })
        }
        title={t("form.projects")}
        titleExtra={
          <span className="shrink-0 text-xs text-muted-foreground">
            {data.projects.length}/{MAX_PROJECTS}
          </span>
        }
      />
    </div>
  )
}
