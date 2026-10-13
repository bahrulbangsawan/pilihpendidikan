import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_REGISTRY,
  SCHEMA_GROUPS,
  schemasInGroup,
} from "../src/registry";
import { buildAllSchemaGroups, toJsonSchema } from "../src/schema-export";

const SCHEMA_DIR = join(import.meta.dir, "..", "schema");
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const LOCAL_REF = /^#\/\$defs\/(.+)$/;

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRefs(item, out);
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        out.push(value);
      } else {
        collectRefs(value, out);
      }
    }
  }
  return out;
}

describe("JSON Schema export (D-20)", () => {
  const built = buildAllSchemaGroups();

  test("TC-JSONSCHEMA export is deterministic", () => {
    expect(JSON.stringify(buildAllSchemaGroups())).toBe(JSON.stringify(built));
  });

  test.each(SCHEMA_GROUPS.map((group) => [group] as const))(
    "TC-JSONSCHEMA schema/%s.json matches the committed file",
    (group) => {
      const committed = JSON.parse(
        readFileSync(join(SCHEMA_DIR, `${group}.json`), "utf8")
      );
      expect(committed).toEqual(built[group]);
    }
  );

  test("TC-JSONSCHEMA every $ref resolves inside its own file and names are PascalCase", () => {
    for (const group of SCHEMA_GROUPS) {
      const doc = built[group];
      const names = new Set(Object.keys(doc.$defs));
      for (const name of names) {
        expect(name).toMatch(PASCAL);
      }
      for (const ref of collectRefs(doc.$defs)) {
        const target = LOCAL_REF.exec(ref)?.[1];
        expect(target, `${group}: ${ref}`).toBeDefined();
        expect(names.has(target ?? ""), `${group}: ${ref}`).toBe(true);
      }
    }
  });

  test("TC-JSONSCHEMA every registered schema is exported under its stable name", () => {
    let count = 0;
    for (const group of SCHEMA_GROUPS) {
      for (const [id, schema] of schemasInGroup(group)) {
        count++;
        expect(Object.keys(built[group].$defs)).toContain(id);
        expect(CONTRACT_REGISTRY.get(schema)?.id).toBe(id);
      }
    }
    expect(count).toBeGreaterThan(300);
  });

  test("TC-JSONSCHEMA exported shapes are representable (no transforms) and integers carry no ±2^53 noise", () => {
    for (const group of SCHEMA_GROUPS) {
      for (const schema of schemasInGroup(group).values()) {
        expect(() => toJsonSchema(schema)).not.toThrow();
      }
    }
    expect(JSON.stringify(built)).not.toContain("9007199254740991");
  });

  test("TC-JSONSCHEMA plain objects stay open (forward-compatible) while strict ones stay closed", () => {
    const api = built.api.$defs as Record<
      string,
      { additionalProperties?: unknown }
    >;
    expect(api.BoardResponse?.additionalProperties).toBeUndefined();
    const tailoring = built["cv-tailoring"].$defs as Record<
      string,
      { additionalProperties?: unknown }
    >;
    expect(tailoring.CvTailoringPatch?.additionalProperties).toBe(false);
  });
});
