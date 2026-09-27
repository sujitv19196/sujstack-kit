import type { Catalog, LabelsOf } from "./counter"
import type { CounterRecord, MetricSink } from "./sink"

export interface Metrics<C extends Catalog> {
  /** A negative or non-finite `by` is dropped: counters only go up. */
  increment<K extends keyof C & string>(key: K, labels: LabelsOf<C[K]>, by?: number): void
}

export function createMetrics<C extends Catalog>(
  _catalog: C,
  sinks: readonly MetricSink[],
): Metrics<C> {
  return {
    increment(key, labels, by = 1) {
      if (!Number.isFinite(by) || by < 0) return

      const record: CounterRecord = { name: key, labels, value: by, time: Date.now() }

      for (const sink of sinks) {
        try {
          sink.add(record)
        } catch {
          // Same isolation as createLog: a broken sink fails neither the caller nor its neighbours.
        }
      }
    },
  }
}
