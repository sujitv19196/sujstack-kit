import { expect, test } from "bun:test"
import { defineCatalog, defineCounter } from "./counter"
import { createMetrics } from "./metrics"
import { promql, rateAbove, select } from "./rules"

// Never called: `bun run typecheck` fails if any line below stops being a type error.
function misuse() {
  const counters = defineCatalog({
    "test.calls": defineCounter<{ outcome: "ok" | "failed" }>({ description: "" }),
    "test.plain": defineCounter({ description: "" }),
  })
  const metrics = createMetrics(counters, [])
  const calls = counters["test.calls"]

  // @ts-expect-error unknown key
  metrics.increment("test.missing", {})
  // @ts-expect-error label value outside the union
  metrics.increment("test.calls", { outcome: "maybe" })
  // @ts-expect-error missing required label
  metrics.increment("test.calls", {})
  // @ts-expect-error undeclared label on an unlabelled counter
  metrics.increment("test.plain", { outcome: "ok" })
  // @ts-expect-error unbounded label value
  defineCounter<{ path: string }>({ description: "" })
  // @ts-expect-error select on an undeclared label
  select(calls, { method: "get" })
  // @ts-expect-error a builder only takes a counter or selector
  rateAbove("test_calls_total", { window: "5m", threshold: 1 })
  // @ts-expect-error promql interpolation must be a counter or selector
  promql`sum(${"test_calls_total"})`
  // @ts-expect-error a rule window must be a Prometheus duration
  rateAbove(calls, { window: "five minutes", threshold: 1 })
}

test("type-level misuse is checked by tsc, not at runtime", () => {
  expect(misuse).toBeFunction()
})
