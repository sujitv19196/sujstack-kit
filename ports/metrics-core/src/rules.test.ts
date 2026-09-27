import { expect, test } from "bun:test"
import { defineCatalog, defineCounter } from "./counter"
import { absent, promql, rateAbove, ratioAbove, select } from "./rules"

const counters = defineCatalog({
  "http.requests": defineCounter<{ outcome: "ok" | "error"; method: "get" | "post" }>({
    description: "requests",
  }),
  "jobs.run": defineCounter({ description: "jobs" }),
})
const requests = counters["http.requests"]
const jobs = counters["jobs.run"]

test("rateAbove", () => {
  expect<string>(
    rateAbove(select(requests, { outcome: "error" }), { window: "5m", threshold: 2 }),
  ).toBe('sum(rate(http_requests_total{outcome="error"}[5m])) > 2')
})

test("ratioAbove", () => {
  expect<string>(
    ratioAbove(select(requests, { outcome: "error" }), requests, {
      window: "5m",
      threshold: 0.05,
    }),
  ).toBe(
    'sum(rate(http_requests_total{outcome="error"}[5m])) / sum(rate(http_requests_total[5m])) > 0.05',
  )
})

test("absent", () => {
  expect<string>(absent(jobs, { window: "1h" })).toBe(
    "sum(increase(jobs_run_total[1h])) == 0 or absent(jobs_run_total)",
  )
})

test("select renders every matcher and skips undefined ones", () => {
  expect<string>(
    rateAbove(select(requests, { outcome: "ok", method: "post" }), { window: "1m", threshold: 0 }),
  ).toBe('sum(rate(http_requests_total{outcome="ok",method="post"}[1m])) > 0')
})

test("promql interpolates counters and selectors as their Prometheus names", () => {
  expect<string>(
    promql`histogram_quantile(0.9, ${jobs}) or ${select(requests, { method: "get" })}`,
  ).toBe('histogram_quantile(0.9, jobs_run_total) or http_requests_total{method="get"}')
})

test("a non-finite threshold is rejected", () => {
  expect(() => rateAbove(jobs, { window: "5m", threshold: Number.NaN })).toThrow()
})
