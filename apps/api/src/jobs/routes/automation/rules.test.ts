import { describe, expect, it } from "bun:test";
import { RuleResponseSchema } from "@pilihpendidikan/jobs-contracts/api";
import { payloadHash } from "../../services/automation/policy";
import { DAY, decide, key, NOW, rows, setup } from "./support.test";
import type { Body } from "./support.test";

const criteria = {
  min_score: 80,
  require_ai_component: true,
  max_score_age_days: 14,
  exclude_blocking_gates: true,
  exclude_possible_gates: true,
  keywords: ["backend"],
};

function ruleBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Backend roles",
    mode: "auto",
    enabled: true,
    criteria,
    limits: { max_per_day: 10, max_per_company_per_30d: 2 },
    allowed_domains: ["boards.greenhouse.io"],
    ...overrides,
  };
}

describe("rules CRUD (05 §8)", () => {
  it("TA-RULES approval-mode rules are plain CRUD with jobs:write", async () => {
    const fx = await setup();
    const created = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({ mode: "approval", allowed_domains: [] }),
      { idempotencyKey: key("rule") }
    );
    expect(created.status).toBe(201);
    expect(RuleResponseSchema.safeParse(created.body).success).toBe(true);
    expect(created.body.rule.enabled).toBe(true);
    expect(created.body.approval).toBeUndefined();
    const id = created.body.rule.id;
    expect((await fx.web.get<Body>("/api/v1/rules")).body.items).toHaveLength(
      1
    );
    const stale = await fx.web.patch<Body>(`/api/v1/rules/${id}`, {
      base_revision: 9,
      name: "x",
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("revision_conflict");
    expect(stale.body.details.current.id).toBe(id);
    const renamed = await fx.web.patch<Body>(`/api/v1/rules/${id}`, {
      base_revision: 1,
      name: "Renamed",
      enabled: false,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.rule.name).toBe("Renamed");
    expect(renamed.body.rule.enabled).toBe(false);
    expect(renamed.body.rule.revision).toBe(2);
    const removed = await fx.web.delete<Body>(`/api/v1/rules/${id}`, {
      idempotencyKey: key("del"),
    });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ id, deleted: true });
    expect((await fx.web.get<Body>(`/api/v1/rules/${id}`)).status).toBe(404);
    const changes = rows(
      fx.t,
      "SELECT op FROM change_log WHERE entity = 'rule' AND entity_id = ? ORDER BY seq",
      id
    );
    expect(changes.map((c) => c.op)).toEqual(["upsert", "upsert", "delete"]);
  });

  it("TA-RULES auto rules need min_score ≥ 70, a narrowing criterion, domains and a ≤ 30 d expiry", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const low = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({ criteria: { ...criteria, min_score: 60 } })
    );
    expect(low.status).toBe(422);
    expect(low.body.error).toBe("policy_violation");
    const broad = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({ criteria: { ...criteria, keywords: [] } })
    );
    expect(broad.status).toBe(422);
    const open = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({ allowed_domains: [] })
    );
    expect(open.status).toBe(422);
    const long = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({
        limits: {
          max_per_day: 10,
          max_per_company_per_30d: 2,
          expires_at: NOW + 31 * DAY,
        },
      })
    );
    expect(long.status).toBe(422);
    const ceiling = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({ limits: { max_per_day: 26, max_per_company_per_30d: 2 } })
    );
    expect(ceiling.status).toBe(400);
    const ok = await fx.web.post<Body>(
      "/api/v1/rules",
      ruleBody({ enabled: false })
    );
    expect(ok.status).toBe(201);
    expect(ok.body.rule.limits.expires_at).toBe(NOW + 30 * DAY);
    expect(ok.body.rule.allowed_domains).toEqual(["greenhouse.io"]);
  });

  it("TA-RULES enabling auto creates a rule_activation approval; approving it turns the rule on", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const created = await fx.web.post<Body>("/api/v1/rules", ruleBody(), {
      idempotencyKey: key("rule"),
    });
    expect(created.status).toBe(201);
    expect(created.body.rule.enabled).toBe(false);
    const approval = created.body.approval;
    expect(approval.kind).toBe("rule_activation");
    expect(approval.state).toBe("pending");
    expect(approval.payload.rule_id).toBe(created.body.rule.id);
    expect(approval.payload.summary).toContain("10 applications a day");
    expect(approval.payload_hash).toBe(await payloadHash(approval.payload));
    expect(approval.expires_at).toBe(NOW + 7 * DAY);
    const decided = await decide(fx.web, approval);
    expect(decided.status).toBe(200);
    expect(decided.body.approval.state).toBe("approved");
    const rule = (
      await fx.web.get<Body>(`/api/v1/rules/${created.body.rule.id}`)
    ).body;
    expect(rule.rule.enabled).toBe(true);
    expect(rule.rule.activated_approval_id).toBe(approval.id);
    expect(rule.approval.state).toBe("approved");
  });

  it("TA-RULES enabling auto needs automation:manage and the auto-mode flag", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const res = await fx.cli.post<Body>("/api/v1/rules", ruleBody(), {
      idempotencyKey: key("rule"),
    });
    expect(res.status).toBe(403);
    expect(res.body.scope).toBe("automation:manage");
    const write = await fx.client.personalToken("alice@example.com", "write");
    expect((await write.post<Body>("/api/v1/rules", ruleBody())).status).toBe(
      403
    );
    const draft = await write.post<Body>(
      "/api/v1/rules",
      ruleBody({ enabled: false })
    );
    expect(draft.status).toBe(201);
    const off = await setup();
    const dark = await off.web.post<Body>("/api/v1/rules", ruleBody());
    expect(dark.status).toBe(422);
    expect(dark.body.error).toBe("mode_not_allowed");
  });

  it("TA-RULES editing an active auto rule voids its activation; renaming keeps it", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const created = await fx.web.post<Body>("/api/v1/rules", ruleBody(), {
      idempotencyKey: key("rule"),
    });
    await decide(fx.web, created.body.approval);
    const id = created.body.rule.id;
    const renamed = await fx.web.patch<Body>(`/api/v1/rules/${id}`, {
      base_revision: 2,
      name: "Renamed",
    });
    expect(renamed.body.rule.enabled).toBe(true);
    expect(renamed.body.approval).toBeUndefined();
    const widened = await fx.web.patch<Body>(`/api/v1/rules/${id}`, {
      base_revision: 3,
      limits: { max_per_day: 20, max_per_company_per_30d: 2 },
    });
    expect(widened.status).toBe(200);
    expect(widened.body.rule.enabled).toBe(false);
    expect(widened.body.rule.activated_approval_id).toBeNull();
    expect(widened.body.approval.state).toBe("pending");
    const again = await fx.web.patch<Body>(`/api/v1/rules/${id}`, {
      base_revision: 4,
      criteria: { ...criteria, min_score: 90 },
    });
    expect(again.body.approval.id).not.toBe(widened.body.approval.id);
    const superseded = await decide(fx.web, widened.body.approval);
    expect(superseded.status).toBe(410);
    expect(superseded.body.error).toBe("approval_expired");
  });

  it("TA-RULES disabling an auto rule never needs the step-up scope", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const created = await fx.web.post<Body>("/api/v1/rules", ruleBody(), {
      idempotencyKey: key("rule"),
    });
    await decide(fx.web, created.body.approval);
    const res = await fx.cli.patch<Body>(
      `/api/v1/rules/${created.body.rule.id}`,
      { base_revision: 2, enabled: false },
      { idempotencyKey: key("p") }
    );
    expect(res.status).toBe(200);
    expect(res.body.rule.enabled).toBe(false);
    const reenable = await fx.cli.patch<Body>(
      `/api/v1/rules/${created.body.rule.id}`,
      { base_revision: 3, enabled: true },
      { idempotencyKey: key("p") }
    );
    expect(reenable.status).toBe(403);
  });

  it("TA-RULES deleting a rule expires its pending activation", async () => {
    const fx = await setup({ flags: { JOBS_AUTO_MODE_ENABLED: true } });
    const created = await fx.web.post<Body>("/api/v1/rules", ruleBody(), {
      idempotencyKey: key("rule"),
    });
    const res = await fx.web.delete<Body>(
      `/api/v1/rules/${created.body.rule.id}`,
      { query: { base_revision: 1 } }
    );
    expect(res.status).toBe(200);
    const approval = rows(
      fx.t,
      "SELECT state FROM approvals WHERE id = ?",
      created.body.approval.id
    )[0];
    expect(approval.state).toBe("expired");
  });
});
