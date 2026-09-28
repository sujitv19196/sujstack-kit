/** Job name → payload. Payloads are stored, so they must survive a JSON round-trip. */
export type JobMap = Record<string, object>

/** How a job is retried and bounded. Set per job name, by the worker. */
export interface JobPolicy {
  /** Retries after the first attempt, so a job runs at most `retryLimit + 1` times. */
  readonly retryLimit: number
  /** An attempt still running after this long is counted as failed. */
  readonly timeoutSeconds: number
}

export type JobPolicies<Jobs extends JobMap> = { readonly [N in keyof Jobs]: JobPolicy }

/** `attempts` counts attempts started, including one in progress. */
export type JobStatus =
  | { readonly found: false }
  | { readonly found: true; readonly state: "queued" | "active"; readonly attempts: number }
  | {
      readonly found: true
      readonly state: "completed"
      readonly attempts: number
      readonly output: unknown
    }
  | {
      readonly found: true
      readonly state: "failed"
      readonly attempts: number
      readonly error: string
    }

export interface EnqueueOptions<Tx> {
  /** The job exists only if this transaction commits. */
  readonly tx: Tx
}

/** The producer side. `Tx` is the adapter's transaction type; `unknown` when it has none. */
export interface JobQueue<Jobs extends JobMap, Tx = unknown> {
  enqueue<N extends keyof Jobs & string>(
    name: N,
    data: Jobs[N],
    options?: EnqueueOptions<Tx>,
  ): Promise<string>
  status(name: keyof Jobs & string, id: string): Promise<JobStatus>
}

export interface JobAttempt {
  readonly id: string
  /** 1 on the first run. */
  readonly attempt: number
  /** No retry follows if this attempt throws. */
  readonly final: boolean
}

/** Resolves with the job's output, or throws to fail the attempt. */
export type JobHandler<Data> = (data: Data, attempt: JobAttempt) => Promise<unknown>

export type JobHandlers<Jobs extends JobMap> = { readonly [N in keyof Jobs]: JobHandler<Jobs[N]> }

/** The consumer side. */
export interface JobWorker<Jobs extends JobMap> {
  /** Resolves once every job name in `handlers` is being taken. */
  start(handlers: JobHandlers<Jobs>): Promise<void>
  /** Stops taking jobs and waits for the attempts in flight. Safe to call twice. */
  stop(): Promise<void>
  /** Started, and able to reach its store. */
  healthy(): Promise<boolean>
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
