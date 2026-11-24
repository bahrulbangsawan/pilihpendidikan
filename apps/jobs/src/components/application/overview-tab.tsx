// Overview (12 §5.1): the posting description as plain text (72ch), the
// requirements and salary, and the user's own email to the employer
// (composer + drafts, 09) — each in a card. Notes have their own tab.

import { SectionCard } from "@rulisme/ui/blocks/settings";
import type { ApplicationDetail } from "@pilihpendidikan/jobs-contracts/api";
import { PlainText } from "@/components/rich-text";
import { useTranslation } from "@/i18n";
import { formatMoney } from "@/lib/format";
import { EmailApply } from "./email-apply";

function salaryText(
  detail: ApplicationDetail,
  locale: "en" | "id",
  t: (key: string) => string
): string | null {
  const salary = detail.posting.salary;
  if (!salary) {
    return null;
  }
  if (salary.min !== undefined || salary.max !== undefined) {
    const range = [salary.min, salary.max]
      .filter((value): value is number => value !== undefined)
      .map((value) => formatMoney(value, salary.currency, locale))
      .join(" – ");
    return salary.period
      ? `${range} ${t(`salaryPeriods.${salary.period}`)}`
      : range;
  }
  return salary.raw ?? null;
}

export function OverviewTab({ detail }: { detail: ApplicationDetail }) {
  const { locale, t } = useTranslation();
  const { posting } = detail;
  const salary = salaryText(detail, locale, t);
  return (
    <div className="flex flex-col gap-4">
      <SectionCard id="description-heading" title={t("detail.description")}>
        {posting.description_text ? (
          <PlainText
            className="type-body max-w-[72ch]"
            text={posting.description_text}
          />
        ) : (
          <p className="type-body text-muted-foreground">
            {t("detail.noDescription")}
          </p>
        )}
        {posting.description_truncated ? (
          <p className="type-caption text-muted-foreground">
            {t("detail.truncated")}
          </p>
        ) : null}
      </SectionCard>
      {posting.requirements.length > 0 || salary ? (
        <div className="grid gap-4 md:grid-cols-2">
          {posting.requirements.length > 0 ? (
            <SectionCard
              id="requirements-heading"
              title={t("detail.requirements")}
            >
              <ul className="type-body flex list-disc flex-col gap-1 pl-5">
                {posting.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
          {salary ? (
            <SectionCard id="salary-heading" title={t("detail.salary")}>
              <p className="type-body">{salary}</p>
            </SectionCard>
          ) : null}
        </div>
      ) : null}
      <SectionCard id="email-heading" title={t("application.emailHeading")}>
        <EmailApply detail={detail} />
      </SectionCard>
    </div>
  );
}
