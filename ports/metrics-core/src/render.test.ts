import { expect, test } from "bun:test"
import { defineCatalog, defineCounter } from "./counter"
import { renderRules } from "./render"
import { absent, type Rule } from "./rules"

const jobs = defineCatalog({ "jobs.run": defineCounter({ description: "jobs" }) })["jobs.run"]

const rule: Rule = {
  alert: "JobsStopped",
  severity: "ticket",
  for: "5m",
  expr: absent(jobs, { window: "1h" }),
  summary: 'No "jobs" ran in an hour',
}

test("renders a Prometheus rule file that parses back to the same rules", () => {
  const yaml = renderRules("app", [rule, { ...rule, alert: "JobsPaged", runbook: "https://x/y" }])

  expect(Bun.YAML.parse(yaml)).toEqual({
    groups: [
      {
        name: "app",
        rules: [
          {
            alert: "JobsStopped",
            expr: "sum(increase(jobs_run_total[1h])) == 0 or absent(jobs_run_total)",
            for: "5m",
            labels: { severity: "ticket" },
            annotations: { summary: 'No "jobs" ran in an hour' },
          },
          {
            alert: "JobsPaged",
            expr: "sum(increase(jobs_run_total[1h])) == 0 or absent(jobs_run_total)",
            for: "5m",
            labels: { severity: "ticket" },
            annotations: { summary: 'No "jobs" ran in an hour', runbook_url: "https://x/y" },
          },
        ],
      },
    ],
  })
})

test("output is byte-stable", () => {
  expect(renderRules("app", [rule])).toBe(renderRules("app", [rule]))
})
