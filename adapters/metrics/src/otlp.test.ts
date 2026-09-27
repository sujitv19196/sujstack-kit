import { expect, test } from "bun:test"
import { parseOtlpHeaders } from "./otlp"

test("parses the OTEL_EXPORTER_OTLP_HEADERS format", () => {
  expect(parseOtlpHeaders("Authorization=Basic%20abc%3D, X-Scope-OrgID=tenant ,junk,=x")).toEqual({
    Authorization: "Basic abc=",
    "X-Scope-OrgID": "tenant",
  })
})

test("an empty string is no headers", () => {
  expect(parseOtlpHeaders("")).toEqual({})
})
