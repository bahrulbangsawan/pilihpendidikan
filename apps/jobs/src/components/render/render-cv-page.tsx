// `/render/cv/$cvvId` (08 §6.1, PLAN C8): the chrome-free page that renders
// a tailored CV to PDF in the browser and uploads it. It authenticates with
// the single-use render ticket from `?ticket=` — removed from the address bar
// with history.replaceState before anything else happens — or, for a
// signed-in visitor without one, with a ticket minted through the session.
// Headless callers (the CLI, 08 §6.3) wait for `window.__PILIH_RENDER__`:
// `{status: "done", file_id, sha256}` or `{status: "error", message}`; it
// stays undefined until the work has finished.

import { Spinner } from "@rulisme/ui/ui/spinner";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { useSession } from "@/hooks/use-session";
import { useTranslation } from "@/i18n";
import type { RenderOutcome } from "@/lib/render-cv";
import { renderCvVariantOnce } from "@/lib/render-cv";

/** What headless callers read (PLAN C8). */
export type PilihRenderResult =
  | { status: "done"; file_id: string; sha256: string }
  | { status: "error"; message: string };

declare global {
  interface Window {
    __PILIH_RENDER__?: PilihRenderResult;
  }
}

/** Reads `?ticket=` and removes it from the URL (08 §6.4). */
export function takeTicketFromUrl(): string | null {
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get("ticket");
  if (url.searchParams.has("ticket")) {
    url.searchParams.delete("ticket");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }
  return ticket;
}

export function publishRenderResult(outcome: RenderOutcome): void {
  window.__PILIH_RENDER__ =
    outcome.status === "done"
      ? { status: "done", file_id: outcome.file_id, sha256: outcome.sha256 }
      : { status: "error", message: outcome.message };
}

const NO_TICKET: RenderOutcome = {
  status: "error",
  code: "no_ticket",
  message: "No render ticket and no session.",
};

/**
 * One run per variant for the life of the page: a re-mount (StrictMode,
 * hydration) joins the run the first mount started instead of looking for
 * a ticket that is already gone from the URL. A URL with a fresh ticket
 * always starts a new run.
 */
const pageRuns = new Map<string, Promise<RenderOutcome>>();

export function startPageRender(
  cvvId: string,
  signedIn: boolean
): Promise<RenderOutcome> {
  const ticket = takeTicketFromUrl();
  const running = pageRuns.get(cvvId);
  if (running && !ticket) {
    return running;
  }
  const run =
    ticket || signedIn
      ? renderCvVariantOnce(cvvId, ticket)
      : Promise.resolve(NO_TICKET);
  pageRuns.set(cvvId, run);
  return run;
}

/** Tests only: forget the runs of earlier renders. */
export function forgetPageRenders(): void {
  pageRuns.clear();
}

export function RenderCvPage({ cvvId }: { cvvId: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const [outcome, setOutcome] = useState<RenderOutcome | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per variant; the session only decides whether a ticket may be minted.
  useEffect(() => {
    let active = true;
    startPageRender(cvvId, session.signedIn).then((result) => {
      publishRenderResult(result);
      if (active) {
        setOutcome(result);
      }
    });
    return () => {
      active = false;
    };
  }, [cvvId]);

  let icon = <Spinner aria-hidden="true" className="size-5" />;
  let title = t("render.working");
  let body = t("render.workingBody");
  if (outcome?.status === "done") {
    icon = <CircleCheck aria-hidden="true" className="size-5 text-primary" />;
    title = t("render.done");
    body = t("render.doneBody");
  } else if (outcome?.status === "error") {
    icon = (
      <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
    );
    title = t("render.failed");
    body = t(`render.errors.${outcome.code}`);
  }

  return (
    <main className="graph-paper grid min-h-dvh place-items-center px-4 py-10">
      <section
        aria-busy={outcome === null}
        aria-labelledby="render-title"
        className="flex w-full max-w-md flex-col gap-4 border border-line bg-card p-6"
      >
        <BrandMark label={t("app.name")} />
        <div className="flex items-start gap-3" role="status">
          <span className="mt-0.5">{icon}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-subtitle weight-semibold" id="render-title">
              {title}
            </h1>
            <p className="type-body text-muted-foreground">{body}</p>
            {outcome?.status === "done" ? (
              <p className="type-caption break-all text-muted-foreground tabular-nums">
                {t("render.sha", { sha: outcome.sha256.slice(0, 16) })}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
