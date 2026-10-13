// `UserScope` — the isolation token of 04 §5 and 11 §6.1.
//
// Every exported repo function takes a `UserScope` and binds `scope.userId`
// into a `user_id = ?` predicate. The type is branded, so a plain object or a
// string cannot be passed where a scope is expected: it can only come from
//
//   - `scopeFromCaller(caller)` — after `resolveCaller` authenticated the
//     request (the router does this and exposes `c.scope`);
//   - `trustedScope(userId, origin)` — the queue consumer (the message's
//     `user_id`; the handler must load the referenced record WITH that user_id
//     before acting, 11 §6.1 rule 2), cron jobs iterating rows they selected
//     with a system statement, and scripts.

import type { ResolvedCaller } from "../../auth";

declare const USER_SCOPE: unique symbol;

export interface UserScope {
  readonly userId: string;
  readonly [USER_SCOPE]: true;
}

export type TrustedScopeOrigin = "queue" | "cron" | "script";

function makeScope(userId: string): UserScope {
  if (!userId.startsWith("usr_")) {
    throw new Error(`UserScope needs a usr_ id, got "${userId}"`);
  }
  return Object.freeze({ userId }) as UserScope;
}

/** The scope of an authenticated caller. */
export function scopeFromCaller(
  caller: Pick<ResolvedCaller, "userId">
): UserScope {
  return makeScope(caller.userId);
}

/**
 * A scope for server-side work that is not a request: queue messages, cron
 * jobs and scripts. The `origin` documents why the scope is trusted.
 */
export function trustedScope(
  userId: string,
  _origin: TrustedScopeOrigin
): UserScope {
  return makeScope(userId);
}
