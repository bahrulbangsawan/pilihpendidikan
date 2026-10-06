# Biome Code Standards

This project enforces the current **Ultracite core and React rules directly through Biome**, preserving strict code quality without the vulnerable wrapper dependency chain. The complete rules and project overrides live in `biome.jsonc`.

## Quick Reference

- **Format code**: `bun run fix`
- **Check for issues**: `bun run check`
- **Inspect configuration**: `bun x biome rage`

Biome provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Give every `<img>` explicit `width`/`height` (or an aspect-ratio box) to avoid layout shift

### Framework-Specific Guidance

**This workspace uses TanStack Router/Start + Cloudflare Workers — not Next.js.** Ignore Next.js / Solid / Svelte / Vue / Qwik rules from upstream Ultracite docs.

**TanStack Router + Start (`apps/cv`, `apps/invoice`, `apps/portfolio`):**

- File-based routes live in `apps/*/src/routes/`; `routeTree.gen.ts` is generated — never edit by hand
- Route-private modules start with `-` (`-root-components.tsx`, `-root-helpers.ts`) so the router ignores them
- Use `useNavigate` / `<Link>` from `@tanstack/react-router` for navigation

**Cloudflare Workers (every app, plus `apps/api`):**

- Bindings are declared in each `wrangler.jsonc`; runtime types come from `bun run cf-typegen` (`worker-configuration.d.ts`, generated and git-ignored)
- Secrets are managed with `bunx wrangler secret put` (prod) or `.dev.vars` (local) — never inline them in `wrangler.jsonc`

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`
- Pass `children` between tags, not via a `children` prop

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun run fix` before committing to ensure compliance.

---

## Browser Automation

Use **agent-browser** (CLI via Bash tool) as the default for all browser testing, screenshots, visual validation, and interaction. Do NOT use chrome-devtools MCP or claude-in-chrome MCP tools — use `agent-browser` commands instead.

```sh
# Basic workflow
agent-browser open http://localhost:3000
agent-browser snapshot -i          # accessibility tree with refs
agent-browser screenshot page.png  # capture screenshot
agent-browser click @e2            # interact via element ref
agent-browser console              # check JS console
agent-browser errors               # check page errors
agent-browser close                # clean up
```

See the root `CLAUDE.md` for the full command reference table and `agent-browser.json` for project config.

### Dogfood Skill

The `dogfood` skill (`.claude/skills/dogfood`) enables systematic QA testing. Trigger with prompts like:

- `dogfood http://localhost:3000`
- `QA http://localhost:3000 — focus on the booking page`
- `find issues on http://localhost:3000`

Always use `agent-browser` directly — never `npx agent-browser` (slow Node.js path vs fast Rust binary).
