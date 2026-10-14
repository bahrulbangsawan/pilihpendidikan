// Named-schema registry for the JSON Schema export (D-20).
//
// Every schema that should appear as a named definition in `schema/*.json`
// (and therefore as a named Pydantic class in the CLI) is created through
// `defineSchema(group, Name, schema)`. The id becomes the `$defs` key and the
// `$ref` target, so names are part of the contract: never rename one without
// a matching change in every consumer.
import { z } from "zod";

export interface ContractMeta {
  description?: string;
  id: string;
}

/** Zod registry passed as `metadata` to `z.toJSONSchema`. */
export const CONTRACT_REGISTRY = z.registry<ContractMeta>();

/** One JSON Schema file per group: `schema/<group>.json`. */
export const SCHEMA_GROUPS = [
  "common",
  "enums",
  "records",
  "api",
  "agent",
  "queue",
  "scoring",
  "cv-tailoring",
  "facts",
  "adapters",
  "email",
  "data",
  "cloud",
] as const;
export type SchemaGroup = (typeof SCHEMA_GROUPS)[number];

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

const groups = new Map<SchemaGroup, Map<string, z.ZodType>>();
const ids = new Map<string, SchemaGroup>();
// Ids registered more than once from different groups or source modules. A
// dev server can evaluate one module twice (two module URLs for the same
// file), so registering again must not crash a running Worker; the JSON
// Schema export and the test suite refuse a non-empty list instead.
const duplicates: string[] = [];

/**
 * Registers `schema` under a stable PascalCase `id` in `group` and returns the
 * same schema instance (so `export const XSchema = defineSchema(...)` keeps
 * full type inference).
 */
export function defineSchema<T extends z.ZodType>(
  group: SchemaGroup,
  id: string,
  schema: T,
  description?: string
): T {
  if (!PASCAL_CASE.test(id)) {
    throw new Error(`Schema id "${id}" is not PascalCase`);
  }
  const previousGroup = ids.get(id);
  if (previousGroup !== undefined) {
    duplicates.push(id);
    // The re-evaluated module's instance replaces the old one in its group.
    groups.get(previousGroup)?.delete(id);
  }
  ids.set(id, group);
  CONTRACT_REGISTRY.add(schema, description ? { id, description } : { id });
  let members = groups.get(group);
  if (!members) {
    members = new Map();
    groups.set(group, members);
  }
  members.set(id, schema);
  return schema;
}

/** The named schemas of one group, in registration order. */
export function schemasInGroup(group: SchemaGroup): Map<string, z.ZodType> {
  return groups.get(group) ?? new Map();
}

/** Every registered schema id (used by tests to assert stable naming). */
export function registeredSchemaIds(): string[] {
  return [...ids.keys()];
}

/** Ids defined more than once; must be empty for the export and in tests. */
export function duplicateSchemaIds(): string[] {
  return [...duplicates];
}
