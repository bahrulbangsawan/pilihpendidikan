// 05 §2 — Meta and identity.
import { z } from "zod";
import { SemverSchema } from "../common";
import { CredentialKindSchema } from "../enums";
import { DeviceIdSchema, UserIdSchema } from "../ids";
import { defineSchema } from "../registry";
import { route } from "./route";

/** `GET /api/v1/meta` (05 §1.7). `features` lists the enabled feature names. */
export const GetMetaResponseSchema = defineSchema(
  "api",
  "GetMetaResponse",
  z.object({
    api_version: z.string(),
    min_cli_version: SemverSchema,
    recommended_cli_version: SemverSchema,
    features: z.array(z.string()),
  })
);
export type GetMetaResponse = z.infer<typeof GetMetaResponseSchema>;

export const GetMeResponseSchema = defineSchema(
  "api",
  "GetMeResponse",
  z.object({
    user_id: UserIdSchema,
    email: z.string().min(3).max(254),
    is_admin: z.boolean(),
    scopes: z.array(z.string()),
    device: z.object({ id: DeviceIdSchema, name: z.string() }).optional(),
    credential_kind: CredentialKindSchema,
  })
);
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;

export const metaRoutes = {
  "GET /api/v1/meta": route({
    method: "GET",
    path: "/api/v1/meta",
    operation: "getMeta",
    section: "05 §2",
    scope: "none",
    idempotency: "none",
    status: 200,
    request: null,
    response: GetMetaResponseSchema,
  }),
  "GET /api/v1/me": route({
    method: "GET",
    path: "/api/v1/me",
    operation: "getMe",
    section: "05 §2",
    scope: "any",
    idempotency: "none",
    status: 200,
    request: null,
    response: GetMeResponseSchema,
  }),
} as const;
