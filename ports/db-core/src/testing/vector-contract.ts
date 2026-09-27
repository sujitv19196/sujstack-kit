import { describe, expect, test } from "bun:test"
import { VectorDimensionMismatchError, type VectorFactory, type VectorStore } from "../vector"

interface Doc extends Record<string, unknown> {
  readonly source: string
  readonly text: string
}

/** Runs the VectorStore contract against an adapter. */
export function runVectorContract(name: string, factory: VectorFactory): void {
  describe(`VectorStore contract: ${name}`, () => {
    const withStore = async (body: (store: VectorStore<Doc>) => Promise<void>) => {
      const store = factory<Doc>({ dimensions: 3, metric: "cosine" })
      try {
        await body(store)
      } finally {
        await store.close()
      }
    }

    const seed = async (store: VectorStore<Doc>) => {
      await store.upsert([
        { id: "a", vector: [1, 0, 0], metadata: { source: "docs", text: "alpha" } },
        { id: "b", vector: [0, 1, 0], metadata: { source: "docs", text: "beta" } },
        { id: "c", vector: [0, 0, 1], metadata: { source: "blog", text: "gamma" } },
      ])
    }

    test("ranks the nearest vector first", async () => {
      await withStore(async (store) => {
        await seed(store)
        const matches = await store.query({
          vector: [0.9, 0.1, 0],
          topK: 3,
          include: "metadata",
        })
        expect(matches[0]?.id).toBe("a")
        expect(matches).toHaveLength(3)
      })
    })

    test("scores are ordered highest-first regardless of metric", async () => {
      for (const metric of ["cosine", "euclidean", "dot"] as const) {
        const store = factory<Doc>({ dimensions: 3, metric })
        await store.upsert([
          { id: "near", vector: [1, 0, 0], metadata: { source: "s", text: "near" } },
          { id: "far", vector: [0, 0, 1], metadata: { source: "s", text: "far" } },
        ])
        const matches = await store.query({ vector: [1, 0, 0], topK: 2, include: "metadata" })
        expect(matches.map((m) => m.id)).toEqual(["near", "far"])
        const scores = matches.map((m) => m.score)
        expect(scores).toEqual([...scores].sort((a, b) => b - a))
        await store.close()
      }
    })

    test("topK caps the number of results", async () => {
      await withStore(async (store) => {
        await seed(store)
        expect(await store.query({ vector: [1, 0, 0], topK: 2, include: "metadata" })).toHaveLength(
          2,
        )
      })
    })

    test("include: metadata omits vectors; metadata-and-vector returns them", async () => {
      await withStore(async (store) => {
        await seed(store)

        const bare = await store.query({ vector: [1, 0, 0], topK: 1, include: "metadata" })
        expect(bare[0]).not.toHaveProperty("vector")

        const full = await store.query({
          vector: [1, 0, 0],
          topK: 1,
          include: "metadata-and-vector",
        })
        expect(full[0]?.vector).toEqual([1, 0, 0])
      })
    })

    test("metadata round-trips intact", async () => {
      await withStore(async (store) => {
        await seed(store)
        const [match] = await store.query({ vector: [1, 0, 0], topK: 1, include: "metadata" })
        expect(match?.metadata).toEqual({ source: "docs", text: "alpha" })
      })
    })

    test("an equality filter restricts the candidate set", async () => {
      await withStore(async (store) => {
        await seed(store)
        const matches = await store.query({
          vector: [1, 0, 0],
          topK: 10,
          include: "metadata",
          filter: { source: "blog" },
        })
        expect(matches.map((m) => m.id)).toEqual(["c"])
      })
    })

    test("an absent filter matches everything", async () => {
      await withStore(async (store) => {
        await seed(store)
        expect(
          await store.query({ vector: [1, 0, 0], topK: 10, include: "metadata" }),
        ).toHaveLength(3)
      })
    })

    test("upsert replaces an existing id rather than duplicating it", async () => {
      await withStore(async (store) => {
        await seed(store)
        await store.upsert([
          { id: "a", vector: [1, 0, 0], metadata: { source: "docs", text: "alpha v2" } },
        ])
        expect((await store.describe()).count).toBe(3)
        const [match] = await store.fetch(["a"])
        expect(match?.metadata.text).toBe("alpha v2")
      })
    })

    test("fetch returns known ids and silently skips unknown ones", async () => {
      await withStore(async (store) => {
        await seed(store)
        expect((await store.fetch(["a", "nope", "c"])).map((m) => m.id)).toEqual(["a", "c"])
      })
    })

    test("delete removes records", async () => {
      await withStore(async (store) => {
        await seed(store)
        await store.delete(["a", "b"])
        expect((await store.describe()).count).toBe(1)
        expect(await store.fetch(["a"])).toEqual([])
      })
    })

    test("describe reports the configured dimensions and metric", async () => {
      await withStore(async (store) => {
        await seed(store)
        expect(await store.describe()).toEqual({ dimensions: 3, count: 3, metric: "cosine" })
      })
    })

    test("rejects vectors of the wrong dimensionality", async () => {
      await withStore(async (store) => {
        expect(
          store.upsert([{ id: "bad", vector: [1, 0], metadata: { source: "s", text: "t" } }]),
        ).rejects.toThrow(VectorDimensionMismatchError)

        expect(store.query({ vector: [1, 0], topK: 1, include: "metadata" })).rejects.toThrow(
          VectorDimensionMismatchError,
        )
      })
    })

    test("querying an empty store returns no matches", async () => {
      await withStore(async (store) => {
        expect(await store.query({ vector: [1, 0, 0], topK: 5, include: "metadata" })).toEqual([])
      })
    })
  })
}
