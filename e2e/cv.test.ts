// CV variants and rendering (13 §5 S-09; 08 §11 T8-03): a copy variant (no
// AI) is rendered by the CLI's headless Chromium on the dashboard's
// /render/cv page, approved on the web, kept private (D-25), and its PDF is
// equivalent to the CV builder's own "Download PDF" of the same CVData.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { snapshotPdf } from "../packages/cv-engine/test/pdf-snapshot";
import { createBaseCv, sampleCv } from "./harness/applicant";
import { CvApp } from "./harness/cvapp";
import { uniqueEmail, WEB_ORIGIN } from "./harness/env";
import type { Device } from "./harness/lab";
import { Lab } from "./harness/lab";
import { poll } from "./harness/procs";
import type { SeededApplication } from "./harness/scenario";
import { createApplication, waitForTask, webSignIn } from "./harness/scenario";
import { newKey, signIn } from "./harness/users";
import { WebServer } from "./harness/web";
import { finishFile } from "./harness/cleanup";

const TAILORED_SLUG = /-t-[0-9a-hjkmnp-tv-z]{10}$/;
const FILES_PATH = /^\/api\/v1\/files$/;

let lab: Lab;
let web: WebServer;
let device: Device;

const TEMPLATE = "basic";
let baseCvId = "";
let app: SeededApplication;
let variantId = "";
let fileId = "";
let renderedSha = "";
let tailoredCvId = "";

interface VariantDetail {
  cv_variant: {
    id: string;
    status: string;
    file_id: string | null;
    tailored_cv_id: string | null;
    template: string;
    approved_at: number | null;
  };
  file: {
    id: string;
    sha256: string;
    status: string;
    content_type: string;
  } | null;
}

async function variant(): Promise<VariantDetail> {
  return await lab.user.api.ok<VariantDetail>(
    "GET",
    `/api/v1/cv-variants/${variantId}`
  );
}

async function fileBytes(id: string): Promise<Uint8Array> {
  const res = await fetch(`${lab.api.origin}/api/v1/files/${id}/content`, {
    headers: { authorization: `Bearer ${lab.user.session}` },
  });
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

beforeAll(async () => {
  lab = await Lab.start({ name: "api-cv", noAts: true });
  web = await WebServer.start(lab.api.origin);
  device = await lab.device("renderer");
}, 300_000);

afterAll(async () => {
  await web?.stop();
  await lab?.close();
  finishFile();
});

describe("CV variants (08)", () => {
  test("S-09 a copy variant (no AI) is rendered headless by the CLI's render_cv task; the PDF lands in R2 with a matching SHA-256", async () => {
    baseCvId = await createBaseCv(
      lab.user,
      `e2e-cv-${Date.now().toString(36)}`
    );
    app = await createApplication(lab.user.api, {
      title: "Growth Engineer",
      company: "Render Co",
      stage: "saved",
    });
    const created = await lab.user.api.ok<{
      cv_variant: { id: string; model: string | null };
    }>(
      "POST",
      `/api/v1/applications/${app.id}/cv-variants`,
      { base_cv_id: baseCvId, template: TEMPLATE, tailor: false },
      { idempotencyKey: newKey("cvv") }
    );
    variantId = created.cv_variant.id;
    expect(created.cv_variant.model).toBe("copy");
    const tailored = await poll(
      "the tailored CV document",
      async () => {
        const v = await variant();
        return v.cv_variant.tailored_cv_id ? v : null;
      },
      { timeoutMs: 60_000 }
    );
    tailoredCvId = String(tailored.cv_variant.tailored_cv_id);
    expect(tailoredCvId).toMatch(TAILORED_SLUG);
    expect(tailored.cv_variant.status).toBe("generating");

    // The unattended path (08 §6.3): a render_cv task for a device with the capability.
    const key = newKey("render");
    const task = await lab.user.api.ok<{
      task: { id: string; required_capabilities: string[] };
    }>(
      "POST",
      "/api/v1/tasks",
      {
        kind: "render_cv",
        cv_variant_id: variantId,
        payload: {},
        idempotency_key: key,
        queue_without_device: true,
      },
      { idempotencyKey: key }
    );
    expect(task.task.required_capabilities).toContain("render_cv");
    const worker = device.startWorker(["render_cv"]);
    const result = await worker.taskResult(task.task.id, 180_000);
    expect(result.outcome).toBe("succeeded");
    fileId = String(result.file_id);
    await worker.stop();
    expect((await waitForTask(lab.user.api, task.task.id)).task.state).toBe(
      "succeeded"
    );
    // The CLI never handled the PDF bytes: it only opened the ticket URL (C8).
    expect(device.proxy.find("POST", FILES_PATH)).toHaveLength(0);

    const rendered = await variant();
    expect(rendered.cv_variant.status).toBe("draft");
    expect(rendered.cv_variant.file_id).toBe(fileId);
    expect(rendered.file?.content_type).toBe("application/pdf");
    expect(rendered.file?.status).toBe("ready");
    renderedSha = String(rendered.file?.sha256);
    const bytes = await fileBytes(fileId);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(renderedSha);
    // Stored in the private R2 bucket under the user's prefix (04 §2.5).
    expect(lab.api.r2Keys()).toContain(
      `u/${lab.user.userId}/cv_pdf/${fileId}.pdf`
    );
  }, 300_000);

  test("S-09 the variant is approved on the web, and it stays private (D-25)", async () => {
    await webSignIn(lab.browser, lab.api, lab.user.email, { confirm: "fetch" });
    await lab.browser.goto(`${WEB_ORIGIN}/applications/${app.id}`);
    await lab.browser.waitForHydration('[role="tab"]');
    await lab.browser.click('[role="tab"]:has-text("CV")');
    await lab.browser.waitFor('button:has-text("Approve")', {
      timeout: 60_000,
    });
    await lab.browser.click('button:has-text("Approve")');
    await lab.browser.waitForText("Approve this CV?");
    await lab.browser.click('[role="alertdialog"] button:has-text("Approve")');
    await lab.browser.waitForText("CV approved.");
    const approved = await poll(
      "the approved variant",
      async () => {
        const v = await variant();
        return v.cv_variant.status === "approved" ? v : null;
      },
      { timeoutMs: 30_000 }
    );
    expect(approved.cv_variant.approved_at).not.toBeNull();
    expect(approved.cv_variant.file_id).toBe(fileId);
    const detail = await lab.user.api.ok<{
      application: { cv_variant_id: string | null };
    }>("GET", `/api/v1/applications/${app.id}`);
    expect(detail.application.cv_variant_id).toBe(variantId);

    // D-25: the tailored document is private; the base CV stays public.
    const anonymous = await fetch(`${lab.api.origin}/api/cv/${tailoredCvId}`);
    expect(anonymous.status).toBe(404);
    const owner = await fetch(`${lab.api.origin}/api/cv/${tailoredCvId}`, {
      headers: { authorization: `Bearer ${lab.user.session}` },
    });
    expect(owner.status).toBe(200);
    expect(((await owner.json()) as { visibility?: string }).visibility).toBe(
      "private"
    );
    expect((await fetch(`${lab.api.origin}/api/cv/${baseCvId}`)).status).toBe(
      200
    );
    // The PDF is only reachable through the authorized files route.
    expect(
      (await fetch(`${lab.api.origin}/api/v1/files/${fileId}/content`)).status
    ).toBe(401);
    const stranger = await signIn(lab.api, { email: uniqueEmail("stranger") });
    const theirs = await fetch(
      `${lab.api.origin}/api/v1/files/${fileId}/content`,
      {
        headers: { authorization: `Bearer ${stranger.session}` },
      }
    );
    expect(theirs.status).toBe(404);
  }, 300_000);

  test("T8-03 the CLI's headless /render/cv PDF equals the CV builder's Download PDF of the same CVData (text, fonts, page count)", async () => {
    // The variant is a copy: its CVData is the base CV's (the builder shows the
    // base CV, which is public).
    const tailored = (await (
      await fetch(`${lab.api.origin}/api/cv/${tailoredCvId}`, {
        headers: { authorization: `Bearer ${lab.user.session}` },
      })
    ).json()) as Record<string, unknown>;
    const stored = (await (
      await fetch(`${lab.api.origin}/api/cv/${baseCvId}`)
    ).json()) as Record<string, unknown>;
    // The copy only adds the variant's template and the private flag.
    expect(tailored.style).toBe(TEMPLATE);
    const strip = ({
      visibility: _v,
      style: _s,
      ...rest
    }: Record<string, unknown>) => rest;
    expect(strip(tailored)).toEqual(strip(stored));
    const base = sampleCv();

    const cvApp = await CvApp.start(lab.api.origin);
    try {
      await lab.browser.goto(
        `${cvApp.origin}/?cv=${encodeURIComponent(baseCvId)}&template=${TEMPLATE}`
      );
      const name = String((base.personalInfo as { fullName: string }).fullName);
      await lab.browser.waitForText(name, 120_000);
      await lab.browser.waitForHydration("button");
      const download = await lab.browser.download(
        'button:has-text("Download PDF")'
      );
      const builderPdf = new Uint8Array(readFileSync(download.path));
      const cliPdf = await fileBytes(fileId);
      const builder = await snapshotPdf(builderPdf);
      const cli = await snapshotPdf(cliPdf);
      expect(cli.pages).toBeGreaterThan(0);
      expect(cli.pages).toBe(builder.pages);
      expect(cli.fonts).toEqual(builder.fonts);
      expect(cli.text).toEqual(builder.text);
      expect(cli.text.join("\n")).toContain(name);
    } finally {
      await cvApp.stop();
    }
  }, 600_000);
});
