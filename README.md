# sujstack-kit

Ports and adapters for Bun + Next apps. An app mounts this repo as a git submodule at `kit/`, lists
`kit/ports/*` and `kit/adapters/*` in its workspaces, and never edits inside it: taking an update
is bumping the submodule's SHA.

Packages are TypeScript source with no build step. The consuming app compiles them, e.g. via Next's
`transpilePackages`.

For a working app built on it, see [sujstack](https://github.com/sujitv19196/sujstack).

```bash
bun install
bun run typecheck    # tsc --noEmit in every package
bun test             # contract suites + adapter tests
bun run check        # Biome lint + format
```

## Layout

| Package | Role |
| --- | --- |
| `ports/db-core` — `@sujstack/db-core` | `KeyValueStore`, `VectorStore`, `defineNamespace`, contract suites. |
| `ports/obs-core` — `@sujstack/obs-core` | `EventSink`, the `createLog` facade, a memory test sink. |
| `ports/metrics-core` — `@sujstack/metrics-core` | `MetricSink`, typed counters, `createMetrics`, alert-rule builders, `renderRules`. |
| `ports/trpc-core` — `@sujstack/trpc-core` | `createTrpc<Context>()`: the error mask, a bare `procedure` and the `logged` middleware. |
| `ports/webhook-core` — `@sujstack/webhook-core` | `WebhookVerifier`, the logged `createWebhookHandler`, `WebhookDelivery`, a verifier contract suite. |
| `adapters/db` — `@sujstack/db-adapters` | `./kv/memory`, `./vector/memory`, `./postgres` |
| `adapters/obs` — `@sujstack/obs-adapters` | `./console`, `./sentry` |
| `adapters/metrics` — `@sujstack/metrics-adapters` | `./console`, `./otlp` |

Ports have no third-party runtime dependencies (`trpc-core` aside, which is tRPC plumbing).
`webhook-core` has no adapters package: verifiers are written by the app. Each
adapter is its own subpath export, so importing the console sink never pulls in Sentry or OTel.

## Ports and adapters

- A **port** names a capability in the application's vocabulary — `KeyValueStore`, `EventSink`.
  It knows nothing about any provider.
- An **adapter** is one technology's answer to a port — `createMemoryKv`, `createSentrySink`. The
  arrow only points one way, and `package.json` enforces it: a `-core` package does not list an
  adapter package as a dependency, so code holding a port physically cannot reach a provider.
- The **composition root** lives in the app, not here. It is the only module that names a concrete
  adapter, reads `process.env`, and passes credentials down as data. Nothing in the kit reads the
  environment.

Drizzle is deliberately *not* wrapped in a port. It already abstracts the SQL dialect; another
interface in front of it would be an abstraction over an abstraction. `createPostgres({ url, schema })`
only manages the connection: its `db` is a lazy `Proxy`, so creating it opens nothing and the first
query throws `DatabaseNotConfiguredError` when `url` is `undefined`.

### Writing an adapter

Adapters are closure-based factory functions returning object literals, never classes. Prove one
conforms by running the port's contract suite against it:

```ts
import { runKvContract } from "@sujstack/db-core/testing"
runKvContract("redis", () => createRedisKv(url))
```

The contract suites live with the ports because they are the executable specification of what a
port means. `obs-core` has none on purpose: `write(record): void` with no return, no throw and no
readback has no semantics to assert. `@sujstack/obs-core/testing` and
`@sujstack/metrics-core/testing` ship `createMemorySink` for asserting what code logged or counted.
It is a test double, not an adapter — unlike `createMemoryKv`, nothing would ever run it.

## Logging

```ts
log.debug|info|warn(message, fields?)
log.error(message, cause, fields?)
```

The message is a free-form string chosen by the caller. Keep it static and put the variable part in
`fields`, so the backend can group on the message.

## Metrics

```ts
const counters = defineCatalog({
  "app.signups": defineCounter<{ plan: "free" | "pro" }>({ description: "Completed signups" }),
})
const metrics = createMetrics(counters, sinks)
metrics.increment("app.signups", { plan: "pro" })
```

Rules are built from typed counters, never from metric-name strings, and `renderRules` compiles them
to a standard Prometheus rule file. `rateAbove`, `ratioAbove` and `absent` cover the common shapes;
anything else uses the `promql` tag, whose interpolations must be counters or `select(...)`.

## tRPC

```ts
const t = createTrpc<Context>({ genericErrorMessage: "Something went wrong." })  // option defaults to GENERIC_API_ERROR_MESSAGE
const baseProcedure = t.procedure.use(t.logged)  // logged first: it wraps everything after it
export const publicProcedure = baseProcedure
export const protectedProcedure = baseProcedure.use(requireAuth)
```

`Context` must extend `BaseContext`: `log`, and `onCall(call: TrpcCall)`. The kit hands back a bare
`procedure` and the `logged` middleware; the app composes its own base procedures from them. Every
call through `logged` is logged as `trpc.<path>` — `INTERNAL_SERVER_ERROR` at `error` with the
cause, every other code at `warn` with its detail — and then passed to `ctx.onCall`, where the app
counts it:

```ts
onCall: (call) => metrics.increment("trpc.requests", { outcome: call.outcome })
```

Errors that never reach a procedure are the app's handler's job.

## Webhooks

```ts
export const POST = createWebhookHandler({
  source: "stripe",
  verifier: createStripeVerifier(secret),  // the app's own WebhookVerifier
  log,
  handle: async (event) => { ... },        // event: { id, type, payload }
  onDelivery: ({ outcome }) => metrics.increment("webhooks.received", { source: "stripe", outcome }),
})
```

A `WebhookVerifier` checks one provider's signature scheme against the raw body and extracts the
event, or rejects with a `reason`. The handler reads the raw body, verifies it, and only then calls
`handle`. Each delivery is logged as `webhook.<source>` and then passed to `onDelivery` as a
`WebhookDelivery`: accepted at `info` (200), rejected at `warn` with its reason (401, or 400 for
`malformed`) without reaching `handle`, and a throw from `handle` at `error` with the cause (500, so
the provider retries). Prove a verifier conforms with the contract suite:

```ts
import { runVerifierContract } from "@sujstack/webhook-core/testing"
runVerifierContract("stripe", { verifier, body: sampleDelivery, sign: signLikeStripe })
```

Providers retry, so the same event can arrive twice; `event.id` is stable across retries, and
skipping repeats is the app's decision.

## Design decisions

**Webhooks: a port with no adapters.** `webhook-core` owns what is the same for every provider —
reading the raw body, verifying before parsing, mapping outcomes to status codes, and logging each
delivery the way `logged` does for tRPC. It ships no Stripe or GitHub verifier:
each is a few lines around the provider's own SDK, every scheme change upstream would become a kit
release, and which providers exist is the app's choice. The contract suite is what the kit offers
an app-written verifier instead. Deduplicating retries is also left to the app, which knows
whether a repeat matters and where to record it.

**The kit logs; the app counts.** `logged` and `createWebhookHandler` classify each call or delivery
and log it, then hand a discriminated union (`TrpcCall`, `WebhookDelivery`) to a required callback;
they never call `metrics.increment`. A kit that incremented would own the counter's name and exact
label set, so an app could not add a label (a bounded event type, a tenant tier), rename the counter
or split it without forking. Log fields are open, so logging has no such cost and stays in the kit.
Counters then live only in the app's catalog, and the kit carries no label types: a kit-built
counter generic over the app's sources could not check `Bounded` without a cast. `onCall` is a
context field rather than a `createTrpc` option because tRPC cannot prove the middleware's `ctx` is
the app's `C` while `C` is generic; on the context, it needs only `BaseContext`, and a test injects
its own the same way it injects `log`. The cost is one line of mapping in the app per callback.


**Messages are free-form; there is no event catalog.** Grouping is the backend's job — Sentry
fingerprints on the stack and the message — so a hand-maintained list of keys in code would
duplicate it and add an edit to every new log line. Nothing is sampled either: sampling solves
ingest cost, which is a different problem, and it turns error counts into estimates. There is no
`minLevel` in the facade: verbosity is an adapter property, and the Sentry adapter is where a floor
belongs.

**One `write()` is one delivery.** `EventSink.write` returns `void`, must not throw, and must not
block; batching, retries and delivery are the adapter's business, and the model is eventual
consistency. A logging call must never fail the request it is logging about, so `createLog` isolates
each sink in a `try`/`catch`. Adapter authors on serverless should note that a bare `void fetch(…)`
can be killed when the response returns — that is an adapter concern, deliberately not in the port.

**`error()` requires its cause, and the cause stays raw.** The failure mode is
`log.error(message, { error: err.message })`, which flattens an `Error` into a string and destroys the
stack. Making the cause a required parameter gives the `Error` a home, and the facade passes it
through untouched so Sentry can parse the real stack and fingerprint on it — a pre-serialised object
would break both. The console adapter relies on the runtime printing `cause` chains natively.

**Metrics are separate from logs, and they do have a catalog.** A log message can be free-form
because nothing refers back to it. An alert rule does refer back to a metric, so a metric needs a
declared, stable key: renaming a counter must break the rule that watches it at compile time, not
leave the rule silently watching nothing.

**Alert rules are declared in code and evaluated by the backend.** Code is the source of truth, so
the rules live beside the counters they reference. Evaluation does not: an in-process evaluator
would lose its windows on every restart and see only one instance's traffic. The rules compile to
Prometheus rule YAML, which every Prometheus-compatible backend loads and Grafana displays.

**Rules are built with typed builders, not written as YAML.** Hand-written PromQL names metrics
as strings, and those strings are not the names in code: OTLP ingestion rewrites
`trpc.requests` to `trpc_requests_total`. `promName` is the one place that translation lives. The
builders are deliberately thin — there is no PromQL AST — and the `promql` tag is the escape
hatch that keeps metric references typed while allowing any expression.

**Labels are a type parameter, not a runtime value list.** `defineCounter<{ outcome: "ok" | "error" }>`
gives the same compile-time checking at `increment` and in `select` as an `as const` array would,
without the ceremony, and it can reuse unions the domain already has. A label typed as plain
`string` is a compile error, so an unbounded label (a user id, a raw path) cannot be declared at
all — that is the cardinality guard. The cost is no runtime validation and no way to enumerate a
label's values; nothing needs either yet. This is also why the app's `trpc.requests` has no `path` label:
`TrpcCall.path` is a `string`, and the per-path breakdown lives in the logs.

**Counters are cumulative, one series per instance.** Prometheus and Mimir expect cumulative
temporality. Each process sets a random `service.instance.id`, which becomes the `instance` label,
so two instances' cumulative totals never collide in one series; rules aggregate with `sum(...)`.
On serverless this means one short-lived series per instance, and the periodic reader can lose the
last export interval when a function is frozen — an adapter concern, like the note on `write()`.

**Errors are masked at the tRPC boundary, not only at render.** `errorFormatter` in `createTrpc`
replaces an `INTERNAL_SERVER_ERROR`'s message with `genericErrorMessage` and strips its stack,
so neither reaches the browser; the server keeps both in the log. Client faults keep their message,
which the caller needs in order to fix the request. Masking only at render would hide a server
fault from the user but not from the network tab.

**The app composes its procedures; the kit does not hand back a finished one.** Which middleware
every call runs — logging, then auth, rate limiting, tenancy — is the app's decision, the same way
choosing adapters is. So `createTrpc` returns the pieces (`procedure`, `logged`, `middleware`) and
the app's `init.ts` assembles a logged base and the procedures built on it. The cost is that logging
is no longer guaranteed by construction: a base procedure that skips `logged` goes unlogged and
never reaches `onCall`, so the app's request counter and its alert stop seeing it.

**No tRPC transformer.** superjson mainly exists to stop Drizzle `Date` columns arriving at the
client as strings while the types still claim `Date`. Timestamp columns use `mode: "string"`
instead, so the types are honest end to end and there is nothing left to fix.

**Vector `id` is a plain `string`, not a UUID.** TypeScript has no UUID type, and providers
disagree: Pinecone and Chroma accept arbitrary strings, pgvector takes whatever the primary key
is, and Qdrant accepts only unsigned ints or UUIDs. Constraining the shared interface to UUIDs
would make everyone pay Qdrant's tax and rule out natural composite keys like `doc-42#chunk-3`,
which let a match be traced straight back to its source document. A Qdrant adapter should hash
non-UUID ids at its own boundary.

**`VectorMatch.score` is always higher-is-better.** Cosine and dot product behave that way
already; Euclidean is a distance, so Euclidean adapters invert it. Otherwise every call site
would need to know which provider is behind the interface — exactly the leak the abstraction
exists to prevent.

**Biome, not ESLint + Prettier.** `eslint-config-next` bundles `typescript-eslint`, whose peer
range excludes TypeScript 7 — it drives the TS compiler API directly, and the Go port reshaped it.
Biome parses TypeScript with its own Rust parser and has no dependency on the `typescript`
package, so TS 7 and linting coexist. It replaces Prettier too.

## Conventions

**Optional arguments are used intentionally and sparingly.**

- A **discriminated union** when the return shape depends on the argument, or when absence is
  ambiguous — `KvEntry<T>` rather than `T | null` (which breaks down as soon as `T` can itself be
  null), and `include` selecting between `query` overloads rather than `includeVectors?: boolean`
  plus an optional `vector?`.
- A **plain optional** for one independent knob with an obvious safe default — `ttlSeconds`,
  `filter`.
- **Required** when there is no safe default (`topK`, which drives cost and recall) or when a
  default would be dangerous — `clear(prefix)` takes a required prefix and there is no
  store-wide wipe anywhere in the interface. `createPostgres`'s `url` is `string | undefined`
  and required, so "no database" is always a decision the caller wrote down.

`exactOptionalPropertyTypes` is on, so a surviving optional means "absent", never "present and
undefined".

**Comments say what non-obvious code does.** They do not argue for design decisions or explain
concepts an implementer already knows — that material belongs in this file.

## Releases, and moving to npm

The kit's version is `version` in the root `package.json`, and each release is a git tag of the
same name (`v0.1.0`, …) on `main`. `bun pm version patch|minor|major` bumps the version, commits
and tags in one step; `git push --follow-tags` publishes both. A consuming app pins its `kit/`
submodule to a tag. One tag versions the whole kit: an app cannot take a fix to one adapter without taking every
other change in the same release.

Publishing to npm is the intended next step, once a second app consumes the kit or it goes public.
It is not a rename; it takes four changes:

1. **One package per adapter with third-party dependencies** — `obs-sentry`, `metrics-otlp`,
   `db-postgres` and so on. Subpath exports keep Sentry out of a bundle, but `npm install` still
   installs every dependency a package declares.
2. **Ports as `peerDependencies` of their adapters**, so an app always resolves one copy of each
   port. Two copies break `instanceof` on the port's errors and make the types disagree.
3. **A build step emitting `.js` and `.d.ts`.** Shipped `.ts` source is typechecked under the
   consumer's `tsconfig`, which `skipLibCheck` does not cover, and only runs where something
   transpiles `node_modules`. Building also retires `transpilePackages`.
4. **Changesets** for independent per-package versions, dependent bumps and changelogs.

An app then swaps `workspace:*` for version ranges and drops the submodule; developing the kit
against an app becomes `bun link`.
