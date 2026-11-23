import type { ReactNode } from "react";
import type { Services } from "@/config/services";
import { HubFooter } from "./hub-footer";
import { HubHeader } from "./hub-header";

// The page the crawler's User-Agent points to:
// `pilih-jobs/<version> (+https://pilihpendidikan.com/bot)`. It explains who
// fetches, what is fetched, the rules the crawler keeps and how a site owner
// opts out (job-tracker-spec/15 §7.1, 24 §8). English only: it is written for
// site operators reading their access logs.

/** One part of the article: a 22px heading over 16px prose. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12 flex flex-col gap-4">
      <h2 className="type-title">{title}</h2>
      <div className="type-subtitle flex flex-col gap-4 text-pretty">
        {children}
      </div>
    </section>
  );
}

/** A cursor.com docs article: 704px of 16px prose under a 36px title. */
export function BotPage(_props: { services: Services }) {
  return (
    <div className="flex min-h-dvh flex-col pt-[52px]">
      <HubHeader />
      <main className="flex-1 px-5 pt-[112px] pb-[134.4px]">
        <article className="mx-auto w-full max-w-[704px]">
          <header className="flex flex-col gap-6">
            <h1 className="type-headline-compact sm:type-headline">
              The pilih-jobs crawler
            </h1>
            <p className="type-subtitle text-pretty">
              Requests with the User-Agent <code>pilih-jobs/…</code> come from
              the pilihpendidikan Job Tracker. It reads public job listings so
              job seekers can track vacancies in one place.
            </p>
          </header>
          <Section title="What it fetches">
            <p>
              Public job boards and career pages: official job APIs and RSS
              feeds first, then pages with schema.org <code>JobPosting</code>{" "}
              data, then plain listing pages. It runs either on a job
              seeker&apos;s own computer (the pilih-jobs command-line tool) or
              on our servers for a short list of remote-job boards, at most a
              few requests per board per hour.
            </p>
          </Section>
          <Section title="The rules it keeps">
            <ul className="flex list-disc flex-col gap-2 pl-5">
              <li>It always obeys robots.txt, including Crawl-delay.</li>
              <li>
                It identifies itself honestly and never impersonates a browser,
                rotates proxies or fakes a referer.
              </li>
              <li>
                It never solves CAPTCHAs or bot challenges, never logs in, and
                stops at the first access-denied or rate-limit answer.
              </li>
              <li>
                It waits at least one second between requests to a site and
                keeps one or two requests in flight per site.
              </li>
              <li>
                It does not crawl platforms whose terms forbid automated access.
              </li>
            </ul>
          </Section>
          <Section title="Opting out">
            <p>
              Add this to your robots.txt and the crawler stops on its next
              visit:
            </p>
            <pre className="type-body overflow-x-auto rounded-sm border border-hairline bg-card p-4">
              {"User-agent: pilih-jobs\nDisallow: /"}
            </pre>
            <p>
              For anything else, contact the maintainer through{" "}
              <a
                className="text-link transition-colors duration-140 ease-standard hover:text-link/75"
                href="https://bahrul.me"
                rel="noopener"
                target="_blank"
              >
                bahrul.me
              </a>
              .
            </p>
          </Section>
        </article>
      </main>
      <HubFooter />
    </div>
  );
}
