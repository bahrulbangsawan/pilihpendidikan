// 05 §7 CVs, CV variants and render tickets (08).
//
//   GET  /api/v1/cvs                                  cv:read
//   POST /api/v1/applications/{app_id}/cv-variants    cv:write (+ ai:invoke when tailoring)
//   GET  /api/v1/cv-variants/{cvv_id}                 cv:read, or a render ticket with
//                                                     ?include=cv_data (C8)
//   POST /api/v1/cv-variants/{cvv_id}/render-ticket   cv:write, or automation:execute
//                                                     for a device leasing the render_cv task
//   POST /api/v1/cv-variants/{cvv_id}/approve         cv:write
//   POST /api/v1/cv-variants/{cvv_id}/reject          cv:write

import type {
  ApprovalDecidedVia,
  ChangeSource,
} from "@pilihpendidikan/jobs-contracts/enums";
import { insufficientScope, REPLAYED_HEADER } from "../../core/http";
import { parsePage } from "../../core/pagination";
import type { RouteDef } from "../../core/router";
import { defineRoute, fromContract } from "../../core/router";
import {
  getCvVariantDetail,
  issueVariantRenderTicket,
  listOwnedCvs,
  planApproveCvVariant,
  planCreateCvVariant,
  planRejectCvVariant,
  renderTicketAuth,
  renderTicketOf,
} from "../../services/cv";

/** `approvals.decided_via` of a request's change source. */
function decidedVia(source: ChangeSource): ApprovalDecidedVia {
  return source === "cli" || source === "mcp" ? source : "web";
}

const createRoute = fromContract(
  "POST /api/v1/applications/{app_id}/cv-variants"
);

export const routes: RouteDef[] = [
  defineRoute({
    ...fromContract("GET /api/v1/cvs"),
    async handler(c) {
      const page = await listOwnedCvs(
        c.env,
        c.caller.email,
        parsePage(c.query)
      );
      return c.respond(page);
    },
  }),
  defineRoute({
    ...createRoute,
    // `ai:invoke` is required only when tailoring (copy-only variants make no
    // AI call); the handler enforces it.
    alsoRequires: undefined,
    async handler(c) {
      if (c.body.tailor && !c.caller.scopes.includes("ai:invoke")) {
        throw insufficientScope(["ai:invoke"]);
      }
      const plan = await planCreateCvVariant(c.db, c.scope, c.env, {
        applicationId: c.params.app_id,
        baseCvId: c.body.base_cv_id,
        template: c.body.template,
        tailor: c.body.tailor,
        now: c.now,
        actorKind: c.actorKind,
        source: c.changeSource,
      });
      const response = await c.commit(plan.statements, {
        status: 202,
        body: { cv_variant: plan.variant },
      });
      if (response.headers.get(REPLAYED_HEADER) !== "true") {
        await plan.afterCommit();
      }
      return response;
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/cv-variants/{cvv_id}"),
    // The render page reads the tailored CVData once with its ticket (C8).
    altAuth: renderTicketAuth("read"),
    async handler(c) {
      const ticket = renderTicketOf(c.request);
      const detail = await getCvVariantDetail(c.db, c.scope, c.env, {
        cvvId: c.params.cvv_id,
        includeCvData: ticket !== null || c.queryData.include === "cv_data",
      });
      return c.respond(
        detail,
        200,
        ticket
          ? { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" }
          : {}
      );
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/cv-variants/{cvv_id}/render-ticket"),
    // A ticket is a bearer secret: never stored in idempotency_keys.
    idempotency: "none",
    async handler(c) {
      const ticket = await issueVariantRenderTicket(c.db, c.scope, c.env, {
        cvvId: c.params.cvv_id,
        deviceId: c.caller.deviceId,
        grantedVia: c.grantedVia,
        now: c.now,
      });
      return c.respond(ticket, 200, { "Referrer-Policy": "no-referrer" });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/cv-variants/{cvv_id}/approve"),
    async handler(c) {
      const plan = await planApproveCvVariant(c.db, c.scope, {
        cvvId: c.params.cvv_id,
        baseRevision: c.baseRevision(c.body.base_revision),
        now: c.now,
        decidedVia: decidedVia(c.changeSource),
        source: c.changeSource,
      });
      return await c.commit(plan.statements, {
        body: { cv_variant: plan.variant, application: plan.application },
      });
    },
  }),
  defineRoute({
    ...fromContract("POST /api/v1/cv-variants/{cvv_id}/reject"),
    async handler(c) {
      const plan = await planRejectCvVariant(c.db, c.scope, {
        cvvId: c.params.cvv_id,
        baseRevision: c.baseRevision(c.body.base_revision),
        now: c.now,
        decidedVia: decidedVia(c.changeSource),
        source: c.changeSource,
        reason: c.body.reason,
      });
      return await c.commit(plan.statements, {
        body: { cv_variant: plan.variant },
      });
    },
  }),
];
