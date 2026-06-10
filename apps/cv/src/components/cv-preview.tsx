import type { CVData, CVStyle } from "@/components/cv-form"
import { BasicPreview } from "@/components/templates/basic-preview"
import { HarvardPreview } from "@/components/templates/harvard-preview"
import { SimplePreview } from "@/components/templates/simple-preview"
import { StandardPreview } from "@/components/templates/standard-preview"

interface CVPreviewProps {
  data: CVData
  style: CVStyle
}

export function CVPreview({ data, style }: CVPreviewProps) {
  const hasContent =
    data.personalInfo.fullName ||
    data.summary ||
    data.experience.some((e) => e.company || e.title) ||
    data.education.some((e) => e.institution || e.degree) ||
    data.skills.some((c) => c.items.length > 0) ||
    data.awards.some((e) => e.title) ||
    data.certificates.some((e) => e.name) ||
    data.languages.some((e) => e.language) ||
    data.projects.some((e) => e.name) ||
    data.volunteer.some((e) => e.organization || e.role)

  if (!hasContent) {
    return (
      <p className="py-20 text-center text-sm text-muted-foreground">
        Start filling in the form to see your CV preview
      </p>
    )
  }

  switch (style) {
    case "harvard":
      return <HarvardPreview data={data} />
    case "simple":
      return <SimplePreview data={data} />
    case "standard":
      return <StandardPreview data={data} />
    default:
      return <BasicPreview data={data} />
  }
}
