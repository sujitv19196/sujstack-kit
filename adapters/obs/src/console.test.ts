import { expect, spyOn, test } from "bun:test"
import type { EventRecord, Level } from "@sujstack/obs-core"
import { createConsoleSink } from "./console"

const LEVELS: readonly Level[] = ["debug", "info", "warn", "error"]

const record = (level: Level, cause?: unknown): EventRecord => ({
  message: "a test event",
  level,
  fields: { count: 1 },
  ...(cause !== undefined && { cause }),
  time: Date.UTC(2026, 0, 2, 14, 23, 7, 412),
})

test("every level routes to the console method of the same name", () => {
  const sink = createConsoleSink()

  for (const level of LEVELS) {
    const spy = spyOn(console, level).mockImplementation(() => {})
    try {
      sink.write(record(level))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[0]).toContain(level.toUpperCase())
    } finally {
      spy.mockRestore()
    }
  }
})

test("the cause is passed through as the raw value, not a string", () => {
  const boom = new Error("outer", { cause: new Error("inner") })
  const spy = spyOn(console, "error").mockImplementation(() => {})
  try {
    createConsoleSink().write(record("error", boom))
    expect(spy.mock.calls[0]?.at(-1)).toBe(boom)
  } finally {
    spy.mockRestore()
  }
})

test("an empty fields object is not printed", () => {
  const spy = spyOn(console, "info").mockImplementation(() => {})
  try {
    createConsoleSink().write({ ...record("info"), fields: {} })
    expect(spy.mock.calls[0]).toEqual(["14:23:07.412 INFO  a test event"])
  } finally {
    spy.mockRestore()
  }
})
