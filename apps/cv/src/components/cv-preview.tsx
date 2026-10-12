import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rulisme/ui/ui/empty";
import { FileText } from "lucide-react";
import type { CVData, CVStyle } from "@/components/cv-form";
import { BasicPreview } from "@/components/templates/basic-preview";
import { HarvardPreview } from "@/components/templates/harvard-preview";
import { SimplePreview } from "@/components/templates/simple-preview";
import { StandardPreview } from "@/components/templates/standard-preview";
import { useTranslation } from "@/i18n";

interface CVPreviewProps {
  data: CVData;
  style: CVStyle;
}

function TemplatePreview({ data, style }: CVPreviewProps) {
  switch (style) {
    case "harvard":
      return <HarvardPreview data={data} />;
    case "simple":
      return <SimplePreview data={data} />;
    case "standard":
      return <StandardPreview data={data} />;
    default:
      return <BasicPreview data={data} />;
  }
}

export function CVPreview({ data, style }: CVPreviewProps) {
  const { t } = useTranslation();
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
    data.volunteer.some((e) => e.organization || e.role);

  if (!hasContent) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t("preview.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("preview.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // The sheet rests on the preview's graph paper inside a 1px hairline
  // frame. The frame is screen-only: print releases it so `.cv-page` flows
  // across bare paper (styles.css @media print).
  return (
    <div className="mx-auto w-full max-w-2xl border border-border print:max-w-none print:border-0">
      <TemplatePreview data={data} style={style} />
    </div>
  );
}
