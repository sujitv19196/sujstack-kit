import { defineCatalog, defineCounter, type Metrics } from "@sujstack/metrics-core"
import type { Log } from "@sujstack/obs-core"
import { initTRPC } from "@trpc/server"
import { GENERIC_API_ERROR_MESSAGE } from "./errors"

/** Spread into the app's `defineCatalog` call, so its catalog is a superset of `trpcCounters`. */
export const trpcCounterDefs = {
  "trpc.requests": defineCounter<{ outcome: "ok" | "client_error" | "server_error" }>({
    description: "tRPC procedure calls that reached a procedure, by outcome",
  }),
}

export const trpcCounters = defineCatalog(trpcCounterDefs)

/** What the middleware needs from every app's context. */
export interface BaseContext {
  readonly log: Log
  readonly metrics: Metrics<typeof trpcCounters>
}

export function createTrpc<C extends BaseContext>({
  genericErrorMessage = GENERIC_API_ERROR_MESSAGE,
}: {
  genericErrorMessage?: string
} = {}) {
  // No transformer: every payload is plain JSON.
  const t = initTRPC.context<C>().create({
    errorFormatter({ shape, error }) {
      // A client fault keeps its message: the caller needs it to fix the request. A server fault
      // is replaced wholesale, so neither the message nor the stack reaches the browser.
      if (error.code !== "INTERNAL_SERVER_ERROR") return shape
      const { stack: _stack, ...data } = shape.data
      return { ...shape, message: genericErrorMessage, data }
    },
  })

  /**
   * Emits one `trpc.<path>` event and one `trpc.requests` increment per resolved call. Errors that
   * never reach a procedure are logged by the handler's `onError` under the flat `trpc.failed`
   * message instead, and are not counted.
   */
  const logged = t.middleware(async ({ ctx, path, type, next }) => {
    const startedAt = performance.now()
    const result = await next()
    const fields = { path, type, durationMs: Math.round(performance.now() - startedAt) }

    if (result.ok) {
      ctx.log.info(`trpc.${path}`, fields)
      ctx.metrics.increment("trpc.requests", { outcome: "ok" })
    } else if (result.error.code === "INTERNAL_SERVER_ERROR") {
      ctx.log.error(`trpc.${path}`, result.error, { ...fields, code: result.error.code })
      ctx.metrics.increment("trpc.requests", { outcome: "server_error" })
    } else {
      // A client fault is not a system failure. Logging bad input at error level is the flood
      // this module exists to prevent, and the stack points at the validator, not at a bug.
      ctx.log.warn(`trpc.${path}`, {
        ...fields,
        code: result.error.code,
        detail: result.error.message,
      })
      ctx.metrics.increment("trpc.requests", { outcome: "client_error" })
    }

    return result
  })

  return {
    router: t.router,
    /** Bare: attach `logged` (and anything else) in the app's own base procedures. */
    procedure: t.procedure,
    logged,
    middleware: t.middleware,
    createCallerFactory: t.createCallerFactory,
  }
}
