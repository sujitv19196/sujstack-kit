import { expect, test } from "bun:test"
import { createLog } from "@sujstack/obs-core"
import { createMemorySink } from "@sujstack/obs-core/testing"
import { TRPCError } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { type BaseContext, createTrpc, type TrpcCall } from "./create-trpc"
import { GENERIC_API_ERROR_MESSAGE } from "./errors"

// Never called: `bun run typecheck` fails if any line below stops being a type error.
function misuse() {
  // @ts-expect-error a context without onCall cannot back the middleware
  createTrpc<{ log: ReturnType<typeof createLog> }>()
  const onCall = (call: TrpcCall) => {
    // @ts-expect-error only a failed call carries an error
    if (call.outcome === "ok") call.error
  }
  return onCall
}
void misuse

function harness(options?: Parameters<typeof createTrpc>[0]) {
  const sink = createMemorySink()
  const calls: TrpcCall[] = []
  const context: BaseContext = { log: createLog([sink]), onCall: (call) => calls.push(call) }
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
  return { caller: createCallerFactory(appRouter)(context), fetchError, sink, calls }
}

test("each outcome is logged at its own severity and reported to onCall", async () => {
  const { caller, sink, calls } = harness()

  await caller.ok()
  await expect(caller.client()).rejects.toThrow("bad input")
  await expect(caller.server()).rejects.toThrow()

  expect(sink.written().map((record) => [record.message, record.level])).toEqual([
    ["trpc.ok", "info"],
    ["trpc.client", "warn"],
    ["trpc.server", "error"],
  ])
  expect(sink.written()[2]?.cause).toMatchObject({ message: "db-internal-7 refused" })
  expect(calls.map((call) => [call.path, call.outcome])).toEqual([
    ["ok", "ok"],
    ["client", "client_error"],
    ["server", "server_error"],
  ])
  expect(calls[2]).toMatchObject({ error: { message: "db-internal-7 refused" } })
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
