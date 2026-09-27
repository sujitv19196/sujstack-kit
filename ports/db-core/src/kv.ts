/** A read result. Distinguishes a stored `null` from an absent key. */
export type KvEntry<T> = { readonly found: true; readonly value: T } | { readonly found: false }

export const found = <T>(value: T): KvEntry<T> => ({ found: true, value })
export const missing: KvEntry<never> = { found: false }

export interface KeyValueStore {
  get<T>(key: string): Promise<KvEntry<T>>
  mget<T>(keys: string[]): Promise<KvEntry<T>[]>
  /** Omitting `ttlSeconds` persists the value until it is deleted. */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
  /** Omitting `prefix` lists every key. */
  list(prefix?: string): Promise<string[]>
  /** Erases only keys under `prefix`. There is no store-wide wipe. */
  clear(prefix: string): Promise<void>
  close(): Promise<void>
}

export type KvFactory = () => KeyValueStore
