import { describe, expect, it } from "bun:test";
import type { KvKey, KvStore } from "./cloudflare";
import { migrateCvKv } from "./migrate-cv-kv";

interface FakeStore extends KvStore {
  data: Map<string, { value: string; metadata?: unknown }>;
  writes: number;
}

function fakeStore(
  seed: Record<string, { value: string; metadata?: unknown }> = {}
): FakeStore {
  const data = new Map(Object.entries(seed));
  const store: FakeStore = {
    data,
    writes: 0,
    listKeys(prefix: string): Promise<KvKey[]> {
      return Promise.resolve(
        [...data.entries()]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, entry]) => ({ name, metadata: entry.metadata }))
      );
    },
    get(key: string) {
      return Promise.resolve(data.get(key)?.value ?? null);
    },
    putMany(entries) {
      for (const entry of entries) {
        store.writes += 1;
        data.set(entry.key, { value: entry.value, metadata: entry.metadata });
      }
      return Promise.resolve();
    },
  };
  return store;
}

function sourceFixture() {
  return fakeStore({
    "cv:alice": {
      value: '{"personalInfo":{"fullName":"Alice"}}',
      metadata: { fullName: "Alice", jobTitle: "" },
    },
    "owner:cv:alice": { value: "alice@example.com" },
    "cv:legacy": { value: '{"personalInfo":{"fullName":"Old"}}' },
    // Auth state lives in the same namespace and must never be copied.
    "auth:session:abc": { value: '{"email":"alice@example.com"}' },
    "oauth:code:xyz": { value: "{}" },
  });
}

describe("migrate-cv-kv", () => {
  it("dry run reports the plan and writes nothing anywhere", async () => {
    const source = sourceFixture();
    const dest = fakeStore();
    const before = JSON.stringify([...source.data]);
    const report = await migrateCvKv({ source, dest, execute: false });
    expect(report.mode).toBe("dry-run");
    expect(report.documents).toBe(2);
    expect(report.ownerStamps).toBe(1);
    expect(report.unowned).toEqual(["legacy"]);
    expect(report.copied).toBe(0);
    expect(dest.writes).toBe(0);
    expect(dest.data.size).toBe(0);
    expect(source.writes).toBe(0);
    expect(JSON.stringify([...source.data])).toBe(before);
  });

  it("--execute copies only cv:* and owner:cv:* with metadata, verifies, keeps the source", async () => {
    const source = sourceFixture();
    const dest = fakeStore();
    const report = await migrateCvKv({ source, dest, execute: true });
    expect(report.copied).toBe(3);
    expect(report.verified).toBe(3);
    expect(report.mismatches).toEqual([]);
    expect([...dest.data.keys()].sort()).toEqual([
      "cv:alice",
      "cv:legacy",
      "owner:cv:alice",
    ]);
    expect(dest.data.get("cv:alice")?.metadata).toEqual({
      fullName: "Alice",
      jobTitle: "",
    });
    expect(source.writes).toBe(0);
    expect(source.data.size).toBe(5);
  });

  it("is re-runnable and refuses to overwrite a different destination value", async () => {
    const source = sourceFixture();
    const dest = fakeStore();
    await migrateCvKv({ source, dest, execute: true });
    const again = await migrateCvKv({ source, dest, execute: true });
    expect(again.conflicts).toEqual([]);
    expect(again.verified).toBe(3);

    const diverged = fakeStore({ "cv:alice": { value: "{}" } });
    const dry = await migrateCvKv({ source, dest: diverged, execute: false });
    expect(dry.conflicts).toEqual(["cv:alice"]);
    await expect(
      migrateCvKv({ source, dest: diverged, execute: true })
    ).rejects.toThrow("Refusing to overwrite");
    expect(diverged.writes).toBe(0);

    const synced = await migrateCvKv({
      source,
      dest: diverged,
      execute: true,
      overwrite: true,
    });
    expect(synced.verified).toBe(3);
    expect(diverged.data.get("cv:alice")?.value).toBe(
      source.data.get("cv:alice")?.value
    );
    expect(source.writes).toBe(0);
  });
});
