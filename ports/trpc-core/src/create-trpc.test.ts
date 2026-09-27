import { expect, test } from "bun:test"
import { createMetrics, defineCatalog, defineCounter, type Metrics } from "@sujstack/metrics-core"
import { createMemorySink as createMetricSink } from "@sujstack/metrics-core/testing"
import { createLog } from "@sujstack/obs-core"
import { createMemorySink } from "@sujstack/obs-core/testing"
import { TRPCError } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { type BaseContext, createTrpc, trpcCounterDefs, trpcCounters } from "./create-trpc"
import { GENERIC_API_ERROR_MESSAGE } from "./errors"

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

function harness(options?: Parameters<typeof createTrpc>[0]) {
  const sink = createMemorySink()
  const metricSink = createMetricSink()
  const context: BaseContext = {
    log: createLog([sink]),
    metrics: createMetrics(trpcCounters, [metricSink]),
  }
  const { router, procedure, logged, createCallerFactory } = createTrpc<BaseContext>(options)
  const publicProcedure = procedure.use(logged)
  const appRouter = router({
    ok: publicProcedure.query(() => "ok"),
    client: publicProcedure.query(() => {
      throw new TRPCError({ code: "BAD_REQUEST", message: "bad input" })
    }),
    server: publicProcedure.query(() => {
      throw new Error("db-internal-7 refused")
    }),
  })
  /** Goes through the fetch adapter, because `errorFormatter` only runs when a response is built. */
  const fetchError = async (path: string) => {
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: new Request(`http://localhost/trpc/${path}`),
      router: appRouter,
      createContext: () => context,
    })
    const body = (await response.json()) as { error: { message: string; data: object } }
    return body.error
  }
  return { caller: createCallerFactory(appRouter)(context), fetchError, sink, metricSink }
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

test("a server fault reaches the wire as the generic message, with no stack", async () => {
  const { fetchError } = harness()

  const error = await fetchError("server")

  expect(error.message).toBe(GENERIC_API_ERROR_MESSAGE)
  expect(error.data).not.toHaveProperty("stack")
})

test("the generic message can be overridden", async () => {
  const { fetchError } = harness({ genericErrorMessage: "Our side broke." })

  expect((await fetchError("server")).message).toBe("Our side broke.")
})

test("a client fault keeps its own message", async () => {
  const { fetchError } = harness({ genericErrorMessage: "Our side broke." })

  const error = await fetchError("client")

  expect(error.message).toBe("bad input")
  // Proves the stack assertion above is live: unmasked errors carry one outside production.
  expect(error.data).toHaveProperty("stack")
})
