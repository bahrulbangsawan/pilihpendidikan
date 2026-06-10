import type { CVData, CVStyle } from "@/components/cv-form"
import { CVDocument as BasicDocument } from "@/components/templates/basic-pdf"
import { CVDocument as HarvardDocument } from "@/components/templates/harvard-pdf"
import { CVDocument as SimpleDocument } from "@/components/templates/simple-pdf"
import { CVDocument as StandardDocument } from "@/components/templates/standard-pdf"

export function CVDocument({ data, style }: { data: CVData; style: CVStyle }) {
  switch (style) {
    case "harvard":
      return <HarvardDocument data={data} />
    case "simple":
      return <SimpleDocument data={data} />
    case "standard":
      return <StandardDocument data={data} />
    default:
      return <BasicDocument data={data} />
  }
}
