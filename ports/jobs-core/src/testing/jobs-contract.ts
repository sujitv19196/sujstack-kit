import { describe, expect, test } from "bun:test"
import type { JobAttempt, JobPolicies, JobQueue, JobStatus, JobWorker } from "../jobs"

export type ContractJobs = { "contract.echo": { value: string; fail: boolean } }

export interface JobsFixture {
  queue: JobQueue<ContractJobs>
  worker: JobWorker<ContractJobs>
  close(): Promise<void>
}

const policies: JobPolicies<ContractJobs> = {
  "contract.echo": { retryLimit: 1, timeoutSeconds: 60 },
}

async function settled(queue: JobQueue<ContractJobs>, id: string): Promise<JobStatus> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const status = await queue.status("contract.echo", id)
    if (status.found && (status.state === "completed" || status.state === "failed")) return status
    if (Date.now() > deadline) return status
    await Bun.sleep(100)
  }
}

/** Runs the JobQueue + JobWorker contract. `factory` must honour the policies it is given. */
export function runJobsContract(
  name: string,
  factory: (policies: JobPolicies<ContractJobs>) => Promise<JobsFixture>,
): void {
  describe(`Jobs contract: ${name}`, () => {
    const withJobs = async (body: (fixture: JobsFixture) => Promise<void>) => {
      const fixture = await factory(policies)
      try {
        await body(fixture)
      } finally {
        await fixture.close()
      }
    }

    test("an unknown id reports found: false", async () => {
      await withJobs(async ({ queue }) => {
        expect(await queue.status("contract.echo", crypto.randomUUID())).toEqual({ found: false })
      })
    })

    test("a job stays queued, with no attempts, until a worker takes it", async () => {
      await withJobs(async ({ queue }) => {
        const id = await queue.enqueue("contract.echo", { value: "a", fail: false })
        expect(await queue.status("contract.echo", id)).toEqual({
          found: true,
          state: "queued",
          attempts: 0,
        })
      })
    })

    test("a handler's output completes the job", async () => {
      await withJobs(async ({ queue, worker }) => {
        await worker.start({ "contract.echo": async ({ value }) => ({ echo: value }) })
        const id = await queue.enqueue("contract.echo", { value: "hello", fail: false })

        expect(await settled(queue, id)).toEqual({
          found: true,
          state: "completed",
          attempts: 1,
          output: { echo: "hello" },
        })
      })
    }, 15_000)

    test("a handler that keeps throwing fails the job after its retries", async () => {
      await withJobs(async ({ queue, worker }) => {
        const seen: Omit<JobAttempt, "id">[] = []
        await worker.start({
          "contract.echo": async (_data, { attempt, final }) => {
            seen.push({ attempt, final })
            throw new Error("contract failure")
          },
        })
        const id = await queue.enqueue("contract.echo", { value: "x", fail: true })

        expect(await settled(queue, id)).toEqual({
          found: true,
          state: "failed",
          attempts: 2,
          error: "contract failure",
        })
        expect(seen).toEqual([
          { attempt: 1, final: false },
          { attempt: 2, final: true },
        ])
      })
    }, 15_000)

    test("healthy only while started", async () => {
      await withJobs(async ({ worker }) => {
        expect(await worker.healthy()).toBe(false)
        await worker.start({ "contract.echo": async () => ({}) })
        expect(await worker.healthy()).toBe(true)
        await worker.stop()
        expect(await worker.healthy()).toBe(false)
      })
    }, 15_000)
  })
}
