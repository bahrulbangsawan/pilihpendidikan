// The import status strip (12 §4): shown only when a discovery run finished
// in the last 24 h — "Run on MacBook · 14:02 · 312 found · 48 new · 12
// updated · 3 invalid · 1 source blocked (Workday: access denied)" — with a
// link to the runs. While a run is going, it says so (the inbox then polls).

import type { DiscoveryRunRecord } from "@pilihpendidikan/jobs-contracts/records";
import { Button } from "@rulisme/ui/ui/button";
import { LoaderCircle, Radar } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "@/i18n";
import { formatClock, formatNumber } from "@/lib/format";
import { blockedSources } from "@/lib/inbox-state";
import { discoveryErrorLabel } from "@/lib/labels";

export function ImportStrip({
  run,
  activeRun,
  deviceName,
  onNavigate,
}: {
  /** The newest run that finished in the last 24 h. */
  run: DiscoveryRunRecord | null;
  /** A run still going on some device. */
  activeRun: DiscoveryRunRecord | null;
  deviceName: (deviceId: string) => string | null;
  onNavigate: (href: string, event?: MouseEvent) => void;
}) {
  const { locale, t } = useTranslation();
  if (!(run || activeRun)) {
    return null;
  }
  const parts: string[] = [];
  if (run) {
    const stats = run.stats;
    parts.push(
      t("inbox.strip.run", {
        device: deviceName(run.device_id) ?? t("inbox.strip.unknownDevice"),
        time: formatClock(run.finished_at ?? run.started_at, locale),
      })
    );
    const counted: [string, number | undefined][] = [
      ["inbox.strip.found", stats.postings_found],
      ["inbox.strip.new", stats.new],
      ["inbox.strip.updated", stats.updated],
      ["inbox.strip.invalid", stats.invalid],
    ];
    for (const [key, value] of counted) {
      if (value !== undefined && (value > 0 || key === "inbox.strip.found")) {
        parts.push(t(key, { count: formatNumber(value, locale) }));
      }
    }
    const blocked = blockedSources(run);
    if (blocked.length > 0) {
      parts.push(
        t("inbox.strip.blocked", {
          count: blocked.length,
          list: blocked
            .map(
              (entry) =>
                `${entry.label}: ${discoveryErrorLabel(t, entry.errorClass).toLowerCase()}`
            )
            .join(", "),
        })
      );
    }
  }
  return (
    <section
      aria-label={t("inbox.strip.label")}
      className="band flex flex-wrap items-center gap-x-3 gap-y-1 bg-pane/30 px-4 py-1.5 sm:px-5"
    >
      {activeRun ? (
        <p className="type-caption inline-flex items-center gap-1.5 text-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5" />
          {t("inbox.strip.running", {
            device:
              deviceName(activeRun.device_id) ?? t("inbox.strip.unknownDevice"),
          })}
        </p>
      ) : null}
      {run ? (
        <p className="type-caption inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Radar aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0">{parts.join(" · ")}</span>
        </p>
      ) : null}
      <Button asChild className="ml-auto" size="xs" variant="ghost">
        <a href="/sources" onClick={(event) => onNavigate("/sources", event)}>
          {t("inbox.strip.open")}
        </a>
      </Button>
    </section>
  );
}
