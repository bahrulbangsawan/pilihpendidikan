// 05 §2 — meta and identity. Owner: leaf-2.1.
//
//   GET /api/v1/meta  public; never behind JOBS_V1_ENABLED or the CLI version
//                     gate, so an old or early CLI can always learn what to do
//   GET /api/v1/me    any authenticated credential

import type {
  GetMeResponse,
  GetMetaResponse,
} from "@pilihpendidikan/jobs-contracts/api";
import { defineRoute, fromContract } from "../../core/router";
import { enabledFeatureNames } from "../../core/flags";
import { API_VERSION, cliVersions } from "../../core/version";

export const routes = [
  defineRoute({
    ...fromContract("GET /api/v1/meta"),
    flagExempt: true,
    versionExempt: true,
    handler(c) {
      const versions = cliVersions(c.env);
      const body: GetMetaResponse & { server_time: number } = {
        api_version: API_VERSION,
        min_cli_version: versions.min,
        recommended_cli_version: versions.recommended,
        features: enabledFeatureNames(c.flags),
        server_time: c.now,
      };
      return c.respond(body);
    },
  }),
  defineRoute({
    ...fromContract("GET /api/v1/me"),
    handler(c) {
      const caller = c.caller;
      const body: GetMeResponse = {
        user_id: caller.userId,
        email: caller.email,
        is_admin: caller.isAdmin,
        scopes: [...caller.scopes],
        credential_kind: caller.credentialKind,
        ...(c.device
          ? { device: { id: c.device.id, name: c.device.name } }
          : {}),
      };
      return c.respond(body);
    },
  }),
];
