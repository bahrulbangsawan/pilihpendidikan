// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest } from "@/lib/bff";
import { suggestFollowUp } from "@/lib/follow-up";
import {
  DAY,
  makeApplication,
  makeInterview,
  makeOffer,
  NOW,
} from "@/test/fixtures";
import { byText, click, render } from "@/test/render";
import { FollowUpCard } from "./follow-up-card";

afterEach(() => {
  setBffTransport(null);
  document.body.replaceChildren();
});

describe("T6-17 follow-up suggestions (06 §7)", () => {
  it("T6-17 suggests 7 days after applying, 3 after an interview, 48 h before an offer deadline", () => {
    const applied = makeApplication({
      stage: "applied",
      submitted_at: NOW - DAY,
      stage_changed_at: NOW - DAY,
    });
    expect(
      suggestFollowUp({ application: applied, interviews: [], offers: [] }, NOW)
    ).toEqual({
      reason: "after_applied",
      basis: NOW - DAY,
      at: NOW + 6 * DAY,
    });
    const interview = makeInterview(applied.id, { scheduled_at: NOW - DAY });
    expect(
      suggestFollowUp(
        { application: applied, interviews: [interview], offers: [] },
        NOW
      )
    ).toMatchObject({
      reason: "after_interview",
      at: NOW + 2 * DAY,
    });
    const offer = makeOffer(applied.id, { deadline_at: NOW + 5 * DAY });
    expect(
      suggestFollowUp(
        { application: applied, interviews: [interview], offers: [offer] },
        NOW
      )
    ).toMatchObject({
      reason: "offer_deadline",
      at: NOW + 3 * DAY,
    });
  });

  it("T6-17 suggests nothing once a follow-up is set or the application is closed", () => {
    const set = makeApplication({
      stage: "applied",
      follow_up_at: NOW + DAY,
      submitted_at: NOW - DAY,
    });
    expect(
      suggestFollowUp({ application: set, interviews: [], offers: [] }, NOW)
    ).toBeNull();
    const closed = makeApplication({
      stage: "rejected",
      submitted_at: NOW - DAY,
    });
    expect(
      suggestFollowUp({ application: closed, interviews: [], offers: [] }, NOW)
    ).toBeNull();
  });

  it("T6-17 rendering a suggestion never writes follow_up_at; only Accept does", async () => {
    const requests: BffRequest[] = [];
    setBffTransport((request) => {
      requests.push(request);
      return Promise.resolve({
        ok: true,
        status: 200,
        data: null,
        etag: null,
        notModified: false,
        replayed: false,
      });
    });
    const onAccept = vi.fn(async () => undefined);
    const application = makeApplication({
      stage: "applied",
      submitted_at: NOW - DAY,
      stage_changed_at: NOW - DAY,
    });
    const view = render(
      <FollowUpCard
        detail={{ application, interviews: [], offers: [] }}
        nowMs={NOW}
        onAccept={onAccept}
        onEdit={() => undefined}
      />
    );
    expect(
      view.container.querySelector("[data-testid=follow-up-suggestion]")
    ).not.toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
    expect(requests).toEqual([]);

    await click(byText(view.container, "Dismiss"));
    expect(onAccept).not.toHaveBeenCalled();
    expect(
      view.container.querySelector("[data-testid=follow-up-suggestion]")
    ).toBeNull();
    view.unmount();

    const again = render(
      <FollowUpCard
        detail={{ application, interviews: [], offers: [] }}
        nowMs={NOW}
        onAccept={onAccept}
        onEdit={() => undefined}
      />
    );
    await click(byText(again.container, "Accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith({ follow_up_at: NOW + 6 * DAY });
    expect(requests).toEqual([]);
    again.unmount();
  });
});
