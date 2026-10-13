// JSON Schema export of the registered contracts (D-20, 02 §"Shared
// contracts"). One document per group, `{"$schema", "$defs": {Name: …}}`,
// self-contained: every schema a group's definitions reference is included
// under its own stable name, so `datamodel-codegen` produces named Pydantic
// classes per file without cross-file references.
//
// Export uses `io: "input"`: plain objects carry no `additionalProperties:
// false`, so older CLIs ignore fields added within v1; strict objects
// (e.g. CvTailoringPatch) keep it.
import { z } from "zod";
import "./adapters";
import "./api/routes";
import "./data";
import "./email";
import "./facts";
import "./queue";
import type { SchemaGroup } from "./registry";
import {
  CONTRACT_REGISTRY,
  duplicateSchemaIds,
  SCHEMA_GROUPS,
  schemasInGroup,
} from "./registry";

export const JSON_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema";

export interface JsonSchemaDocument {
  $defs: Record<string, unknown>;
  $schema: string;
}

const SAFE_INTEGER_BOUND = Number.MAX_SAFE_INTEGER;

/** Drops the ±2^53 bounds Zod adds to every integer (noise for Pydantic). */
function dropSafeIntegerBounds(jsonSchema: Record<string, unknown>): void {
  if (jsonSchema.minimum === -SAFE_INTEGER_BOUND) {
    Reflect.deleteProperty(jsonSchema, "minimum");
  }
  if (jsonSchema.maximum === SAFE_INTEGER_BOUND) {
    Reflect.deleteProperty(jsonSchema, "maximum");
  }
}

/** One schema with its named dependencies, as `{$ref, $defs}`. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    metadata: CONTRACT_REGISTRY,
    io: "input",
    unrepresentable: "throw",
    override: (ctx) => dropSafeIntegerBounds(ctx.jsonSchema),
  }) as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

/** The JSON Schema document of one group. */
export function buildSchemaGroup(group: SchemaGroup): JsonSchemaDocument {
  const defs = new Map<string, unknown>();
  for (const schema of schemasInGroup(group).values()) {
    const out = toJsonSchema(schema);
    const nested = (out.$defs ?? {}) as Record<string, unknown>;
    for (const [name, definition] of Object.entries(nested)) {
      const existing = defs.get(name);
      if (
        existing !== undefined &&
        stableStringify(existing) !== stableStringify(definition)
      ) {
        throw new Error(`Schema ${name} exports two different definitions`);
      }
      defs.set(name, definition);
    }
  }
  const sorted: Record<string, unknown> = {};
  for (const name of [...defs.keys()].sort()) {
    sorted[name] = defs.get(name);
  }
  return { $schema: JSON_SCHEMA_DIALECT, $defs: sorted };
}

/** Every group document, keyed by group (file `schema/<group>.json`). */
export function buildAllSchemaGroups(): Record<
  SchemaGroup,
  JsonSchemaDocument
> {
  const duplicates = duplicateSchemaIds();
  if (duplicates.length > 0) {
    throw new Error(
      `Schema ids registered twice: ${duplicates.join(", ")} (names are contract)`
    );
  }
  const out = {} as Record<SchemaGroup, JsonSchemaDocument>;
  for (const group of SCHEMA_GROUPS) {
    out[group] = buildSchemaGroup(group);
  }
  return out;
}
