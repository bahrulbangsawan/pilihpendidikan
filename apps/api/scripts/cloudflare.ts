// Small storage interfaces the migration scripts are written against, plus
// their Cloudflare REST implementations. The scripts never call wrangler or
// the API directly, so tests drive them with in-memory fakes and can prove a
// dry run performs no writes.
//
// Credentials come from the environment only:
//   CLOUDFLARE_ACCOUNT_ID   account that owns both the old and new resources
//   CLOUDFLARE_API_TOKEN    token with Workers KV Storage:Edit and D1:Edit

export interface KvKey {
  name: string;
  metadata?: unknown;
}

export interface KvValue {
  value: string;
  metadata?: unknown;
}

export interface KvStore {
  listKeys(prefix: string): Promise<KvKey[]>;
  get(key: string): Promise<string | null>;
  putMany(
    entries: Array<{ key: string; value: string; metadata?: unknown }>
  ): Promise<void>;
}

export interface SqlStore {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

const API_BASE = "https://api.cloudflare.com/client/v4";
const BULK_CHUNK = 100;

export interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
}

export function credentialsFromEnv(): CloudflareCredentials {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
  if (!(accountId && apiToken)) {
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to reach the Cloudflare API."
    );
  }
  return { accountId, apiToken };
}

interface ApiEnvelope<T> {
  success: boolean;
  errors?: Array<{ message: string }>;
  result: T;
  result_info?: { cursor?: string };
}

async function api<T>(
  creds: CloudflareCredentials,
  path: string,
  init: RequestInit = {}
): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${creds.apiToken}`);
  const res = await fetch(`${API_BASE}/accounts/${creds.accountId}${path}`, {
    ...init,
    headers,
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!(res.ok && body.success)) {
    const reason = body.errors?.map((e) => e.message).join("; ") ?? res.status;
    throw new Error(`Cloudflare API ${path} failed: ${reason}`);
  }
  return body;
}

export function cloudflareKv(
  creds: CloudflareCredentials,
  namespaceId: string
): KvStore {
  const base = `/storage/kv/namespaces/${namespaceId}`;
  return {
    async listKeys(prefix) {
      const keys: KvKey[] = [];
      let cursor = "";
      do {
        const query = new URLSearchParams({ prefix, limit: "1000" });
        if (cursor) {
          query.set("cursor", cursor);
        }
        const page = await api<KvKey[]>(creds, `${base}/keys?${query}`);
        keys.push(...page.result);
        cursor = page.result_info?.cursor ?? "";
      } while (cursor);
      return keys;
    },
    async get(key) {
      const res = await fetch(
        `${API_BASE}/accounts/${creds.accountId}${base}/values/${encodeURIComponent(key)}`,
        { headers: { Authorization: `Bearer ${creds.apiToken}` } }
      );
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`KV read of ${key} failed with ${res.status}`);
      }
      return await res.text();
    },
    async putMany(entries) {
      for (let i = 0; i < entries.length; i += BULK_CHUNK) {
        const chunk = entries.slice(i, i + BULK_CHUNK);
        await api<unknown>(creds, `${base}/bulk`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            chunk.map((e) => ({
              key: e.key,
              value: e.value,
              ...(e.metadata === undefined ? {} : { metadata: e.metadata }),
            }))
          ),
        });
      }
    },
  };
}

export function cloudflareD1(
  creds: CloudflareCredentials,
  databaseId: string
): SqlStore {
  const path = `/d1/database/${databaseId}/query`;
  const exec = async <T>(sql: string, params: unknown[] = []) => {
    const body = await api<Array<{ results: T[] }>>(creds, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    return body.result[0]?.results ?? [];
  };
  return {
    query: exec,
    async run(sql, params) {
      await exec(sql, params);
    },
  };
}

// `--name value` / `--flag` argument reader for the CLIs.
export function readArgs(argv: string[]) {
  return {
    has: (flag: string) => argv.includes(flag),
    value: (flag: string): string | undefined => {
      const index = argv.indexOf(flag);
      return index === -1 ? undefined : argv[index + 1];
    },
    values: (flag: string): string[] =>
      argv.flatMap((arg, i) =>
        arg === flag && argv[i + 1] ? [argv[i + 1]] : []
      ),
  };
}
