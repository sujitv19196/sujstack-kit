export type LabelSet = Readonly<Record<string, string>>

/** Maps any label typed as plain `string` to `never`, so only literal unions satisfy it. */
export type Bounded<L extends LabelSet> = {
  readonly [K in keyof L]: string extends L[K] ? never : L[K]
}

declare const labelsOf: unique symbol

export interface CounterDef<L extends LabelSet> {
  readonly description: string
  /** Phantom: carries the label type. Never present at runtime. */
  readonly [labelsOf]?: L
}

export interface Counter<N extends string, L extends LabelSet> extends CounterDef<L> {
  readonly name: N
}

export type LabelsOf<C> = C extends CounterDef<infer L> ? L : never

export type Catalog = { readonly [name: string]: Counter<string, LabelSet> }

type Named<D extends Record<string, CounterDef<LabelSet>>> = {
  readonly [K in keyof D & string]: Counter<K, LabelsOf<D[K]>>
}

const NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/

export function defineCounter<L extends LabelSet & Bounded<L> = Record<never, never>>(def: {
  readonly description: string
}): CounterDef<L> {
  return { description: def.description }
}

/** Stamps each key onto its counter as the name. */
export function defineCatalog<D extends Record<string, CounterDef<LabelSet>>>(defs: D): Named<D> {
  const catalog: Record<string, Counter<string, LabelSet>> = {}
  for (const [name, def] of Object.entries(defs)) {
    if (!NAME.test(name)) throw new Error(`Invalid metric name: ${name}`)
    catalog[name] = { ...def, name }
  }
  return catalog as Named<D>
}

/** The name Prometheus stores an OTLP monotonic sum under e.g.: `trpc.requests` → `trpc_requests_total`. */
export function promName(counter: Counter<string, LabelSet>): string {
  return `${counter.name.replaceAll(".", "_")}_total`
}
