import { expect, test } from "bun:test"
import { defineCatalog, defineCounter } from "./counter"
import { createMetrics } from "./metrics"
import type { MetricSink } from "./sink"
import { createMemorySink } from "./testing/memory"

const counters = defineCatalog({
  "test.calls": defineCounter<{ outcome: "ok" | "failed" }>({ description: "calls" }),
})

test("every sink receives the record", () => {
  const first = createMemorySink()
  const second = createMemorySink()

  createMetrics(counters, [first, second]).increment("test.calls", { outcome: "ok" }, 3)

  expect(first.added()).toMatchObject([{ name: "test.calls", labels: { outcome: "ok" }, value: 3 }])
  expect(second.added()).toHaveLength(1)
})

test("by defaults to one", () => {
  const sink = createMemorySink()

  createMetrics(counters, [sink]).increment("test.calls", { outcome: "ok" })

  expect(sink.added()[0]?.value).toBe(1)
})

test("a negative or non-finite increment is dropped", () => {
  const sink = createMemorySink()
  const metrics = createMetrics(counters, [sink])

  metrics.increment("test.calls", { outcome: "ok" }, -1)
  metrics.increment("test.calls", { outcome: "ok" }, Number.NaN)
  metrics.increment("test.calls", { outcome: "ok" }, Number.POSITIVE_INFINITY)

  expect(sink.added()).toHaveLength(0)
})

test("a throwing sink does not stop the next one", () => {
  const working = createMemorySink()
  const broken: MetricSink = {
    add() {
      throw new Error("sink is down")
    },
  }

  createMetrics(counters, [broken, working]).increment("test.calls", { outcome: "failed" })

  expect(working.added()).toHaveLength(1)
})
