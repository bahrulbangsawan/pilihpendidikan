// A small robots.txt matcher (RFC 9309) for the subrequests of a Browser
// Rendering render (job-tracker-spec/24 §4.4). The container decides whether
// the page itself may be fetched (the Python robots gate); this applies the
// same host's rules to everything the page's own scripts request, so a render
// never touches a path a crawler may not.
//
// Group selection: the group whose user-agent token is a prefix of our product
// token (`pilih-jobs`), else `*`. Within the group the longest matching rule
// wins, Allow wins a tie; `*` matches any run of characters and a trailing `$`
// anchors the end. No matching rule, or no robots.txt, allows.

interface Rule {
  allow: boolean;
  length: number;
  pattern: RegExp;
}

export interface RobotsRules {
  rules: Rule[];
}

const SPECIAL_RE = /[.+?^${}()|[\]\\]/g;
const LINE_SPLIT_RE = /\r?\n/;
const COMMENT_RE = /#.*$/;

function compile(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(SPECIAL_RE, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

interface Group {
  agents: string[];
  rules: Rule[];
}

function groupsOf(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(LINE_SPLIT_RE)) {
    const line = rawLine.replace(COMMENT_RE, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!(current && lastWasAgent)) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== "allow" && key !== "disallow")) {
      continue;
    }
    if (key === "disallow" && value === "") {
      continue; // "Disallow:" with no path allows everything
    }
    current.rules.push({
      allow: key === "allow",
      length: value.length,
      pattern: compile(value),
    });
  }
  return groups;
}

/** The rules that apply to `productToken` (e.g. "pilih-jobs"). */
export function parseRobots(
  text: string | null,
  productToken: string
): RobotsRules {
  if (!text) {
    return { rules: [] };
  }
  const token = productToken.toLowerCase();
  const groups = groupsOf(text);
  const specific = groups.filter((g) =>
    g.agents.some((agent) => agent !== "*" && token.startsWith(agent))
  );
  const chosen =
    specific.length > 0
      ? specific
      : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((g) => g.rules) };
}

/** Whether `pathAndQuery` (e.g. "/api/jobs?page=2") may be requested. */
export function robotsAllows(
  rules: RobotsRules,
  pathAndQuery: string
): boolean {
  let best: Rule | null = null;
  for (const rule of rules.rules) {
    if (!rule.pattern.test(pathAndQuery)) {
      continue;
    }
    if (
      best === null ||
      rule.length > best.length ||
      (rule.length === best.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best === null || best.allow;
}

/** The product token of a UA like "pilih-jobs/0.1.0 (+https://…)". */
export function productToken(userAgent: string): string {
  return userAgent.split("/")[0]?.trim() || userAgent;
}
