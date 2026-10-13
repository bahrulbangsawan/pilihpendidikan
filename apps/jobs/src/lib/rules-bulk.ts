// Bulk Enable / Disable on the rules table (12 §6.2): which selected rules a
// bulk switch leaves alone. Turning an `auto` rule on always needs its own
// `rule_activation` with the rule's name typed (19 §8.3, D-35), so a bulk
// Enable never touches one; it is reported as skipped instead.

import type { AutomationRuleRecord } from "@pilihpendidikan/jobs-contracts/records";

export type BulkRuleSkip =
  | "already_on"
  | "already_off"
  | "needs_activation"
  | "expired";

export function bulkEnableSkip(
  rule: Pick<AutomationRuleRecord, "enabled" | "mode" | "limits">,
  nowMs: number
): BulkRuleSkip | null {
  if (rule.enabled) {
    return "already_on";
  }
  if (rule.mode === "auto") {
    return "needs_activation";
  }
  const expiresAt = rule.limits.expires_at ?? null;
  if (expiresAt !== null && expiresAt <= nowMs) {
    return "expired";
  }
  return null;
}

export function bulkDisableSkip(
  rule: Pick<AutomationRuleRecord, "enabled">
): BulkRuleSkip | null {
  return rule.enabled ? null : "already_off";
}
