---
name: write-adapter
description: Write a new sujstack-kit adapter for an existing port (a KeyValueStore, VectorStore, EventSink, MetricSink or JobQueue backed by a new provider such as Redis, Pinecone or Datadog). Use when adding a provider to the kit.
---

Read *Ports and adapters* and *Writing an adapter* in `README.md`, and the conventions in `CLAUDE.md`.

1. Put it in the port's adapters package (`adapters/db`, `adapters/obs`, `adapters/metrics`,
   `adapters/jobs`) as its own file, and add **one subpath export** for it in that package's
   `package.json`, so importing it never pulls in another adapter's dependencies. Pin the provider
   SDK to an exact version.
2. Write a closure-based factory, `create<Provider><Port>(options)`, returning an object literal
   that implements the port. No classes, no `process.env`: credentials and URLs are parameters.
   No config union, factory or registry.
3. Prove it with the port's contract suite in a three-line test, e.g.
   `runKvContract("redis", () => createRedisKv(url))` from `@sujstack/db-core/testing`. A suite that
   needs a live service runs only when its env var is set, as `adapters/jobs` does with
   `TEST_DATABASE_URL`.
4. Add it to the layout tables in `README.md` and `CLAUDE.md`, and a *Design decisions* paragraph
   for any choice a reader would question.
5. `bun run typecheck && bun test && bun run check` inside `kit/`, then release it: use the
   `release-kit` skill.

A new port is a bigger change: interface plus contract suite in a `-core` package with no adapter
dependency. Discuss it before writing one.
