import { expect, test } from "bun:test"
import { defineCatalog, defineCounter, promName } from "./counter"

test("the catalog key becomes the counter's name", () => {
  const counters = defineCatalog({ "jobs.run": defineCounter({ description: "jobs" }) })

  expect(counters["jobs.run"]).toEqual({ name: "jobs.run", description: "jobs" })
})

test("a name Prometheus cannot store is rejected", () => {
  for (const name of ["Jobs", "jobs-run", "jobs..run", "1jobs", "jobs."]) {
    expect(() => defineCatalog({ [name]: defineCounter({ description: "" }) })).toThrow(name)
  }
})

test("promName applies the OTLP translation", () => {
  const counters = defineCatalog({ "trpc.requests": defineCounter({ description: "" }) })

  expect(promName(counters["trpc.requests"])).toBe("trpc_requests_total")
})
