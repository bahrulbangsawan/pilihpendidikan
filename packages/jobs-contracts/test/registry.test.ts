import { describe, expect, test } from "bun:test";
import { z } from "zod";
import "../src/api/routes";
import { duplicateSchemaIds, registeredSchemaIds } from "../src/registry";
import type * as RegistryModule from "../src/registry";

describe("schema registry", () => {
  test("TFIX-REGISTRY-DUP every contract schema id is defined exactly once", () => {
    expect(registeredSchemaIds().length).toBeGreaterThan(100);
    expect(duplicateSchemaIds()).toEqual([]);
  });

  test("TFIX-REGISTRY-DUP a module evaluated twice (dev server) re-registers without throwing and is reported", async () => {
    // A query string gives a second, isolated instance of the registry.
    const specifier = "../src/registry?dup-test";
    const registry = (await import(specifier)) as typeof RegistryModule;
    const first = registry.defineSchema("common", "DupProbe", z.string());
    const second = registry.defineSchema("common", "DupProbe", z.number());
    expect(second).not.toBe(first);
    expect(registry.schemasInGroup("common").get("DupProbe")).toBe(second);
    expect(registry.duplicateSchemaIds()).toEqual(["DupProbe"]);
  });
});
