import { type Counter, type LabelSet, promName } from "./counter"

export type Severity = "page" | "ticket"

export type Duration = `${number}${"s" | "m" | "h" | "d"}`

declare const brand: unique symbol

/** PromQL built only by the functions below, so every metric it names is a declared counter. */
export type Expr = string & { readonly [brand]: true }

export interface Rule {
  readonly alert: string
  readonly severity: Severity
  readonly for: Duration
  readonly expr: Expr
  readonly summary: string
  readonly runbook?: string
}

export interface Selector<L extends LabelSet> {
  readonly counter: Counter<string, L>
  readonly where: Partial<L>
}

export type Selectable<L extends LabelSet = LabelSet> = Counter<string, L> | Selector<L>

export function select<L extends LabelSet>(
  counter: Counter<string, L>,
  where: Partial<L>,
): Selector<L> {
  return { counter, where }
}

const LABEL = /[^a-zA-Z0-9_]/g

function selector(target: Selectable): string {
  const { counter, where } = "counter" in target ? target : { counter: target, where: {} }
  const matchers = Object.entries(where)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([label, value]) => `${label.replace(LABEL, "_")}=${JSON.stringify(value)}`)
  return matchers.length > 0 ? `${promName(counter)}{${matchers.join(",")}}` : promName(counter)
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Threshold must be finite, got ${value}`)
  return String(value)
}

/** Raw PromQL; each interpolation must be a counter or `select(...)`. */
export function promql(strings: TemplateStringsArray, ...refs: readonly Selectable[]): Expr {
  return strings.reduce((out, text, i) => {
    const ref = refs[i - 1]
    return out + (ref === undefined ? "" : selector(ref)) + text
  }) as Expr
}

interface Threshold {
  readonly window: Duration
  readonly threshold: number
}

/** Per-second rate across all series above `threshold`. */
export function rateAbove(target: Selectable, { window, threshold }: Threshold): Expr {
  return `sum(rate(${selector(target)}[${window}])) > ${number(threshold)}` as Expr
}

/** `numerator / denominator` as a fraction, e.g. `0.05` for 5%. */
export function ratioAbove(
  numerator: Selectable,
  denominator: Selectable,
  { window, threshold }: Threshold,
): Expr {
  const rate = (target: Selectable) => `sum(rate(${selector(target)}[${window}]))`
  return `${rate(numerator)} / ${rate(denominator)} > ${number(threshold)}` as Expr
}

/** No increments within `window`, including a series that never existed. */
export function absent(target: Selectable, { window }: { readonly window: Duration }): Expr {
  const series = selector(target)
  return `sum(increase(${series}[${window}])) == 0 or absent(${series})` as Expr
}
