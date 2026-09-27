import { describe, expect, test } from "bun:test"
import type { KeyValueStore, KvFactory } from "../kv"

/** Runs the KeyValueStore contract against an adapter. */
export function runKvContract(name: string, factory: KvFactory): void {
  describe(`KeyValueStore contract: ${name}`, () => {
    const withStore = async (body: (store: KeyValueStore) => Promise<void>) => {
      const store = factory()
      try {
        await body(store)
      } finally {
        await store.close()
      }
    }

    test("a miss reports found: false", async () => {
      await withStore(async (store) => {
        expect(await store.get("absent")).toEqual({ found: false })
      })
    })

    test("round-trips a value", async () => {
      await withStore(async (store) => {
        await store.set("greeting", { text: "hello" })
        expect(await store.get<{ text: string }>("greeting")).toEqual({
          found: true,
          value: { text: "hello" },
        })
      })
    })

    test("distinguishes a stored null from a miss", async () => {
      await withStore(async (store) => {
        await store.set<null>("explicit-null", null)
        expect(await store.get<null>("explicit-null")).toEqual({ found: true, value: null })
        expect(await store.get<null>("never-written")).toEqual({ found: false })
      })
    })

    test("set overwrites", async () => {
      await withStore(async (store) => {
        await store.set("k", 1)
        await store.set("k", 2)
        expect(await store.get<number>("k")).toEqual({ found: true, value: 2 })
      })
    })

    test("mget preserves order and marks misses in place", async () => {
      await withStore(async (store) => {
        await store.set("a", "A")
        await store.set("c", "C")
        expect(await store.mget<string>(["a", "b", "c"])).toEqual([
          { found: true, value: "A" },
          { found: false },
          { found: true, value: "C" },
        ])
      })
    })

    test("delete and has", async () => {
      await withStore(async (store) => {
        await store.set("k", "v")
        expect(await store.has("k")).toBe(true)
        await store.delete("k")
        expect(await store.has("k")).toBe(false)
        expect(await store.get("k")).toEqual({ found: false })
      })
    })

    test("deleting an absent key is a no-op, not an error", async () => {
      await withStore(async (store) => {
        await store.delete("never-existed")
      })
    })

    test("list returns all keys, or only those under a prefix", async () => {
      await withStore(async (store) => {
        await store.set("user:1", "a")
        await store.set("user:2", "b")
        await store.set("session:1", "c")
        expect((await store.list()).sort()).toEqual(["session:1", "user:1", "user:2"])
        expect((await store.list("user:")).sort()).toEqual(["user:1", "user:2"])
      })
    })

    test("clear erases only the given prefix", async () => {
      await withStore(async (store) => {
        await store.set("user:1", "a")
        await store.set("session:1", "c")
        await store.clear("user:")
        expect(await store.has("user:1")).toBe(false)
        expect(await store.has("session:1")).toBe(true)
      })
    })

    test("a value expires after its ttl", async () => {
      await withStore(async (store) => {
        await store.set("ephemeral", "value", 1)
        expect(await store.get<string>("ephemeral")).toEqual({ found: true, value: "value" })

        // TTL granularity is whole seconds, so this has to be a real wait.
        await Bun.sleep(1_200)

        expect(await store.get("ephemeral")).toEqual({ found: false })
        expect(await store.has("ephemeral")).toBe(false)
        expect(await store.list()).not.toContain("ephemeral")
      })
    })

    test("omitting ttl persists the value", async () => {
      await withStore(async (store) => {
        await store.set("permanent", "value")
        await Bun.sleep(50)
        expect(await store.get<string>("permanent")).toEqual({ found: true, value: "value" })
      })
    })
  })
}
