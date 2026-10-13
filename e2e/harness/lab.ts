// A small world for the automation scenarios: one api, the fixture ATS, the
// user's browser, a signed-in user with consent + facts, and CLI devices
// (each with its own home and recording proxy) that run `pilih-jobs worker`.
import type { ApiOptions } from "./api";
import { ApiServer } from "./api";
import { prepareApplicant } from "./applicant";
import { AtsServer } from "./ats";
import { Browser } from "./browser";
import type { CliOptions } from "./cli";
import { CliHome, parseJsonLines } from "./cli";
import { uniqueEmail } from "./env";
import type { Proc } from "./procs";
import { FatalError, poll, sleep } from "./procs";
import { ApiProxy } from "./proxy";
import type { ApprovalRecord, SeededApplication } from "./scenario";
import {
  createApplication,
  decide,
  pendingApprovals,
  startApply,
} from "./scenario";
import type { WebUser } from "./users";
import { signIn } from "./users";

/** A `pilih-jobs worker start` process and its NDJSON events. */
export class Worker {
  readonly proc: Proc;
  readonly device: Device;

  constructor(device: Device, proc: Proc) {
    this.device = device;
    this.proc = proc;
  }

  events(): Record<string, unknown>[] {
    return parseJsonLines(this.proc.stdout);
  }

  /**
   * Fails fast when the agent paused because the api refused one of its AI
   * calls (`ai_unavailable`): no scenario here expects it, and waiting for
   * the run would only end in a timeout (requests/leaf-5.1.md #3).
   */
  assertHealthy(): void {
    const outage = this.events().find(
      (e) => e.type === "paused" && e.pause_reason === "ai_unavailable"
    );
    if (outage) {
      const refused = this.device.proxy.log
        .filter(
          (e) => e.path.startsWith("/api/v1/ai/") && (e.status ?? 0) >= 400
        )
        .map(
          (e) =>
            `${e.path} → ${e.status} ${JSON.stringify(e.responseJson).slice(0, 300)}`
        );
      throw new FatalError(
        `${this.device.name}: the agent paused with ai_unavailable; refused AI calls:\n${refused.join("\n")}`
      );
    }
  }

  async waitForEvent(
    what: string,
    predicate: (event: Record<string, unknown>) => boolean,
    timeoutMs = 120_000
  ): Promise<Record<string, unknown>> {
    return await this.proc.waitFor(
      () => {
        const found = this.events().find(predicate);
        if (found) {
          return found;
        }
        this.assertHealthy();
        return null;
      },
      timeoutMs,
      what
    );
  }

  /** The `result` event of a task (the worker's per-task outcome). */
  async taskResult(taskId: string, timeoutMs = 180_000) {
    return await this.waitForEvent(
      `the result of ${taskId}`,
      (e) => e.type === "result" && e.task_id === taskId,
      timeoutMs
    );
  }

  kill9(): void {
    this.proc.kill9();
  }

  async stop(): Promise<void> {
    await this.proc.stop(20_000);
  }
}

export class Device {
  readonly cli: CliHome;
  readonly proxy: ApiProxy;
  readonly id: string;
  readonly name: string;
  readonly workers: Worker[] = [];

  constructor(cli: CliHome, proxy: ApiProxy, id: string, name: string) {
    this.cli = cli;
    this.proxy = proxy;
    this.id = id;
    this.name = name;
  }

  startWorker(kinds: string[] = ["apply"], extra: string[] = []): Worker {
    const worker = new Worker(
      this,
      this.cli.spawn(["worker", "start", "--kinds", kinds.join(","), ...extra])
    );
    this.workers.push(worker);
    return worker;
  }
}

export interface LabOptions extends ApiOptions {
  /** Start without the fixture ATS server. */
  noAts?: boolean;
}

export class Lab {
  readonly api: ApiServer;
  readonly ats: AtsServer | null;
  readonly browser: Browser;
  readonly user: WebUser;
  readonly devices: Device[] = [];
  private readonly proxies: ApiProxy[] = [];
  private readonly approvers: Array<() => void> = [];

  private constructor(
    api: ApiServer,
    ats: AtsServer | null,
    browser: Browser,
    user: WebUser
  ) {
    this.api = api;
    this.ats = ats;
    this.browser = browser;
    this.user = user;
  }

  static async start(options: LabOptions = {}): Promise<Lab> {
    const api = await ApiServer.start(options);
    const ats = options.noAts ? null : await AtsServer.start();
    const browser = await Browser.launch();
    const user = await signIn(api, {
      email: uniqueEmail(options.name ?? "lab"),
    });
    await prepareApplicant(user);
    return new Lab(api, ats, browser, user);
  }

  get fixture(): AtsServer {
    if (!this.ats) {
      throw new Error("this lab has no fixture ATS server");
    }
    return this.ats;
  }

  /** A CLI device of the lab's user, signed in through the consent page. */
  async device(name: string, options: CliOptions = {}): Promise<Device> {
    const proxy = await ApiProxy.start(this.api.origin);
    this.proxies.push(proxy);
    const cli = CliHome.create(name, proxy.origin, options);
    const login = await cli.login(this.browser, this.user, name);
    const device = new Device(cli, proxy, String(login.data.device_id), name);
    this.devices.push(device);
    return device;
  }

  /** A tracked application whose apply URL is a fixture form (`e2e/<n>`). */
  async application(
    flow: string,
    opts: { mode?: string; stage?: string; title?: string } = {}
  ): Promise<SeededApplication> {
    return await createApplication(this.user.api, {
      title: opts.title ?? `Engineer ${flow}`,
      company: "Acme",
      applyUrl: this.fixture.applyUrl(flow),
      stage: opts.stage ?? "ready",
      mode: opts.mode ?? "approval",
    });
  }

  /** An apply task for `app` (the Apply tab's Start), optionally pinned to a device. */
  async apply(
    app: SeededApplication,
    opts: { mode?: string; device?: Device | null } = {}
  ): Promise<string> {
    return await startApply(this.user.api, app.id, {
      mode: opts.mode ?? "approval",
      deviceId: opts.device ? opts.device.id : null,
    });
  }

  /**
   * The user approves every pending `submit` approval matching `filter` from
   * the web (with its payload_hash), until the returned stop function runs.
   */
  autoApprove(
    filter: (a: ApprovalRecord) => boolean = (a) => a.kind === "submit"
  ): () => void {
    let running = true;
    const decided = new Set<string>();
    const loop = async () => {
      while (running) {
        try {
          for (const approval of await pendingApprovals(
            this.user.api,
            filter
          )) {
            if (!decided.has(approval.id)) {
              decided.add(approval.id);
              await decide(this.user.api, approval);
            }
          }
        } catch {
          // a decision raced with an expiry or a lease loss: try again
        }
        await sleep(500);
      }
    };
    loop();
    const stop = () => {
      running = false;
    };
    this.approvers.push(stop);
    return stop;
  }

  /** Waits for one pending approval of `kind` for a task. */
  async approvalFor(
    taskId: string,
    kind = "submit",
    timeoutMs = 120_000,
    worker?: Worker
  ) {
    return await poll(
      `a pending ${kind} approval of ${taskId}`,
      async () => {
        worker?.assertHealthy();
        const [approval] = await pendingApprovals(
          this.user.api,
          (a) => a.kind === kind && a.task_id === taskId
        );
        return approval ?? null;
      },
      { timeoutMs, intervalMs: 500 }
    );
  }

  async close(): Promise<void> {
    for (const stop of this.approvers) {
      stop();
    }
    for (const device of this.devices) {
      for (const worker of device.workers) {
        worker.kill9();
      }
    }
    await this.browser.close();
    for (const proxy of this.proxies) {
      await proxy.close();
    }
    await this.ats?.stop();
    await this.api.stop();
  }
}
