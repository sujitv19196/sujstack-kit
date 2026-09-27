import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("No database URL was configured, so there is no database to query.")
    this.name = "DatabaseNotConfiguredError"
  }
}

export interface PostgresOptions<S extends Record<string, unknown>> {
  /** `undefined` leaves the database unconfigured: the first query throws. */
  readonly url: string | undefined
  readonly schema: S
}

export interface Postgres<S extends Record<string, unknown>> {
  /** Opens the connection on first property access, not on creation. */
  readonly db: PostgresJsDatabase<S>
  readonly isConfigured: boolean
  close(): Promise<void>
}

export function createPostgres<S extends Record<string, unknown>>(
  options: PostgresOptions<S>,
): Postgres<S> {
  const { url, schema } = options
  let connection: postgres.Sql | undefined
  let instance: PostgresJsDatabase<S> | undefined

  const connect = (): PostgresJsDatabase<S> => {
    if (instance) return instance
    if (url === undefined) throw new DatabaseNotConfiguredError()
    connection = postgres(url, { prepare: false })
    instance = drizzle(connection, { schema })
    return instance
  }

  const db = new Proxy({} as PostgresJsDatabase<S>, {
    get(_target, property) {
      const real = connect()
      const value = Reflect.get(real, property) as unknown
      return typeof value === "function" ? value.bind(real) : value
    },
  })

  return {
    db,
    isConfigured: url !== undefined,
    async close() {
      await connection?.end()
      connection = undefined
      instance = undefined
    },
  }
}
