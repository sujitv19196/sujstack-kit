/** A delivery whose signature checked out. `id` is the provider's, stable across retries. */
export interface WebhookEvent {
  readonly id: string
  readonly type: string
  readonly payload: unknown
}

export type RejectReason = "missing_signature" | "bad_signature" | "stale" | "malformed"

export type Verification =
  | { readonly ok: true; readonly event: WebhookEvent }
  | { readonly ok: false; readonly reason: RejectReason }

/** Checks one provider's signature scheme against the raw body, then extracts the event. */
export interface WebhookVerifier {
  verify(headers: Headers, rawBody: string): Promise<Verification>
}
