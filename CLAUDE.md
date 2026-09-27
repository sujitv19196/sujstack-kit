# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is `sujstack-kit`: the ports and adapters that apps (e.g. `sujstack-demo`) mount as a git
submodule at `kit/`. Nothing here may import from, or know about, a consuming app.

## Commands

```bash
bun install
bun run typecheck           # tsc --noEmit in every package
bun run check               # Biome lint + format (read-only)
bun run check:fix           # Biome, writing fixes — run this before finishing
bun test                    # every test
bun test ports/obs-core     # one package
bun test -t "regex"         # one test by name
```

When mounted in an app, run these from inside `kit/`, and do **not** leave a `kit/node_modules`
behind: it shadows the app's dependencies and yields duplicate `@trpc/server` types. Verify
standalone in a separate clone instead.

There is **no build step**. Packages are consumed as TypeScript source and compiled by the app
(e.g. Next's `transpilePackages`). A new package must be added to each consuming app's list.

## Layout

| Package | Role |
| --- | --- |
| `ports/db-core` | `KeyValueStore`, `VectorStore`, `defineNamespace`, contract suites. Zero runtime dependencies. |
| `ports/obs-core` | `EventSink` + the `createLog` facade. Zero runtime dependencies. |
| `ports/metrics-core` | `MetricSink`, typed counters, `createMetrics`, rule builders. Zero runtime dependencies. |
| `ports/trpc-core` | `createTrpc<C extends BaseContext>()`, `trpcCounterDefs`, `GENERIC_API_ERROR_MESSAGE`. |
| `adapters/db` | `@sujstack/db-adapters`: `./kv/memory`, `./vector/memory`, `./postgres`. |
| `adapters/obs` | `@sujstack/obs-adapters`: `./console`, `./sentry`. |
| `adapters/metrics` | `@sujstack/metrics-adapters`: `./console`, `./otlp`. |

The `-core` packages do not list an adapter package as a dependency, so code holding a port
physically cannot reach a provider. One subpath export per adapter, so importing one never pulls
in another's dependencies.

There is **no config union, factory or registry** here. The consuming app's composition root calls
adapter constructors directly; a factory in the kit would force a fork to add a provider.

**Nothing here reads `process.env`.** Credentials and URLs are parameters, passed down as data by
the app's composition root (`createPostgres({ url, schema })`, `createOtlpSink(options, counters)`).

## Conventions

- **Rationale lives in `README.md`, not in comments.** Comments say what non-obvious code *does*, in
  one terse line. Most functions have none. When you make a design decision, add a paragraph to the
  README's *Design decisions* section rather than arguing it in a code comment.
- **Biome, not ESLint/Prettier.** Double quotes, **no semicolons**, 100 columns, 2-space indent.
- **Adapters are closure-based factory functions returning object literals, never classes.** Private
  state lives in closure variables. See `adapters/db/src/kv/memory.ts`.
- **Contract suites live with the port** and are the executable spec of what it means
  (`@sujstack/db-core/testing`), so an adapter's test file is three lines. `obs-core` has none on
  purpose: `write(record): void` with no return, no throw and no readback has no semantics to assert.
- **Optional arguments are used sparingly.** A discriminated union when the return shape depends on
  the argument or absence is ambiguous (`KvEntry<T>` over `T | null`); a plain optional only for one
  independent knob with an obvious safe default; required when there is no safe default.
- `exactOptionalPropertyTypes` is on, so a surviving optional means "absent", never "present and
  undefined" — build records with `...(x !== undefined && { x })` rather than assigning `undefined`.
- `error()` requires its cause and passes it through **raw**; Sentry needs the live `Error`. Do not
  serialize it in the facade.
- Metric labels are a type parameter; a label typed as plain `string` is a compile error (the
  cardinality guard). `promName` in `ports/metrics-core/src/counter.ts` owns the OTLP → Prometheus
  name translation.
- `createTrpc` is generic over the app's context. Keep the kit ignorant of any app type: the
  middleware may only touch `BaseContext` (`log`, `metrics`).
- `bun test` does **not** typecheck. Type-level assertions need `@ts-expect-error` in a file that
  `bun run typecheck` sees (see `ports/metrics-core/src/types.test.ts`,
  `ports/trpc-core/src/create-trpc.test.ts`).
