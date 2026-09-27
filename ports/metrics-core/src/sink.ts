import type { LabelSet } from "./counter"

export interface CounterRecord {
  readonly name: string
  readonly labels: LabelSet
  readonly value: number
  /** Epoch millis. */
  readonly time: number
}

export interface MetricSink {
  /** Fire and forget. Must not throw, must not block, and must not mutate `record`. */
  add(record: CounterRecord): void
}
