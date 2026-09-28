import { expect, test } from "bun:test"
import { createLog } from "@sujstack/obs-core"
import { createMemorySink } from "@sujstack/obs-core/testing"
import type { JobRun } from "./logged"
import { loggedHandlers } from "./logged"

type Jobs = { "test.job": { fail: boolean } }

function harness() {
  const sink = createMemorySink()
  const runs: JobRun<"test.job">[] = []
  const handlers = loggedHandlers<Jobs>(
    {
      "test.job": async ({ fail }) => {
        if (fail) throw new Error("boom")
        return { ok: true }
      },
    },
    { log: createLog([sink]), onRun: (run) => runs.push(run) },
  )
  return { handler: handlers["test.job"], sink, runs }
}

test("a completed attempt logs at info and passes the output through", async () => {
  const { handler, sink, runs } = harness()

  expect(await handler({ fail: false }, { id: "j1", attempt: 1, final: false })).toEqual({
    ok: true,
  })
  expect(sink.written()).toMatchObject([
    { level: "info", message: "job.test.job", fields: { id: "j1", attempt: 1 } },
  ])
  expect(runs).toMatchObject([{ name: "test.job", outcome: "completed" }])
})

test("a throw logs at warn while retries remain, and at error with the cause on the last", async () => {
  const { handler, sink, runs } = harness()

  await expect(handler({ fail: true }, { id: "j1", attempt: 1, final: false })).rejects.toThrow(
    "boom",
  )
  await expect(handler({ fail: true }, { id: "j1", attempt: 2, final: true })).rejects.toThrow(
    "boom",
  )

  expect(sink.written()).toMatchObject([
    { level: "warn", fields: { reason: "boom" } },
    { level: "error", cause: { message: "boom" } },
  ])
  expect(runs.map((run) => run.outcome)).toEqual(["retrying", "failed"])
})

test("onRun names the job with the app's own union, not a plain string", () => {
  loggedHandlers<Jobs>(
    { "test.job": async () => ({}) },
    {
      log: createLog([]),
      onRun: ({ name }) => {
        const job: keyof Jobs = name
        // @ts-expect-error a name outside the job map is not assignable
        const other: "other.job" = name
        void [job, other]
      },
    },
  )
})
