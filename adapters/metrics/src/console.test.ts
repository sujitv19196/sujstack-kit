import { expect, spyOn, test } from "bun:test"
import type { CounterRecord } from "@sujstack/metrics-core"
import { createConsoleSink } from "./console"

const record = (labels: CounterRecord["labels"]): CounterRecord => ({
  name: "test.calls",
  labels,
  value: 2,
  time: Date.UTC(2026, 0, 2, 14, 23, 7, 412),
})

test("prints the name, increment and labels", () => {
  const spy = spyOn(console, "info").mockImplementation(() => {})
  try {
    createConsoleSink().add(record({ outcome: "ok" }))
    expect(spy.mock.calls[0]).toEqual(["14:23:07.412 METRIC test.calls +2", { outcome: "ok" }])
  } finally {
    spy.mockRestore()
  }
})

test("empty labels are not printed", () => {
  const spy = spyOn(console, "info").mockImplementation(() => {})
  try {
    createConsoleSink().add(record({}))
    expect(spy.mock.calls[0]).toEqual(["14:23:07.412 METRIC test.calls +2"])
  } finally {
    spy.mockRestore()
  }
})
