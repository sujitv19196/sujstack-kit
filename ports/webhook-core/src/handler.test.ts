import { expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { createLog } from "@sujstack/obs-core"
import { createMemorySink } from "@sujstack/obs-core/testing"
import { createWebhookHandler, type WebhookDelivery } from "./handler"
import { runVerifierContract } from "./testing"
import type { WebhookVerifier } from "./verifier"

const hmac = (body: string) => createHmac("sha256", "secret").update(body).digest("hex")

const verifier: WebhookVerifier = {
  async verify(headers, rawBody) {
    const signature = headers.get("x-signature")
    if (signature === null) return { ok: false, reason: "missing_signature" }
    if (signature !== hmac(rawBody)) return { ok: false, reason: "bad_signature" }
    const { id, type } = JSON.parse(rawBody) as { id?: string; type?: string }
    if (id === undefined || type === undefined) return { ok: false, reason: "malformed" }
    return { ok: true, event: { id, type, payload: JSON.parse(rawBody) } }
  },
}

const signed = (body: string) => new Headers({ "x-signature": hmac(body) })

runVerifierContract("test hmac", {
  verifier,
  body: JSON.stringify({ id: "evt_1", type: "ping" }),
  sign: signed,
})

function harness(handle: () => Promise<void>) {
  const sink = createMemorySink()
  const deliveries: WebhookDelivery[] = []
  const handler = createWebhookHandler({
    source: "test",
    verifier,
    log: createLog([sink]),
    handle,
    onDelivery: (delivery) => deliveries.push(delivery),
  })
  return { handler, sink, deliveries }
}

function deliver(body: string, headers: Headers) {
  return new Request("http://localhost/hook", { method: "POST", headers, body })
}

test("an accepted delivery is logged at info and handled once", async () => {
  const handled: unknown[] = []
  const { handler, sink, deliveries } = harness(async () => void handled.push(1))
  const body = JSON.stringify({ id: "evt_1", type: "ping" })

  const response = await handler(deliver(body, signed(body)))

  expect(response.status).toBe(200)
  expect(handled).toHaveLength(1)
  expect(sink.written()).toMatchObject([
    { level: "info", message: "webhook.test", fields: { id: "evt_1", type: "ping" } },
  ])
  expect(deliveries).toMatchObject([{ outcome: "accepted", event: { id: "evt_1" } }])
})

test("a rejection is a warn with its reason, and never reaches handle", async () => {
  const handled: unknown[] = []
  const { handler, sink, deliveries } = harness(async () => void handled.push(1))
  const malformed = JSON.stringify({ id: "evt_1" })

  const unsigned = await handler(deliver("{}", new Headers()))
  const invalid = await handler(deliver(malformed, signed(malformed)))

  expect([unsigned.status, invalid.status]).toEqual([401, 400])
  expect(handled).toHaveLength(0)
  expect(sink.written().map((record) => [record.level, record.fields.reason])).toEqual([
    ["warn", "missing_signature"],
    ["warn", "malformed"],
  ])
  expect(deliveries).toMatchObject([
    { outcome: "rejected", reason: "missing_signature" },
    { outcome: "rejected", reason: "malformed" },
  ])
})

test("a throw from handle is an error with the raw cause, and answers 500", async () => {
  const cause = new Error("downstream refused")
  const { handler, sink, deliveries } = harness(async () => {
    throw cause
  })
  const body = JSON.stringify({ id: "evt_1", type: "ping" })

  const response = await handler(deliver(body, signed(body)))

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: "handler_failed" })
  expect(sink.written()).toMatchObject([{ level: "error", cause }])
  expect(deliveries).toMatchObject([{ outcome: "failed", cause }])
})

// Never called: `bun run typecheck` fails if any line below stops being a type error.
function misuse() {
  // @ts-expect-error onDelivery is required
  createWebhookHandler({ source: "test", verifier, log: createLog([]), handle: async () => {} })
  const onDelivery = (delivery: WebhookDelivery) => {
    // @ts-expect-error only a rejection carries a reason
    if (delivery.outcome === "accepted") delivery.reason
  }
  return onDelivery
}
void misuse
