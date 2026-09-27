import type { EventRecord, EventSink } from "@sujstack/obs-core"

/** "14:23:07.412" in local time. */
const clock = (time: number): string => new Date(time).toISOString().slice(11, 23)

export function createConsoleSink(): EventSink {
  return {
    write(record: EventRecord): void {
      const head = `${clock(record.time)} ${record.level.toUpperCase().padEnd(5)} ${record.message}`
      const body = Object.keys(record.fields).length > 0 ? [record.fields] : []

      // The cause goes through as the raw value: the runtime prints Error chains and their
      // stacks natively, which is why nothing here serialises it.
      if ("cause" in record) console[record.level](head, ...body, record.cause)
      else console[record.level](head, ...body)
    },
  }
}
