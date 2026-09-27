import { runVectorContract } from "@sujstack/db-core/testing"
import { createMemoryVectorStore } from "./memory"

runVectorContract("memory", createMemoryVectorStore)
