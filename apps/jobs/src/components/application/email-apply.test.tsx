// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setBffTransport } from "@/lib/api-client";
import type { BffRequest, BffResult, JsonValue } from "@/lib/bff";
import { makeApplication, makeDetail, makePosting } from "@/test/fixtures";
import { makeApproval, makeCvVariant, makeEmail } from "@/test/fixtures-rest";
import { click, render } from "@/test/render";
import { EmailApply } from "./email-apply";

const ok = (data: unknown, status = 200): BffResult => ({
  ok: true,
  status,
  data: data as JsonValue,
  etag: null,
  notModified: false,
  replayed: false,
});

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value"
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function transport(requests: BffRequest[]) {
  setBffTransport((request) => {
    requests.push(request);
    if (request.route === "GET /api/v1/profile/facts") {
      return Promise.resolve(ok({ facts: [], profile_version: 1 }));
    }
    if (request.route === "POST /api/v1/applications/{app_id}/emails") {
      return Promise.resolve(
        ok({ email: makeEmail(makeApplication().id) }, 201)
      );
    }
    return Promise.resolve(ok({}));
  });
}

afterEach(() => {
  setBffTransport(null);
  document.body.replaceChildren();
});

describe("TW-EML the email composer (09)", () => {
  it("TW-EML a free-mail recipient warns about scams and needs the tick before the draft can be saved", async () => {
    const requests: BffRequest[] = [];
    transport(requests);
    const application = makeApplication();
    const variant = makeCvVariant({
      application_id: application.id,
      status: "approved",
      file_id: "fil_01JA0000000000000000000001",
    });
    const detail = makeDetail({
      application: { ...application, cv_variant_id: variant.id },
      posting: makePosting({ company_domain: "acme.example" }),
      cv_variants: [variant],
    });
    const { container } = render(wrap(<EmailApply detail={detail} />));
    await flush();
    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    const to = [...inputs].find((input) => input.type === "email");
    const subject = [...inputs].find((input) => input.maxLength === 300);
    const body = container.querySelector("textarea");
    if (!(to && subject && body)) {
      throw new Error("composer fields missing");
    }
    type(to, "hr.acme@gmail.com");
    type(subject, "Application");
    type(body, "Dear team");
    expect(container.textContent).toContain(
      "gmail.com is a personal mail service"
    );
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save draft"
    );
    expect(save?.disabled).toBe(true);
    const tick = container.querySelector<HTMLButtonElement>(
      'button[role="checkbox"]'
    );
    await click(tick);
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save?.closest("form")?.requestSubmit();
      await Promise.resolve();
    });
    await flush();
    const sent = requests.find(
      (request) => request.route === "POST /api/v1/applications/{app_id}/emails"
    );
    expect(sent?.body).toMatchObject({
      to: "hr.acme@gmail.com",
      subject: "Application",
      body_text: "Dear team",
      delivery: "local_handoff",
      recipient_confirmed: true,
      attachment_file_ids: ["fil_01JA0000000000000000000001"],
    });
  });

  it("TW-EML an employer address needs no tick; an approved draft offers the .eml download and a mailto fallback", async () => {
    transport([]);
    const application = makeApplication();
    const email = makeEmail(application.id, { status: "approved" });
    const detail = makeDetail({
      application,
      posting: makePosting({ company_domain: "acme.example" }),
      emails: [email],
    });
    const { container } = render(wrap(<EmailApply detail={detail} />));
    await flush();
    const eml = container.querySelector<HTMLAnchorElement>(
      'a[download][href$=".eml"]'
    );
    expect(eml?.getAttribute("href")).toBe(
      `/download/applications/${application.id}/emails/${email.id}.eml`
    );
    const mailto =
      container.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(mailto?.getAttribute("href")).toContain("careers@acme.example");
    expect(container.textContent).toContain("can't carry attachments");
    const to = [...container.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => input.type === "email"
    );
    if (to) {
      type(to, "jobs@careers.acme.example");
    }
    expect(container.textContent).toContain("On the employer's domain");
    expect(container.querySelector('button[role="checkbox"]')).toBeNull();
  });

  it("TW-EML approving a draft sends the approval's payload_hash after showing the exact content", async () => {
    const requests: BffRequest[] = [];
    setBffTransport((request) => {
      requests.push(request);
      if (request.route === "POST /api/v1/emails/{eml_id}/approve") {
        return Promise.resolve(
          ok({
            email: {},
            approval: {},
            application: makeApplication(),
            evidence: null,
          })
        );
      }
      return Promise.resolve(ok({ facts: [], profile_version: 1 }));
    });
    const application = makeApplication();
    const email = makeEmail(application.id, { status: "draft" });
    const approval = makeApproval(
      {
        type: "email_submit",
        email_application_id: email.id,
        to: email.to_address,
        cc: [],
        subject: email.subject,
        body_text: email.body_text,
        attachments: [],
        ai_drafted: false,
        recipient_confirmed: true,
      },
      { application_id: application.id, payload_hash: "e".repeat(64) }
    );
    const detail = makeDetail({
      application,
      emails: [email],
      approvals: [approval],
    });
    const { container } = render(wrap(<EmailApply detail={detail} />));
    await flush();
    await click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Review and approve"
      )
    );
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain(email.subject);
    expect(dialog?.textContent).toContain("Please find my CV attached.");
    await click(
      [...(dialog?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Approve"
      )
    );
    await flush();
    const approve = requests.find(
      (request) => request.route === "POST /api/v1/emails/{eml_id}/approve"
    );
    expect(approve?.body).toEqual({
      payload_hash: "e".repeat(64),
      recipient_confirmed: true,
    });
  });
});

describe("TW-EML approval asks for the recipient tick (09 §1)", () => {
  it("TW-EML a free-mail draft cannot be approved until the tick is given, then sends recipient_confirmed", async () => {
    const requests: BffRequest[] = [];
    setBffTransport((request) => {
      requests.push(request);
      if (request.route === "POST /api/v1/emails/{eml_id}/approve") {
        return Promise.resolve(
          ok({
            email: {},
            approval: {},
            application: makeApplication(),
            evidence: null,
          })
        );
      }
      return Promise.resolve(ok({ facts: [], profile_version: 1 }));
    });
    const application = makeApplication();
    const email = makeEmail(application.id, {
      status: "draft",
      to_address: "acme.hr@gmail.com",
    });
    const approval = makeApproval(
      {
        type: "email_submit",
        email_application_id: email.id,
        to: email.to_address,
        cc: [],
        subject: email.subject,
        body_text: email.body_text,
        attachments: [],
        ai_drafted: false,
        recipient_confirmed: false,
      },
      { application_id: application.id, payload_hash: "d".repeat(64) }
    );
    const detail = makeDetail({
      application,
      emails: [email],
      approvals: [approval],
    });
    const { container } = render(wrap(<EmailApply detail={detail} />));
    await flush();
    await click(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Review and approve"
      )
    );
    const dialog = document.querySelector('[role="alertdialog"]');
    const approveButton = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Approve"
    );
    expect(approveButton?.disabled).toBe(true);
    await click(dialog?.querySelector('button[role="checkbox"]'));
    expect(approveButton?.disabled).toBe(false);
    await click(approveButton);
    await flush();
    expect(
      requests.find((r) => r.route === "POST /api/v1/emails/{eml_id}/approve")
        ?.body
    ).toEqual({ payload_hash: "d".repeat(64), recipient_confirmed: true });
  });
});
