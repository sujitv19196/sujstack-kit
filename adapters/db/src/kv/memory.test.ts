import { runKvContract } from "@sujstack/db-core/testing"
import { createMemoryKv } from "./memory"

runKvContract("memory", createMemoryKv)
