## Context

The AI assistant pipeline has three stages: mention extraction -> system prompt building -> action application. All three stages assume single-section focus, causing multi-section requests to silently degrade.

## Goals / Non-Goals

- Goals: Users can mention 2+ sections and have all of them filled in one AI response
- Goals: Existing single-section and @all flows continue to work identically
- Non-Goals: Parallel API calls (one per section) — deferred; single-response approach is sufficient
- Non-Goals: Streaming per-section UI indicators — out of scope

## Decisions

### Decision 1: Array-based section targeting

Change `buildSystemPrompt` parameter from `mentionedSection?: CVSectionKey` to `mentionedSections?: CVSectionKey[]`.

**Why:** Minimal change that naturally extends the existing single-section path. An array of length 1 behaves identically to the old single-section parameter.

**Alternatives considered:**

- Overloaded function signature (union type) — rejected, adds type complexity for no benefit
- Separate `buildMultiSectionPrompt` function — rejected, duplicates prompt logic

### Decision 2: Explicit multi-apply instruction in system prompt

Add a `MULTI-SECTION EDITING` block to the system prompt that explicitly instructs the AI to emit a separate `<apply>` block per section.

**Why:** LLMs follow explicit formatting instructions more reliably than implicit patterns. Without this, the AI may describe changes conversationally instead of using structured tags.

### Decision 3: Pure function extraction + accumulator pattern

Extract the `handleApplyAction` switch statement into a pure function `applyOneAction(data: CVData, action: ApplyAction): CVData`. The batch handler iterates actions over a local accumulator, then calls `setter` once.

**Why:** The current architecture calls `setter` per action, but React batches state updates — so `dataRef.current` is stale for the 2nd+ action. The accumulator pattern is the standard React fix for sequential state updates that depend on each other.

**Alternatives considered:**

- `useReducer` with action queue — viable but requires larger refactor of the component's state management; the ref-based approach is already established
- Functional updater `setter(prev => ...)` — would work if `onApply` supported it, but the prop is `(data: CVData) => void`, not a React setter

## Risks / Trade-offs

- **Risk:** AI model may still generate only one `<apply>` block despite instructions
  - Mitigation: The prompt explicitly says "MUST include a separate block for EACH section" with a concrete example
  - Mitigation: The `parseApplyTags` regex already handles multiple blocks correctly
- **Risk:** Changing `onApplyAction` callback type is a breaking internal API change
  - Mitigation: Only one consumer (`cv-assistant.tsx`) — trivial to update

## Open Questions

- None — all three bugs have clear, minimal fixes
