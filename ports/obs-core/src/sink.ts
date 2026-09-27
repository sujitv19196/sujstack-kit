export type Level = "debug" | "info" | "warn" | "error"

export type Fields = Readonly<Record<string, unknown>>

export interface EventRecord {
  readonly message: string
  readonly level: Level
  readonly fields: Fields
  /** The raw thrown value, so an adapter can parse its stack. Present only on `error`. */
  readonly cause?: unknown
  /** Epoch millis. */
  readonly time: number
}

export interface EventSink {
  /** Fire and forget. Must not throw, must not block, and must not mutate `record`. */
  write(record: EventRecord): void
}

export type EventSinkFactory = () => EventSink
