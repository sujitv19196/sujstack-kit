import { runJobsContract } from "@sujstack/jobs-core/testing"
import { createMemoryJobs } from "./memory"

runJobsContract("memory", async (policies) => {
  const { queue, worker } = createMemoryJobs({ policies })
  return { queue, worker, close: () => worker.stop() }
})
