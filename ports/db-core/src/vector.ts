export type DistanceMetric = "cosine" | "euclidean" | "dot"

export type VectorMetadata = Record<string, unknown>

export interface VectorRecord<M extends VectorMetadata> {
  readonly id: string
  readonly vector: number[]
  /** Pass `{}` for none. */
  readonly metadata: M
}

export type EqualityFilter<M> = Partial<Record<Extract<keyof M, string>, string | number | boolean>>

export type VectorInclude = "metadata" | "metadata-and-vector"

export interface VectorQuery<M extends VectorMetadata> {
  readonly vector: number[]
  readonly topK: number
  readonly include: VectorInclude
  /** Absent matches everything. */
  readonly filter?: EqualityFilter<M>
}

export interface VectorMatch<M extends VectorMetadata> {
  readonly id: string
  /** Higher is more similar, for every metric. Adapters normalise to this. */
  readonly score: number
  readonly metadata: M
}

export interface VectorMatchWithVector<M extends VectorMetadata> extends VectorMatch<M> {
  readonly vector: number[]
}

export interface VectorStoreInfo {
  readonly dimensions: number
  readonly count: number
  readonly metric: DistanceMetric
}

export interface VectorStore<M extends VectorMetadata = VectorMetadata> {
  upsert(records: VectorRecord<M>[]): Promise<void>

  query(query: VectorQuery<M> & { include: "metadata" }): Promise<VectorMatch<M>[]>
  query(
    query: VectorQuery<M> & { include: "metadata-and-vector" },
  ): Promise<VectorMatchWithVector<M>[]>

  fetch(ids: string[]): Promise<VectorMatch<M>[]>
  delete(ids: string[]): Promise<void>
  describe(): Promise<VectorStoreInfo>
  close(): Promise<void>
}

export interface VectorStoreConfig {
  readonly dimensions: number
  readonly metric: DistanceMetric
}

export type VectorFactory = <M extends VectorMetadata>(config: VectorStoreConfig) => VectorStore<M>

export class VectorDimensionMismatchError extends Error {
  constructor(context: string, expected: number, received: number) {
    super(`${context}: expected ${expected}-dimensional vector, received ${received}.`)
    this.name = "VectorDimensionMismatchError"
  }
}
