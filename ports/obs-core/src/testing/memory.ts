import type { EventRecord, EventSink } from "../sink"

export interface MemorySink extends EventSink {
  written(): readonly EventRecord[]
}

/** A test double. Nothing would run this in development or production. */
export function createMemorySink(): MemorySink {
  const records: EventRecord[] = []

  return {
    write(record: EventRecord): void {
      records.push(record)
    },

    written(): readonly EventRecord[] {
      return [...records]
    },
  }
}
