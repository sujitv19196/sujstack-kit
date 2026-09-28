import type { Log } from "@sujstack/obs-core"
import { errorMessage, type JobHandler, type JobHandlers, type JobMap } from "./jobs"

/** One attempt's result, as reported to `onRun`. */
export type JobRun = {
  readonly name: string
  readonly id: string
  readonly attempt: number
  readonly durationMs: number
} & (
  | { readonly outcome: "completed" }
  | { readonly outcome: "retrying"; readonly cause: unknown }
  | { readonly outcome: "failed"; readonly cause: unknown }
)

/**
 * Wraps each handler to emit one `job.<name>` event and one `onRun` per attempt: completed at
 * `info`, a throw that will be retried at `warn`, the final throw at `error` with its cause.
 */
export function loggedHandlers<Jobs extends JobMap>(
  handlers: JobHandlers<Jobs>,
  {
    log,
    onRun,
  }: {
    log: Log
    /** Runs after every attempt */
    onRun: (run: JobRun) => void
  },
): JobHandlers<Jobs> {
  const wrap = (name: string, handler: JobHandler<object>): JobHandler<object> => {
    const message = `job.${name}`
    return async (data, attempt) => {
      const startedAt = performance.now()
      const elapsed = () => Math.round(performance.now() - startedAt)
      const run = { name, id: attempt.id, attempt: attempt.attempt }
      try {
        const output = await handler(data, attempt)
        const durationMs = elapsed()
        log.info(message, { ...run, durationMs })
        onRun({ ...run, outcome: "completed", durationMs })
        return output
      } catch (cause) {
        const durationMs = elapsed()
        if (attempt.final) {
          log.error(message, cause, { ...run, durationMs })
          onRun({ ...run, outcome: "failed", cause, durationMs })
        } else {
          log.warn(message, { ...run, durationMs, reason: errorMessage(cause) })
          onRun({ ...run, outcome: "retrying", cause, durationMs })
        }
        throw cause
      }
    }
  }

  const entries = Object.entries(handlers as Record<string, JobHandler<object>>)
  return Object.fromEntries(
    entries.map(([name, handler]) => [name, wrap(name, handler)]),
  ) as unknown as JobHandlers<Jobs>
}
