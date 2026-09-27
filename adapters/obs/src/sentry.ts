import * as Sentry from "@sentry/nextjs"
import type { EventRecord, EventSink } from "@sujstack/obs-core"

/**
 * Requires `Sentry.init` in the host app, and `enableLogs` for anything below `warn`.
 * `warn` and `error` raise issues; `debug` and `info` go to the log stream only.
 */
export function createSentrySink(): EventSink {
  return {
    write(record: EventRecord): void {
      const contexts = { log: { message: record.message }, fields: { ...record.fields } }

      if (record.level === "error") {
        // The raw cause, so Sentry parses the real stack and fingerprints on it.
        Sentry.captureException(record.cause, { contexts })
        return
      }

      if (record.level === "warn") {
        Sentry.captureMessage(record.message, { level: "warning", contexts })
        return
      }

      Sentry.logger[record.level](record.message, record.fields)
    },
  }
}
