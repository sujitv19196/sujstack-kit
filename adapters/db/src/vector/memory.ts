import {
  type EqualityFilter,
  VectorDimensionMismatchError,
  type VectorMatch,
  type VectorMatchWithVector,
  type VectorMetadata,
  type VectorQuery,
  type VectorRecord,
  type VectorStore,
  type VectorStoreConfig,
  type VectorStoreInfo,
} from "@sujstack/db-core"

const dotProduct = (a: number[], b: number[]): number =>
  a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)

const magnitude = (a: number[]): number => Math.sqrt(dotProduct(a, a))

const euclideanDistance = (a: number[], b: number[]): number =>
  Math.sqrt(a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0))

/** Exact brute-force search over every stored record. */
export function createMemoryVectorStore<M extends VectorMetadata>(
  config: VectorStoreConfig,
): VectorStore<M> {
  const { dimensions, metric } = config
  const records = new Map<string, VectorRecord<M>>()

  const assertDimensions = (vector: number[], context: string): void => {
    if (vector.length !== dimensions) {
      throw new VectorDimensionMismatchError(context, dimensions, vector.length)
    }
  }

  /** Higher is more similar, per the VectorStore contract. */
  const similarity = (a: number[], b: number[]): number => {
    switch (metric) {
      case "dot":
        return dotProduct(a, b)
      case "cosine": {
        const scale = magnitude(a) * magnitude(b)
        return scale === 0 ? 0 : dotProduct(a, b) / scale
      }
      case "euclidean":
        // Invert the distance into (0, 1]; monotonic, so ranking is preserved.
        return 1 / (1 + euclideanDistance(a, b))
    }
  }

  const passesFilter = (metadata: M, filter?: EqualityFilter<M>): boolean => {
    if (!filter) return true
    return Object.entries(filter).every(
      ([key, expected]) => expected === undefined || metadata[key] === expected,
    )
  }

  function query(q: VectorQuery<M> & { include: "metadata" }): Promise<VectorMatch<M>[]>
  function query(
    q: VectorQuery<M> & { include: "metadata-and-vector" },
  ): Promise<VectorMatchWithVector<M>[]>
  async function query(q: VectorQuery<M>): Promise<VectorMatch<M>[] | VectorMatchWithVector<M>[]> {
    assertDimensions(q.vector, "query")

    const ranked = [...records.values()]
      .filter((record) => passesFilter(record.metadata, q.filter))
      .map((record) => ({
        id: record.id,
        score: similarity(q.vector, record.vector),
        metadata: record.metadata,
        vector: record.vector,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, q.topK))

    if (q.include === "metadata-and-vector") return ranked

    return ranked.map(({ id, score, metadata }) => ({ id, score, metadata }))
  }

  return {
    async upsert(incoming: VectorRecord<M>[]): Promise<void> {
      // Validate the whole batch before mutating, so a bad batch is atomic.
      for (const record of incoming) {
        assertDimensions(record.vector, `upsert of "${record.id}"`)
      }
      for (const record of incoming) {
        records.set(record.id, record)
      }
    },

    query,

    async fetch(ids: string[]): Promise<VectorMatch<M>[]> {
      return ids.flatMap((id) => {
        const record = records.get(id)
        if (!record) return []
        // A direct lookup is not ranked; score is self-similarity.
        return [{ id: record.id, score: 1, metadata: record.metadata }]
      })
    },

    async delete(ids: string[]): Promise<void> {
      for (const id of ids) records.delete(id)
    },

    async describe(): Promise<VectorStoreInfo> {
      return { dimensions, count: records.size, metric }
    },

    async close(): Promise<void> {
      records.clear()
    },
  }
}
