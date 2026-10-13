import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import {
  CARD_KEYS,
  cardKeyAction,
  NAV_SHORTCUTS,
  SHORTCUTS,
} from "./shortcuts";

const SRC = new URL("..", import.meta.url).pathname;
const REGISTER_RE = /useShortcut\(\s*(?:"([^"]+)"|CARD_KEYS\.(\w+))/g;
const KBD_HINT_RE = /<Kbd aria-hidden="true">([^<{]+)<\/Kbd>/g;
const SOURCE_RE = /\.tsx?$/;
const SINGLE_KEY_HINT_RE = /^[A-Z?/]$/;
const KEYSHORTCUTS_RE = /aria-keyshortcuts="([^"]+)"/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return files(path);
    }
    return SOURCE_RE.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

/** Keys passed to useShortcut anywhere in src (literal or CARD_KEYS.*). */
function registeredKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of files(SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(REGISTER_RE)) {
      const literal = match[1];
      const fromCardKeys = match[2]
        ? CARD_KEYS[match[2] as keyof typeof CARD_KEYS]
        : undefined;
      const key = literal ?? fromCardKeys;
      if (key) {
        keys.add(key.toLowerCase());
      }
    }
  }
  return keys;
}

const press = (
  key: string,
  modifiers: Partial<
    Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>
  > = {}
) =>
  cardKeyAction({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });

describe("TW-SHORTCUTS keyboard shortcuts (12 §2.2, 06 §10)", () => {
  it("TW-SHORTCUTS every single-letter <Kbd> hint in the app has a registered handler", () => {
    const registered = registeredKeys();
    const cardKeys = new Set(
      Object.values(CARD_KEYS).map((key) => key.toLowerCase())
    );
    const missing: string[] = [];
    for (const file of files(SRC)) {
      for (const match of readFileSync(file, "utf8").matchAll(KBD_HINT_RE)) {
        const hint = (match[1] ?? "").trim();
        if (
          SINGLE_KEY_HINT_RE.test(hint) &&
          !registered.has(hint.toLowerCase()) &&
          !cardKeys.has(hint.toLowerCase())
        ) {
          missing.push(`${file.slice(SRC.length)}: ${hint}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("TW-SHORTCUTS the global navigation keys B / I / A / R / N / ? are registered", () => {
    const registered = registeredKeys();
    for (const key of ["b", "i", "a", "r", "n", "?", "/", "j", "k", "m", "y"]) {
      expect(registered.has(key), key).toBe(true);
    }
    expect(Object.keys(NAV_SHORTCUTS)).toEqual(["b", "i", "a", "r"]);
  });

  it("TW-SHORTCUTS sidebar hints match the navigation shortcuts", () => {
    for (const item of NAV_ITEMS) {
      if (item.shortcut) {
        const key = item.shortcut.toLowerCase() as keyof typeof NAV_SHORTCUTS;
        expect(NAV_SHORTCUTS[key], item.key).toBe(item.href);
      }
    }
  });

  it("TW-SHORTCUTS every aria-keyshortcuts single key is a known shortcut", () => {
    const known = new Set(
      SHORTCUTS.flatMap((entry) => entry.keys.map((key) => key.toLowerCase()))
    );
    for (const file of files(SRC)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        KEYSHORTCUTS_RE
      )) {
        for (const key of (match[1] ?? "").split(" ")) {
          if (key.length === 1) {
            expect(known.has(key.toLowerCase()), `${file}: ${key}`).toBe(true);
          }
        }
      }
    }
  });

  it("TW-SHORTCUTS a focused card maps its keys to actions; modifiers never trigger them", () => {
    expect(press("Enter")).toEqual({ kind: "open" });
    expect(press("ArrowLeft")).toEqual({ kind: "focus", direction: "left" });
    expect(press("ArrowDown")).toEqual({ kind: "focus", direction: "down" });
    expect(press("m")).toEqual({ kind: "move" });
    expect(press("M")).toEqual({ kind: "move" });
    expect(press("e")).toEqual({ kind: "archive" });
    expect(press("x")).toEqual({ kind: "select" });
    expect(press("f")).toEqual({ kind: "followUp" });
    expect(press("r")).toEqual({ kind: "stage", stage: "rejected" });
    expect(press("w")).toEqual({ kind: "stage", stage: "withdrawn" });
    expect(press("1")).toEqual({ kind: "stage", stage: "saved" });
    expect(press("4")).toEqual({ kind: "stage", stage: "applied" });
    expect(press("7")).toEqual({ kind: "stage", stage: "accepted" });
    expect(press("8")).toBeNull();
    expect(press(" ")).toBeNull();
    expect(press("k", { metaKey: true })).toBeNull();
    expect(press("r", { ctrlKey: true })).toBeNull();
    expect(press("?", { shiftKey: true })).toBeNull();
    expect(press("b")).toBeNull();
  });

  it("TW-SHORTCUTS the ? sheet lists every card action", () => {
    const actions = new Set(
      SHORTCUTS.filter((entry) => entry.scope === "card").map(
        (entry) => entry.action
      )
    );
    for (const action of [
      "open",
      "pickUp",
      "move",
      "moveToStage",
      "reject",
      "withdraw",
      "archive",
      "select",
      "followUp",
      "columns",
      "cards",
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
  });
});
