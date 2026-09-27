import { describe, expect, test } from "bun:test"
import type { WebhookVerifier } from "../verifier"

/**
 * Runs the WebhookVerifier contract. `body` is a delivery in the provider's format; `sign`
 * returns the headers the provider would send with it.
 */
export function runVerifierContract(
  name: string,
  fixture: {
    verifier: WebhookVerifier
    body: string
    sign: (body: string) => Headers | Promise<Headers>
  },
): void {
  const { verifier, body, sign } = fixture

  describe(`WebhookVerifier contract: ${name}`, () => {
    test("accepts a signed delivery, with a stable id and a type", async () => {
      const first = await verifier.verify(await sign(body), body)
      const retry = await verifier.verify(await sign(body), body)

      expect(first).toMatchObject({ ok: true })
      if (!first.ok || !retry.ok) return
      expect(first.event.id).not.toBe("")
      expect(first.event.type).not.toBe("")
      expect(retry.event.id).toBe(first.event.id)
    })

    test("rejects a delivery without signature headers", async () => {
      expect(await verifier.verify(new Headers(), body)).toEqual({
        ok: false,
        reason: "missing_signature",
      })
    })

    test("rejects a body altered after signing", async () => {
      expect(await verifier.verify(await sign(body), `${body} `)).toEqual({
        ok: false,
        reason: "bad_signature",
      })
    })
  })
}
