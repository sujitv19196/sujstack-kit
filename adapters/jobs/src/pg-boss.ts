import type {
  JobMap,
  JobPolicies,
  JobPolicy,
  JobQueue,
  JobStatus,
  JobWorker,
} from "@sujstack/jobs-core"
import {
  type DrizzleSqlTagLike,
  type DrizzleTransactionLike,
  fromDrizzle,
  type JobWithMetadata,
  PgBoss,
} from "pg-boss"

/** A Drizzle database or transaction. */
export type DrizzleExecutor = DrizzleTransactionLike

function toStatus(job: JobWithMetadata<unknown>): JobStatus {
  const attempts = job.retryCount + 1
  switch (job.state) {
    case "created":
      return { found: true, state: "queued", attempts: 0 }
    case "retry":
      return { found: true, state: "queued", attempts }
    case "active":
      return { found: true, state: "active", attempts }
    case "completed":
      return { found: true, state: "completed", attempts, output: job.output }
    case "cancelled":
      return { found: true, state: "failed", attempts, error: "cancelled" }
    case "failed": {
      const output = job.output as { message?: unknown } | null
      const error = typeof output?.message === "string" ? output.message : "failed"
      return { found: true, state: "failed", attempts, error }
    }
  }
}

function queueOptions({ retryLimit, timeoutSeconds }: JobPolicy) {
  return { retryLimit, expireInSeconds: timeoutSeconds }
}

/**
 * The producer. Runs pg-boss's SQL through an existing Drizzle database, so it opens no pool of
 * its own and never starts pg-boss. Queues are created by the worker: until one has started with
 * a policy for `name`, enqueueing it throws.
 */
export function createPgBossQueue<Jobs extends JobMap>({
  db,
  sql,
  schema = "pgboss",
}: {
  db: DrizzleExecutor
  /** The `sql` tag from `drizzle-orm`. */
  sql: DrizzleSqlTagLike
  schema?: string
}): JobQueue<Jobs, DrizzleExecutor> {
  const boss = new PgBoss({ db: fromDrizzle(db, sql), schema })

  return {
    async enqueue(name, data, options) {
      const id = await boss.send(
        name,
        data,
        options === undefined ? {} : { db: fromDrizzle(options.tx, sql) },
      )
      if (id === null) throw new Error(`pg-boss declined to create a "${name}" job.`)
      return id
    },

    async status(name, id) {
      const [job] = await boss.findJobs<unknown>(name, { id })
      return job === undefined ? { found: false } : toStatus(job)
    },
  }
}

/** The consumer. Owns a pool, so `url` must be a direct connection, not a transaction pooler. */
export function createPgBossWorker<Jobs extends JobMap>({
  url,
  policies,
  onError,
  pollingIntervalSeconds = 2,
  schema = "pgboss",
}: {
  url: string
  policies: JobPolicies<Jobs>
  /** pg-boss's background errors: maintenance, polling, lost connections. */
  onError: (cause: unknown) => void
  pollingIntervalSeconds?: number
  schema?: string
}): JobWorker<Jobs> {
  const boss = new PgBoss({ connectionString: url, schema, schedule: false })
  boss.on("error", onError)
  let started = false

  return {
    async start(handlers) {
      await boss.start()
      started = true
      for (const [name, policy] of Object.entries(policies) as [string, JobPolicy][]) {
        await boss.createQueue(name, queueOptions(policy))
        await boss.updateQueue(name, queueOptions(policy))
        const handler = handlers[name as keyof Jobs]
        await boss.work(
          name,
          { batchSize: 1, includeMetadata: true, pollingIntervalSeconds },
          async ([job]) => {
            if (job === undefined) return undefined
            return handler(job.data as Jobs[keyof Jobs], {
              id: job.id,
              attempt: job.retryCount + 1,
              final: job.retryCount >= job.retryLimit,
            })
          },
        )
      }
    },

    async stop() {
      if (!started) return
      started = false
      await boss.stop({ graceful: true, timeout: 30_000 })
    },

    async healthy() {
      if (!started) return false
      try {
        await boss.getDb().executeSql("select 1")
        return true
      } catch {
        return false
      }
    },
  }
}
