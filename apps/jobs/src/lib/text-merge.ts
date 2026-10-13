// Three-way merge of plain text (12 §11: notes are merged when possible,
// otherwise both versions are shown side by side). A diff3 over lines, or over
// words when every version is a single line: edits to different parts of the
// base merge; edits that touch the same part merge only when identical.

/** Above this many tokens per side the merge gives up (both versions shown). */
const MAX_TOKENS = 4000;
const WORD_SPLIT_RE = /(\s+)/;

interface Hunk {
  /** Exclusive end in base. */
  end: number;
  /** Replacement tokens. */
  lines: string[];
  /** Start in base. */
  start: number;
}

export type MergeResult = { ok: true; text: string } | { ok: false };

function tokenize(text: string, byLine: boolean): string[] {
  if (byLine) {
    return text.split("\n");
  }
  return text.split(WORD_SPLIT_RE).filter((token) => token.length > 0);
}

function detokenize(tokens: string[], byLine: boolean): string {
  return tokens.join(byLine ? "\n" : "");
}

/** The edits that turn `base` into `other`, as hunks over base positions. */
function diffHunks(base: string[], other: string[]): Hunk[] {
  const rows = base.length;
  const cols = other.length;
  const lcs: Int32Array[] = Array.from(
    { length: rows + 1 },
    () => new Int32Array(cols + 1)
  );
  for (let i = rows - 1; i >= 0; i--) {
    const row = lcs[i] as Int32Array;
    const below = lcs[i + 1] as Int32Array;
    for (let j = cols - 1; j >= 0; j--) {
      row[j] =
        base[i] === other[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && base[i] === other[j]) {
      if (current) {
        hunks.push(current);
        current = null;
      }
      i++;
      j++;
      continue;
    }
    current ??= { start: i, end: i, lines: [] };
    const insert =
      j < cols &&
      (i === rows ||
        ((lcs[i] as Int32Array)[j + 1] as number) >=
          ((lcs[i + 1] as Int32Array)[j] as number));
    if (insert) {
      current.lines.push(other[j] as string);
      j++;
    } else {
      i++;
      current.end = i;
    }
  }
  if (current) {
    hunks.push(current);
  }
  return hunks;
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

function hunksTouch(a: Hunk, b: Hunk): boolean {
  if (a.start === b.start) {
    return true;
  }
  if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) {
    return true;
  }
  const aInsideB = a.start === a.end && b.start < a.start && a.start < b.end;
  const bInsideA = b.start === b.end && a.start < b.start && b.start < a.end;
  return aInsideB || bInsideA;
}

function sameHunk(a: Hunk, b: Hunk): boolean {
  return a.start === b.start && a.end === b.end && sameTokens(a.lines, b.lines);
}

/** Merges `mine` and `theirs`, both edited from `base`. */
export function mergeText(
  base: string,
  mine: string,
  theirs: string
): MergeResult {
  if (mine === theirs || theirs === base) {
    return { ok: true, text: mine };
  }
  if (mine === base) {
    return { ok: true, text: theirs };
  }
  const byLine = [base, mine, theirs].some((text) => text.includes("\n"));
  const baseTokens = tokenize(base, byLine);
  const mineTokens = tokenize(mine, byLine);
  const theirTokens = tokenize(theirs, byLine);
  if (
    Math.max(baseTokens.length, mineTokens.length, theirTokens.length) >
    MAX_TOKENS
  ) {
    return { ok: false };
  }
  const ours = diffHunks(baseTokens, mineTokens);
  const others = diffHunks(baseTokens, theirTokens);
  const output: string[] = [];
  let position = 0;
  let a = 0;
  let b = 0;
  while (a < ours.length || b < others.length) {
    const mineHunk = ours[a];
    const theirHunk = others[b];
    let next: Hunk;
    if (mineHunk && theirHunk && hunksTouch(mineHunk, theirHunk)) {
      if (!sameHunk(mineHunk, theirHunk)) {
        return { ok: false };
      }
      next = mineHunk;
      a++;
      b++;
    } else if (mineHunk && (!theirHunk || mineHunk.start < theirHunk.start)) {
      next = mineHunk;
      a++;
    } else {
      next = theirHunk as Hunk;
      b++;
    }
    output.push(...baseTokens.slice(position, next.start), ...next.lines);
    position = next.end;
  }
  output.push(...baseTokens.slice(position));
  return { ok: true, text: detokenize(output, byLine) };
}
