import type { EventRecord, EventSink, Fields, Level } from "./sink"

export interface Log {
  debug(message: string, fields?: Fields): void
  info(message: string, fields?: Fields): void
  warn(message: string, fields?: Fields): void
  /** `cause` is required: an error record without the thing that failed is not worth writing. */
  error(message: string, cause: unknown, fields?: Fields): void
}

export function createLog(sinks: readonly EventSink[]): Log {
  const emit = (message: string, level: Level, fields: Fields, cause?: unknown) => {
    const record: EventRecord = {
      message,
      level,
      fields,
      ...(cause !== undefined && { cause }),
      time: Date.now(),
    }

    for (const sink of sinks) {
      try {
        sink.write(record)
      } catch {
        // A broken sink must not fail the request it is logging about, nor starve the sinks
        // after it in the list.
      }
    }
  }

  return {
    debug: (message, fields = {}) => emit(message, "debug", fields),
    info: (message, fields = {}) => emit(message, "info", fields),
    warn: (message, fields = {}) => emit(message, "warn", fields),
    error: (message, cause, fields = {}) => emit(message, "error", fields, cause),
  }
}
