import type { Log } from "@sujstack/obs-core"
import type { RejectReason, WebhookEvent, WebhookVerifier } from "./verifier"

/** One delivery's result, as reported to `onDelivery`. */
export type WebhookDelivery = { readonly durationMs: number } & (
  | { readonly outcome: "accepted"; readonly event: WebhookEvent }
  | { readonly outcome: "rejected"; readonly reason: RejectReason }
  | { readonly outcome: "failed"; readonly event: WebhookEvent; readonly cause: unknown }
)

const STATUS: Record<RejectReason, number> = {
  missing_signature: 401,
  bad_signature: 401,
  stale: 401,
  malformed: 400,
}

/**
 * A route handler: verifies the raw body, then runs `handle`. Emits one `webhook.<source>` event
 * and one `onDelivery` per delivery. A throw from `handle` answers 500.
 */
export function createWebhookHandler({
  source,
  verifier,
  log,
  handle,
  onDelivery,
}: {
  source: string
  verifier: WebhookVerifier
  log: Log
  handle: (event: WebhookEvent) => Promise<void>
  /** Runs after every delivery */
  onDelivery: (delivery: WebhookDelivery) => void
}): (request: Request) => Promise<Response> {
  const message = `webhook.${source}`

  return async (request) => {
    const startedAt = performance.now()
    const elapsed = () => Math.round(performance.now() - startedAt)
    const verification = await verifier.verify(request.headers, await request.text())

    if (!verification.ok) {
      const { reason } = verification
      const durationMs = elapsed()
      log.warn(message, { reason, durationMs })
      onDelivery({ outcome: "rejected", reason, durationMs })
      return Response.json({ error: reason }, { status: STATUS[reason] })
    }

    const { event } = verification
    try {
      await handle(event)
    } catch (cause) {
      const durationMs = elapsed()
      log.error(message, cause, { id: event.id, type: event.type, durationMs })
      onDelivery({ outcome: "failed", event, cause, durationMs })
      return Response.json({ error: "handler_failed" }, { status: 500 })
    }
    const durationMs = elapsed()
    log.info(message, { id: event.id, type: event.type, durationMs })
    onDelivery({ outcome: "accepted", event, durationMs })
    return Response.json({ received: true })
  }
}
