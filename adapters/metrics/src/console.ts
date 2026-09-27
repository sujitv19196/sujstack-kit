import type { CounterRecord, MetricSink } from "@sujstack/metrics-core"

/** "14:23:07.412" in UTC. */
const clock = (time: number): string => new Date(time).toISOString().slice(11, 23)

export function createConsoleSink(): MetricSink {
  return {
    add(record: CounterRecord): void {
      const head = `${clock(record.time)} METRIC ${record.name} +${record.value}`
      if (Object.keys(record.labels).length > 0) console.info(head, record.labels)
      else console.info(head)
    },
  }
}
