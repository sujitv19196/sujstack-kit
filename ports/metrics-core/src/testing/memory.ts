import type { CounterRecord, MetricSink } from "../sink"

export interface MemorySink extends MetricSink {
  added(): readonly CounterRecord[]
}

/** A test double. Nothing would run this in development or production. */
export function createMemorySink(): MemorySink {
  const records: CounterRecord[] = []

  return {
    add(record: CounterRecord): void {
      records.push(record)
    },

    added(): readonly CounterRecord[] {
      return [...records]
    },
  }
}
