import { parse } from "@babel/parser";
import { isNode, VISITOR_KEYS } from "@babel/types";
import type { Node, ObjectProperty } from "@babel/types";
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const fontProperties: Record<string, boolean> = {
  fontFamily: true,
  fontSize: true,
  fontWeight: true,
};

function reportProperty(node: ObjectProperty, filename: string): number {
  const { key } = node;
  let name: string | undefined;
  if (key.type === "Identifier" && !node.computed) {
    name = key.name;
  } else if (key.type === "StringLiteral") {
    name = key.value;
  }
  if (!name || fontProperties[name] !== true) {
    return 0;
  }
  const line = node.loc?.start.line ?? 1;
  const column = (node.loc?.start.column ?? 0) + 1;
  process.stdout.write(`${filename}:${line}:${column}: inline ${name}\n`);
  return 1;
}

function inspectNode(value: unknown, filename: string): number {
  if (Array.isArray(value)) {
    let violations = 0;
    for (const child of value) {
      violations += inspectNode(child, filename);
    }
    return violations;
  }
  if (typeof value !== "object" || value === null || !isNode(value)) {
    return 0;
  }
  return visitNode(value, filename);
}

function visitNode(node: Node, filename: string): number {
  let violations =
    node.type === "ObjectProperty" ? reportProperty(node, filename) : 0;
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const child: unknown = Reflect.get(node, key);
    violations += inspectNode(child, filename);
  }
  return violations;
}

// @react-pdf/renderer documents (`*-pdf.tsx`) style text through StyleSheet
// objects: react-pdf has no className or Tailwind, so fontSize / fontFamily /
// fontWeight are the only way to set type in the exported PDF. They are print
// artifacts (TYPOGRAPHY.md § Exceptions), not DOM styles. The shared print
// fonts module (`packages/ui/src/print/pdf-fonts.ts`) lists the static Inter
// cuts for `Font.register`, whose `fontWeight` keys name a cut rather than
// style anything.
const REACT_PDF_IMPORT = /from\s+["']@react-pdf\/renderer["']/;
const PDF_DOCUMENT_FILE = /-pdf\.tsx$/;
const PRINT_FONTS_FILE = /\/print\/pdf-fonts\.ts$/;

function isReactPdfDocument(filename: string, source: string): boolean {
  return (
    (PDF_DOCUMENT_FILE.test(filename) && REACT_PDF_IMPORT.test(source)) ||
    PRINT_FONTS_FILE.test(filename)
  );
}

function inspectFile(filename: string): number {
  const source = readFileSync(filename, "utf8");
  if (isReactPdfDocument(filename, source)) {
    return 0;
  }
  const ast = parse(source, {
    plugins: filename.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
    sourceType: "unambiguous",
  });
  // OG JSX is serialized renderer input inside strings, not a DOM style object.
  // Traversing syntax retains checks on real objects and template interpolations.
  return visitNode(ast, filename);
}

let violations = 0;
const scopes = process.argv.slice(2);
for (const scope of scopes.length
  ? scopes
  : [
      "apps/home/src",
      "apps/cv/src",
      "apps/invoice/src",
      "apps/portfolio/src",
      "apps/design/src",
      "packages/ui/src",
    ]) {
  if (!existsSync(scope)) {
    continue;
  }
  if (statSync(scope).isFile()) {
    violations += inspectFile(scope);
    continue;
  }
  for (const filename of globSync("**/*.{ts,tsx}", { cwd: scope })) {
    if (filename === "routeTree.gen.ts") {
      continue;
    }
    violations += inspectFile(join(scope, filename));
  }
}
process.exitCode = violations ? 1 : 0;
