import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import id from "./locales/id.json";

// Every source file of the app as text, to collect the translation keys it
// uses. Tests themselves are left out.
const SOURCES = import.meta.glob<string>(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true }
);

// `t("form.remove")`, `translateNow("status.saveFailed", …)`: static keys
// only; keys built from template literals are not collected.
const KEY_CALL = /\b(?:t|translateNow)\(\s*"([A-Za-z0-9_.]+)"/g;

interface Dictionary {
  [key: string]: string | Dictionary;
}

const EN = en as unknown as Dictionary;
const ID = id as unknown as Dictionary;

function leafKeys(dictionary: Dictionary, prefix = ""): string[] {
  return Object.entries(dictionary).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : leafKeys(value, `${prefix}${key}.`)
  );
}

function lookup(dictionary: Dictionary, path: string): unknown {
  let node: unknown = dictionary;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) {
      return;
    }
    node = (node as Dictionary)[part];
  }
  return node;
}

describe("translations", () => {
  it("have the same keys in English and Indonesian", () => {
    expect(leafKeys(ID).sort()).toEqual(leafKeys(EN).sort());
  });

  it("define every key the app uses, as text, in both languages", () => {
    const used = new Set<string>();
    for (const source of Object.values(SOURCES)) {
      for (const match of source.matchAll(KEY_CALL)) {
        used.add(match[1] ?? "");
      }
    }
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].filter(
      (key) =>
        typeof lookup(EN, key) !== "string" ||
        typeof lookup(ID, key) !== "string"
    );
    expect(missing).toEqual([]);
  });
});
