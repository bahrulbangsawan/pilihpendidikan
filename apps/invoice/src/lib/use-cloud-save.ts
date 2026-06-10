import { useCallback, useEffect, useRef, useState } from "react"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

interface Auth {
  email: string
  isAdmin: boolean
}

interface UseCloudSaveOptions<T> {
  /** Base origin of the mcp API (dev: localhost:8787, prod: mcp.bahrul.me). */
  apiBase: string
  /** The document slug from `?cv=`/`?invoice=`; undefined when scratch-editing. */
  id: string | undefined
  /** Resource family — selects the KV namespace + endpoint on the server. */
  resource: "cv" | "invoice"
  /**
   * Restore the last server-confirmed document. Called when a persistence
   * attempt fails so the optimistic edit is rolled back. Pass the state setter.
   */
  onRollback: (data: T) => void
}

/**
 * Owner-authenticated optimistic persistence for the public document viewers.
 *
 * The viewer applies edits to local state instantly (optimistic), then calls
 * `scheduleSave(next)`. This hook debounces a `PUT /api/<resource>/<id>` with a
 * `Bearer` token, and on failure invokes `onRollback` with the last
 * server-confirmed document and surfaces an error. The server is authoritative:
 * it enforces ownership from the `owner:*` stamp and a non-owner gets a 403,
 * after which editing is disabled (`canEdit` → false).
 *
 * The token is the user's personal mcp token (generated at mcp.bahrul.me),
 * persisted in localStorage. Cross-subdomain cookies don't apply, so the bearer
 * header is the credential the cross-origin PUT carries.
 */
export function useCloudSave<T>({
  apiBase,
  id,
  resource,
  onRollback,
}: UseCloudSaveOptions<T>) {
  const storageKey = `${resource}-mcp-token`
  const [token, setTokenState] = useState<string | null>(null)
  const [auth, setAuth] = useState<Auth | null>(null)
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef<T | null>(null)

  // Hydrate the token from localStorage on mount (SSR-safe — window only here).
  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    const stored = window.localStorage.getItem(storageKey)
    if (stored) {
      setTokenState(stored)
    }
  }, [storageKey])

  // Resolve the token to an identity so the UI can show "signed in as …" and
  // gate the edit affordance. A `false` response just means anonymous.
  useEffect(() => {
    if (!token) {
      setAuth(null)
      return
    }
    let cancelled = false
    fetch(`${apiBase}/api/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json() as Promise<{ authenticated: boolean } & Auth>)
      .then((data) => {
        if (cancelled) {
          return
        }
        setAuth(
          data.authenticated
            ? { email: data.email, isAdmin: data.isAdmin }
            : null
        )
      })
      .catch(() => {
        if (!cancelled) {
          setAuth(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, apiBase])

  const setToken = useCallback(
    (next: string) => {
      const value = next.trim()
      if (typeof window !== "undefined") {
        if (value) {
          window.localStorage.setItem(storageKey, value)
        } else {
          window.localStorage.removeItem(storageKey)
        }
      }
      setTokenState(value || null)
      setForbidden(false)
      setError(null)
      setStatus("idle")
    },
    [storageKey]
  )

  // Establish the rollback baseline (call after the initial document load and
  // whenever the server confirms a save).
  const markSaved = useCallback((data: T) => {
    lastSaved.current = data
  }, [])

  const canEdit = Boolean(id && auth && !forbidden)

  const scheduleSave = useCallback(
    (next: T) => {
      if (!(canEdit && token && id)) {
        return
      }
      if (timer.current) {
        clearTimeout(timer.current)
      }
      setStatus("saving")
      setError(null)
      timer.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `${apiBase}/api/${resource}/${encodeURIComponent(id)}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(next),
            }
          )
          if (res.ok) {
            lastSaved.current = next
            setStatus("saved")
            return
          }
          // Persistence failed — roll the optimistic edit back to the last
          // server-confirmed document and surface why.
          if (lastSaved.current !== null) {
            onRollback(lastSaved.current)
          }
          if (res.status === 401) {
            setAuth(null)
            setError("Session expired — re-enter your token to save.")
          } else if (res.status === 403) {
            setForbidden(true)
            setError("You don't have permission to edit this document.")
          } else {
            setError(`Save failed (${res.status}). Your change was reverted.`)
          }
          setStatus("error")
        } catch {
          if (lastSaved.current !== null) {
            onRollback(lastSaved.current)
          }
          setStatus("error")
          setError(
            "Save failed — check your connection. Your change was reverted."
          )
        }
      }, 800)
    },
    [apiBase, id, resource, token, canEdit, onRollback]
  )

  return {
    auth,
    status,
    error,
    canEdit,
    hasToken: Boolean(token),
    setToken,
    markSaved,
    scheduleSave,
  }
}
