import { expect, test } from "bun:test"
import { createLog } from "./log"
import type { EventSink } from "./sink"
import { createMemorySink } from "./testing/memory"

test("every sink receives the record", () => {
  const first = createMemorySink()
  const second = createMemorySink()

  createLog([first, second]).info("test.thing", { count: 1 })

  expect(first.written()).toMatchObject([
    { message: "test.thing", level: "info", fields: { count: 1 } },
  ])
  expect(second.written()).toHaveLength(1)
})

test("a non-error record carries no cause property at all", () => {
  const sink = createMemorySink()

  createLog([sink]).warn("test.thing")

  expect(sink.written()[0]).not.toHaveProperty("cause")
})

test("a throwing sink neither stops the next one nor flattens the cause", () => {
  const working = createMemorySink()
  const broken: EventSink = {
    write() {
      throw new Error("sink is down")
    },
  }
  const boom = new Error("outer", { cause: new Error("inner") })

  createLog([broken, working]).error("test.thing", boom)

  expect(working.written()[0]?.cause).toBe(boom)
})
