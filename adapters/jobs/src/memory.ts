import {
  errorMessage,
  type JobHandlers,
  type JobMap,
  type JobPolicies,
  type JobQueue,
  type JobStatus,
  type JobWorker,
} from "@sujstack/jobs-core"

interface Entry {
  readonly name: string
  readonly data: object
  state: "queued" | "active" | "completed" | "failed"
  attempts: number
  output?: unknown
  error?: string
}

export interface MemoryJobs<Jobs extends JobMap> {
  /** Transactions are not supported: `tx` is ignored and the job is enqueued at once. */
  readonly queue: JobQueue<Jobs, unknown>
  /** `timeoutSeconds` is not enforced. */
  readonly worker: JobWorker<Jobs>
}

/** An in-process queue and worker, for development without a database and for tests. */
export function createMemoryJobs<Jobs extends JobMap>({
  policies,
}: {
  policies: JobPolicies<Jobs>
}): MemoryJobs<Jobs> {
  const entries = new Map<string, Entry>()
  const inFlight = new Set<Promise<void>>()
  let handlers: JobHandlers<Jobs> | undefined

  const run = async (id: string, entry: Entry) => {
    const handler = handlers?.[entry.name as keyof Jobs]
    if (handler === undefined || entry.state !== "queued") return
    const { retryLimit } = policies[entry.name as keyof Jobs]
    entry.state = "active"
    entry.attempts += 1
    const final = entry.attempts > retryLimit
    try {
      entry.output = await handler(entry.data as Jobs[keyof Jobs], {
        id,
        attempt: entry.attempts,
        final,
      })
      entry.state = "completed"
    } catch (cause) {
      if (final) {
        entry.state = "failed"
        entry.error = errorMessage(cause)
      } else {
        entry.state = "queued"
        schedule(id, entry)
      }
    }
  }

  const schedule = (id: string, entry: Entry) => {
    const pending: Promise<void> = new Promise((resolve) => setTimeout(resolve, 0))
      .then(() => run(id, entry))
      .finally(() => inFlight.delete(pending))
    inFlight.add(pending)
  }

  const toStatus = (entry: Entry): JobStatus => {
    const { state, attempts } = entry
    if (state === "completed") return { found: true, state, attempts, output: entry.output }
    if (state === "failed") return { found: true, state, attempts, error: entry.error ?? "" }
    return { found: true, state, attempts }
  }

  return {
    queue: {
      async enqueue(name, data) {
        const id = crypto.randomUUID()
        const entry: Entry = { name, data, state: "queued", attempts: 0 }
        entries.set(id, entry)
        if (handlers !== undefined) schedule(id, entry)
        return id
      },

      async status(_name, id) {
        const entry = entries.get(id)
        return entry === undefined ? { found: false } : toStatus(entry)
      },
    },

    worker: {
      async start(next) {
        handlers = next
        for (const [id, entry] of entries) if (entry.state === "queued") schedule(id, entry)
      },

      async stop() {
        handlers = undefined
        while (inFlight.size > 0) await Promise.all(inFlight)
      },

      async healthy() {
        return handlers !== undefined
      },
    },
  }
}
