import { describe, expect, test } from "bun:test"
import type { JobPolicies } from "@sujstack/jobs-core"
import { type ContractJobs, runJobsContract } from "@sujstack/jobs-core/testing"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { PgBoss } from "pg-boss"
import postgres from "postgres"
import { createPgBossQueue, createPgBossWorker } from "./pg-boss"

// Runs only with TEST_DATABASE_URL, a direct (unpooled) URL. Each fixture gets its own schema.
const url = process.env.TEST_DATABASE_URL ?? ""

async function fixture(policies: JobPolicies<ContractJobs>) {
  const schema = `pgboss_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
  const client = postgres(url, { prepare: false, onnotice: () => {} })
  // The worker creates the schema and queues on start; the contract uses the queue before that.
  const installer = new PgBoss({ connectionString: url, schema, supervise: false, schedule: false })
  await installer.start()
  for (const name of Object.keys(policies)) await installer.createQueue(name)
  await installer.stop({ graceful: false })
  const db = drizzle(client)
  const queue = createPgBossQueue<ContractJobs>({ db, sql, schema })
  const worker = createPgBossWorker<ContractJobs>({
    url,
    policies,
    onError: () => {},
    pollingIntervalSeconds: 0.5,
    schema,
  })
  const close = async () => {
    await worker.stop()
    await client.unsafe(`drop schema if exists ${schema} cascade`)
    await client.end()
  }
  return { db, queue, worker, close }
}

describe.skipIf(url === "")("pg-boss", () => {
  runJobsContract("pg-boss", fixture)

  const policies = { "contract.echo": { retryLimit: 0, timeoutSeconds: 60 } }
  const data = { value: "tx", fail: false }

  test("a job enqueued in a transaction exists only if it commits", async () => {
    const { db, queue, close } = await fixture(policies)
    try {
      let rolledBack = ""
      await db
        .transaction(async (tx) => {
          rolledBack = await queue.enqueue("contract.echo", data, { tx })
          tx.rollback()
        })
        .catch(() => {})
      let committed = ""
      await db.transaction(async (tx) => {
        committed = await queue.enqueue("contract.echo", data, { tx })
      })

      expect(await queue.status("contract.echo", rolledBack)).toEqual({ found: false })
      expect(await queue.status("contract.echo", committed)).toMatchObject({ state: "queued" })
    } finally {
      await close()
    }
  })
})
