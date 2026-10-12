import { ensureUrl } from "@rulisme/ui/lib/utils";
import type { CVData } from "@/components/cv-form";
import { formatOngoingEndDate, getDescriptionLines } from "./template-utils";

const WORK_TYPE_LABELS: Record<string, string> = {
  "full-time": "Full-Time",
  "part-time": "Part-Time",
  internship: "Internship",
};
const LOCATION_LABELS: Record<string, string> = {
  "work-from-office": "Work From Office",
  "work-from-anywhere": "Work From Anywhere",
  hybrid: "Hybrid",
};

export function PreviewExperienceEntry({
  entry,
  className,
  formatMonth,
}: {
  entry: CVData["experience"][number];
  className: string;
  formatMonth: (value: string) => string;
}) {
  if (!(entry.company || entry.title)) {
    return null;
  }

  return (
    <section className={className}>
      <h3 className="font-semibold text-foreground text-sm">
        {entry.title}
        {entry.title && entry.company ? " at " : ""}
        {entry.url ? (
          <a
            className="text-primary underline"
            href={ensureUrl(entry.url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {entry.company}
          </a>
        ) : (
          entry.company
        )}
      </h3>
      {(entry.startDate || entry.endDate || entry.current) && (
        <p className="text-muted-foreground text-xs">
          {[
            formatMonth(entry.startDate),
            formatOngoingEndDate(entry.endDate, entry.current, formatMonth),
          ]
            .filter(Boolean)
            .join(" – ")}
        </p>
      )}
      {(entry.workType || entry.locationPolicy) && (
        <p className="mt-1 text-muted-foreground text-xs">
          {[
            WORK_TYPE_LABELS[entry.workType],
            LOCATION_LABELS[entry.locationPolicy],
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {entry.description && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {getDescriptionLines(entry.description).map(({ key, text }) => (
            <li className="text-ink text-xs leading-relaxed" key={key}>
              {text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PreviewCertificateEntry({
  entry,
  className,
  formatMonth,
}: {
  entry: CVData["certificates"][number];
  className: string;
  formatMonth: (value: string) => string;
}) {
  if (!entry.name) {
    return null;
  }

  return (
    <section className={className}>
      <h3 className="font-semibold text-foreground text-sm">
        {entry.url ? (
          <a
            className="text-primary underline"
            href={ensureUrl(entry.url)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {entry.name}
          </a>
        ) : (
          entry.name
        )}
        {entry.name && entry.issuer ? " – " : ""}
        {entry.issuer}
      </h3>
      <p className="text-muted-foreground text-xs">
        {[
          [
            entry.date ? formatMonth(entry.date) : "",
            entry.expiryDate ? formatMonth(entry.expiryDate) : "",
          ]
            .filter(Boolean)
            .join(" – "),
          entry.credentialId ? `ID: ${entry.credentialId}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </section>
  );
}
