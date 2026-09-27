import { expect, test } from "bun:test"
import { createMetrics, defineCatalog, defineCounter, type Metrics } from "@sujstack/metrics-core"
import { createMemorySink as createMetricSink } from "@sujstack/metrics-core/testing"
import { createLog } from "@sujstack/obs-core"
import { createMemorySink } from "@sujstack/obs-core/testing"
import { TRPCError } from "@trpc/server"
import { type BaseContext, createTrpc, trpcCounterDefs, trpcCounters } from "./create-trpc"

// Never called: `bun run typecheck` fails if any line below stops being a type error.
function misuse() {
  const appCounters = defineCatalog({
    ...trpcCounterDefs,
    "app.signups": defineCounter({ description: "" }),
  })
  const superset: Metrics<typeof trpcCounters> = createMetrics(appCounters, [])
  const unrelated = defineCatalog({ "app.signups": defineCounter({ description: "" }) })
  // @ts-expect-error a catalog without `trpc.requests` cannot back the middleware
  const missing: Metrics<typeof trpcCounters> = createMetrics(unrelated, [])
  return [superset, missing]
}
void misuse

function harness() {
  const sink = createMemorySink()
  const metricSink = createMetricSink()
  const context: BaseContext = {
    log: createLog([sink]),
    metrics: createMetrics(trpcCounters, [metricSink]),
  }
  const { router, publicProcedure, createCallerFactory } = createTrpc<BaseContext>()
  const appRouter = router({
    ok: publicProcedure.query(() => "ok"),
    client: publicProcedure.query(() => {
      throw new TRPCError({ code: "BAD_REQUEST", message: "bad input" })
    }),
    server: publicProcedure.query(() => {
      throw new Error("db-internal-7 refused")
    }),
  })
  return { caller: createCallerFactory(appRouter)(context), sink, metricSink }
}

test("each outcome is logged and counted at its own severity", async () => {
  const { caller, sink, metricSink } = harness()

  await caller.ok()
  await expect(caller.client()).rejects.toThrow("bad input")
  await expect(caller.server()).rejects.toThrow()

  expect(sink.written().map((record) => [record.message, record.level])).toEqual([
    ["trpc.ok", "info"],
    ["trpc.client", "warn"],
    ["trpc.server", "error"],
  ])
  expect(sink.written()[2]?.cause).toMatchObject({ message: "db-internal-7 refused" })
  expect(metricSink.added().map((record) => record.labels.outcome)).toEqual([
    "ok",
    "client_error",
    "server_error",
  ])
})
