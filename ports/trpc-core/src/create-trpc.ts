import type { Log } from "@sujstack/obs-core"
import { initTRPC, type TRPCError, type TRPCProcedureType } from "@trpc/server"
import { GENERIC_API_ERROR_MESSAGE } from "./errors"

/** One call that reached a procedure, as reported to `onCall`. */
export type TrpcCall = {
  readonly path: string
  readonly type: TRPCProcedureType
  readonly durationMs: number
} & (
  | { readonly outcome: "ok" }
  | { readonly outcome: "client_error" | "server_error"; readonly error: TRPCError }
)

/** What the middleware needs from every app's context. */
export interface BaseContext {
  readonly log: Log
  /** Runs after every call `logged` sees; count it here. */
  readonly onCall: (call: TrpcCall) => void
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
   * Emits one `trpc.<path>` event and one `ctx.onCall` per resolved call. Errors that never reach a
   * procedure are logged by the handler's `onError` under the flat `trpc.failed` message instead,
   * and are not reported.
   */
  const logged = t.middleware(async ({ ctx, path, type, next }) => {
    const startedAt = performance.now()
    const result = await next()
    const fields = { path, type, durationMs: Math.round(performance.now() - startedAt) }

    if (result.ok) {
      ctx.log.info(`trpc.${path}`, fields)
      ctx.onCall({ ...fields, outcome: "ok" })
    } else if (result.error.code === "INTERNAL_SERVER_ERROR") {
      ctx.log.error(`trpc.${path}`, result.error, { ...fields, code: result.error.code })
      ctx.onCall({ ...fields, outcome: "server_error", error: result.error })
    } else {
      // A client fault is not a system failure. Logging bad input at error level is the flood
      // this module exists to prevent, and the stack points at the validator, not at a bug.
      ctx.log.warn(`trpc.${path}`, {
        ...fields,
        code: result.error.code,
        detail: result.error.message,
      })
      ctx.onCall({ ...fields, outcome: "client_error", error: result.error })
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
