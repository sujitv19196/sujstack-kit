import type { StandardSchemaV1 } from "@standard-schema/spec"
import { type KeyValueStore, type KvEntry, missing } from "./kv"

/** A key-prefixed view over a store that validates values against a schema. */
export interface Namespace<T> {
  get(key: string): Promise<KvEntry<T>>
  set(key: string, value: T, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
  list(): Promise<string[]>
  clear(): Promise<void>
}

export class SchemaValidationError extends Error {
  constructor(
    readonly namespace: string,
    readonly key: string,
    readonly issues: readonly StandardSchemaV1.Issue[],
  ) {
    const detail = issues.map((issue) => issue.message).join("; ")
    super(`Value for "${namespace}:${key}" does not match the namespace schema: ${detail}`)
    this.name = "SchemaValidationError"
  }
}

/** Accepts any Standard Schema, including Zod, Valibot and ArkType schemas. */
export function defineNamespace<S extends StandardSchemaV1>(
  store: KeyValueStore,
  name: string,
  schema: S,
): Namespace<StandardSchemaV1.InferOutput<S>> {
  type Value = StandardSchemaV1.InferOutput<S>

  const prefix = `${name}:`
  const scoped = (key: string) => `${prefix}${key}`

  // The spec permits a synchronous or an asynchronous validator.
  const validate = async (value: unknown) => schema["~standard"].validate(value)

  return {
    async get(key: string): Promise<KvEntry<Value>> {
      const entry = await store.get<unknown>(scoped(key))
      if (!entry.found) return missing

      const result = await validate(entry.value)
      if (result.issues) {
        // Report an unreadable entry as a miss, and evict it.
        await store.delete(scoped(key))
        return missing
      }
      return { found: true, value: result.value as Value }
    },

    async set(key: string, value: Value, ttlSeconds?: number): Promise<void> {
      const result = await validate(value)
      if (result.issues) throw new SchemaValidationError(name, key, result.issues)
      await store.set(scoped(key), result.value, ttlSeconds)
    },

    async delete(key: string): Promise<void> {
      await store.delete(scoped(key))
    },

    async has(key: string): Promise<boolean> {
      return store.has(scoped(key))
    },

    async list(): Promise<string[]> {
      const keys = await store.list(prefix)
      return keys.map((key) => key.slice(prefix.length))
    },

    async clear(): Promise<void> {
      await store.clear(prefix)
    },
  }
}
