// @vitest-environment happy-dom
import type { InboxBulkRequest } from "@pilihpendidikan/jobs-contracts/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApplication } from "@/test/fixtures";
import { makeUserJobDetail } from "@/test/fixtures-rest";
import {
  cleanup,
  fakeApi,
  press,
  renderWithQuery,
  waitFor,
} from "./inbox-test-harness";
import { TrackedJobPage } from "./tracked-job-page";

afterEach(cleanup);

describe("TW-INBOX found job page (12 §5 /jobs/$ujbId)", () => {
  it("TW-INBOX a job that is already tracked redirects (replace) to its application", async () => {
    const application = makeApplication();
    const detail = makeUserJobDetail({ application });
    fakeApi({ "GET /api/v1/user-jobs/{ujb_id}": () => detail });
    const onNavigate = vi.fn();
    renderWithQuery(
      <TrackedJobPage
        notFound={null}
        onNavigate={onNavigate}
        ujbId={detail.user_job.id}
      />
    );
    await waitFor(() => onNavigate.mock.calls.length > 0);
    expect(onNavigate).toHaveBeenCalledWith(`/applications/${application.id}`, {
      replace: true,
    });
  });

  it("TW-INBOX Track (S) tracks the job through inbox:bulk and opens the new application", async () => {
    const detail = makeUserJobDetail();
    const requests = fakeApi({
      "GET /api/v1/user-jobs/{ujb_id}": () => detail,
      "POST /api/v1/inbox:bulk": (request) => {
        const body = request.body as InboxBulkRequest;
        return {
          results: body.user_job_ids.map((id) => ({
            user_job_id: id,
            status: "ok",
            inbox_state: "tracked",
            application_id: "app_01J9ZZZZZZZZZZZZZZZZZZZZZ9",
          })),
        };
      },
    });
    const onNavigate = vi.fn();
    const { container } = renderWithQuery(
      <TrackedJobPage
        notFound={null}
        onNavigate={onNavigate}
        ujbId={detail.user_job.id}
      />
    );
    await waitFor(() => container.querySelector("h1")?.textContent);
    expect(container.querySelector("h1")?.textContent).toBe(
      detail.posting.title
    );
    const track = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Track")
    );
    expect(track?.getAttribute("aria-keyshortcuts")).toBe("S");
    expect(container.textContent).toContain("Match");
    expect(container.textContent).toContain("Provenance");
    await press("s");
    await waitFor(() => onNavigate.mock.calls.length > 0);
    expect(
      requests.find((request) => request.route === "POST /api/v1/inbox:bulk")
        ?.body
    ).toEqual({ action: "track", user_job_ids: [detail.user_job.id] });
    expect(onNavigate).toHaveBeenCalledWith(
      "/applications/app_01J9ZZZZZZZZZZZZZZZZZZZZZ9",
      { replace: true }
    );
  });
});
