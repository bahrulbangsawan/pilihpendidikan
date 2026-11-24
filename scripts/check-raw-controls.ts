#!/usr/bin/env bun
/**
 * Raw control check (TYPOGRAPHY.md § Raw controls).
 *
 * App code builds its controls from `@rulisme/ui` (Button, Input, Textarea,
 * Select, Combobox, DatePicker, FileTrigger, SegmentedControl, SwatchPicker,
 * FieldButton, BadgeButton, DragHandle, EditableTitle …), never from raw
 * <button>, <input>, <select>, <textarea> or <option> elements. This walks
 * the JSX of every app's `src/` (tests, generated routes and print documents
 * left out) and reports each raw control, with two allowed shapes:
 *
 * - the child of an element that carries `asChild` (a design-system
 *   component such as Item, BubbleContent or SidebarMenuSubButton styles it
 *   through Radix Slot; the element only supplies the semantics), unless that
 *   element is a `*Trigger`, which forwards behaviour and styles nothing;
 * - `<input type="hidden">`, which renders nothing.
 *
 * Usage: bun scripts/check-raw-controls.ts <dir> [<dir> …]
 * Prints `file:line:col: raw <tag>` per hit; exits 1 when there is any.
 */

import { parse } from "@babel/parser";
import type { JSXElement, Node } from "@babel/types";
import { isNode, VISITOR_KEYS } from "@babel/types";
import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAW_TAGS = new Set(["button", "input", "select", "textarea", "option"]);

// Print documents render no controls, but they are not app chrome either.
const SKIP_FILE = [
  /\.test\.tsx?$/,
  /\.test-utils\.tsx?$/,
  /routeTree\.gen\.ts$/,
  /\/cv\/src\/components\/templates\//,
  /\/invoice\/src\/components\/invoice-preview\.tsx$/,
  /\/portfolio\/src\/components\/portfolio-preview\.tsx$/,
  /-pdf\.tsx$/,
];

function tagName(element: JSXElement): string | undefined {
  const { name } = element.openingElement;
  return name.type === "JSXIdentifier" ? name.name : undefined;
}

function hasAttribute(element: JSXElement, attribute: string): boolean {
  return element.openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === attribute
  );
}

function isHiddenInput(element: JSXElement): boolean {
  return element.openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.name === "type" &&
      attr.value?.type === "StringLiteral" &&
      attr.value.value === "hidden"
  );
}

let violations = 0;

function isAllowed(element: JSXElement, parent: JSXElement | undefined) {
  if (tagName(element) === "input" && isHiddenInput(element)) {
    return true;
  }
  if (!parent) {
    return false;
  }
  // A Trigger's asChild only forwards behaviour; it styles nothing.
  return (
    hasAttribute(parent, "asChild") &&
    !(tagName(parent) ?? "").endsWith("Trigger")
  );
}

function report(
  element: JSXElement,
  parent: JSXElement | undefined,
  file: string
) {
  const tag = tagName(element);
  if (!(tag && RAW_TAGS.has(tag)) || isAllowed(element, parent)) {
    return;
  }
  const { line, column } = element.loc?.start ?? { line: 1, column: 0 };
  process.stdout.write(`${file}:${line}:${column + 1}: raw <${tag}>\n`);
  violations++;
}

function visit(node: Node, parent: JSXElement | undefined, file: string) {
  let nextParent = parent;
  if (node.type === "JSXElement") {
    report(node, parent, file);
    nextParent = node;
  }
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const child: unknown = Reflect.get(node, key);
    const children = Array.isArray(child) ? child : [child];
    for (const item of children) {
      if (typeof item === "object" && item !== null && isNode(item)) {
        // Only a JSX element's own children count as "direct": an
        // expression container ({cond && <button/>}) keeps the parent.
        visit(item, nextParent, file);
      }
    }
  }
}

const roots = process.argv.slice(2);
for (const root of roots) {
  if (!existsSync(root)) {
    continue;
  }
  for (const rel of globSync("**/*.tsx", { cwd: root })) {
    const file = join(root, rel);
    if (SKIP_FILE.some((pattern) => pattern.test(file))) {
      continue;
    }
    const ast = parse(readFileSync(file, "utf8"), {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    visit(ast.program, undefined, file);
  }
}

process.exit(violations > 0 ? 1 : 0);
