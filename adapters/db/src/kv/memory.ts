import { found, type KeyValueStore, type KvEntry, missing } from "@sujstack/db-core"

interface Slot {
  readonly value: unknown
  /** Epoch millis, or null for "never expires". */
  readonly expiresAt: number | null
}

export function createMemoryKv(): KeyValueStore {
  const slots = new Map<string, Slot>()

  /** Reads through the TTL, evicting lazily. */
  const live = (key: string): Slot | undefined => {
    const slot = slots.get(key)
    if (!slot) return undefined
    if (slot.expiresAt !== null && slot.expiresAt <= Date.now()) {
      slots.delete(key)
      return undefined
    }
    return slot
  }

  const read = <T>(key: string): KvEntry<T> => {
    const slot = live(key)
    return slot ? found(slot.value as T) : missing
  }

  return {
    async get<T>(key: string): Promise<KvEntry<T>> {
      return read<T>(key)
    },

    async mget<T>(keys: string[]): Promise<KvEntry<T>[]> {
      return keys.map((key) => read<T>(key))
    },

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      slots.set(key, {
        value,
        expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
      })
    },

    async delete(key: string): Promise<void> {
      slots.delete(key)
    },

    async has(key: string): Promise<boolean> {
      return live(key) !== undefined
    },

    async list(prefix?: string): Promise<string[]> {
      const keys: string[] = []
      for (const key of [...slots.keys()]) {
        if (prefix !== undefined && !key.startsWith(prefix)) continue
        if (live(key)) keys.push(key)
      }
      return keys.sort()
    },

    async clear(prefix: string): Promise<void> {
      for (const key of [...slots.keys()]) {
        if (key.startsWith(prefix)) slots.delete(key)
      }
    },

    async close(): Promise<void> {
      slots.clear()
    },
  }
}
