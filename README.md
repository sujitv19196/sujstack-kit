# sujstack-kit

The ports and adapters behind [sujstack-demo](https://github.com/sujitv19196/sujstack-demo). An app
mounts this repo as a git submodule at `kit/`, lists `kit/ports/*` and `kit/adapters/*` in its
workspaces, and never edits inside it: taking an update is bumping the submodule's SHA.

Packages are TypeScript source with no build step. The consuming app compiles them, e.g. via Next's
`transpilePackages`.

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
| `ports/trpc-core` — `@sujstack/trpc-core` | `createTrpc<Context>()`: the logging/counting middleware and the error mask. |
| `adapters/db` — `@sujstack/db-adapters` | `./kv/memory`, `./vector/memory`, `./postgres` |
| `adapters/obs` — `@sujstack/obs-adapters` | `./console`, `./sentry` |
| `adapters/metrics` — `@sujstack/metrics-adapters` | `./console`, `./otlp` |

Ports have no third-party runtime dependencies (`trpc-core` aside, which is tRPC plumbing). Each
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
  ...trpcCounterDefs,
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
export const { router, publicProcedure, middleware, createCallerFactory } = createTrpc<Context>()
```

`Context` must extend `BaseContext` (`log`, and `metrics` over a catalog that includes
`trpcCounterDefs`). Every call that reaches a procedure is logged as `trpc.<path>` and counted in
`trpc.requests{outcome}`: `INTERNAL_SERVER_ERROR` at `error` with the cause, every other code at
`warn` with its detail. Errors that never reach a procedure are the app's handler's job.

## Design decisions

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
label's values; nothing needs either yet. This is also why `trpc.requests` has no `path` label:
the middleware only has `path` as a `string`, and the per-path breakdown lives in the logs.

**Counters are cumulative, one series per instance.** Prometheus and Mimir expect cumulative
temporality. Each process sets a random `service.instance.id`, which becomes the `instance` label,
so two instances' cumulative totals never collide in one series; rules aggregate with `sum(...)`.
On serverless this means one short-lived series per instance, and the periodic reader can lose the
last export interval when a function is frozen — an adapter concern, like the note on `write()`.

**Errors are masked at the tRPC boundary, not only at render.** `errorFormatter` in `createTrpc`
replaces an `INTERNAL_SERVER_ERROR`'s message with `GENERIC_API_ERROR_MESSAGE` and strips its stack,
so neither reaches the browser; the server keeps both in the log. Client faults keep their message,
which the caller needs in order to fix the request. Masking only at render would hide a server
fault from the user but not from the network tab.

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
