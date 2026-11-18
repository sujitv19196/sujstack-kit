import { expect, test } from "bun:test"
import type {
  CallToolResult,
  InitializeResult,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js"
import { createLog } from "@sujstack/obs-core"
import { createMemorySink } from "@sujstack/obs-core/testing"
import { type BaseContext, createTrpc, type TrpcCall } from "@sujstack/trpc-core"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { createMcpHandler, createMcpTools, type McpMeta } from "./trpc"

const GENERIC = "Something went wrong."

function harness() {
  const sink = createMemorySink()
  const calls: TrpcCall[] = []
  type Context = BaseContext & { readonly user: string | null }
  const { router, procedure, logged, middleware } = createTrpc<Context, McpMeta>()
  const publicProcedure = procedure.use(logged)
  const requireUser = middleware(({ ctx, next }) => {
    if (ctx.user === null) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first" })
    return next({ ctx: { user: ctx.user } })
  })
  const protectedProcedure = publicProcedure.use(requireUser)

  const appRouter = router({
    hidden: publicProcedure.query(() => "not a tool"),
    notes: router({
      search: publicProcedure
        .meta({ mcp: { description: "Searches notes." } })
        .input(z.object({ text: z.string().min(1) }))
        .query(({ input }) => ({ hits: [input.text] })),
      list: publicProcedure.meta({ mcp: { description: "Lists notes." } }).query(() => ["a", "b"]),
      add: protectedProcedure
        .meta({ mcp: { description: "Adds a note as the signed-in user." } })
        .input(z.object({ text: z.string() }))
        .mutation(({ ctx, input }) => ({ by: ctx.user, text: input.text })),
      fault: publicProcedure
        .meta({ mcp: { description: "Fails." } })
        .input(z.object({ kind: z.enum(["client", "server"]) }))
        .mutation(({ input }) => {
          if (input.kind === "client") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "bad input" })
          }
          throw new Error("db-internal-7 refused")
        }),
    }),
  })

  const handle = createMcpHandler({
    router: appRouter,
    createContext: (request): Context => ({
      log: createLog([sink]),
      onCall: (call) => calls.push(call),
      user: request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null,
    }),
    toJsonSchema: (parser) => z.toJSONSchema(parser as z.ZodType, { io: "input" }),
    genericErrorMessage: GENERIC,
    server: { name: "test", version: "0.0.0" },
  })

  async function rpc<T>(method: string, params: object = {}, headers: Record<string, string> = {}) {
    const response = await handle(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    )
    expect(response.headers.get("content-type")).toContain("application/json")
    return (await response.json()) as { result?: T; error?: { code: number; message: string } }
  }
  const callTool = (name: string, args: object, headers?: Record<string, string>) =>
    rpc<CallToolResult>("tools/call", { name, arguments: args }, headers)

  return { rpc, callTool, sink, calls }
}

test("initialize advertises tools", async () => {
  const { rpc } = harness()

  const { result } = await rpc<InitializeResult>("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  })

  expect(result?.capabilities).toHaveProperty("tools")
  expect(result?.serverInfo).toEqual({ name: "test", version: "0.0.0" })
})

test("only opted-in procedures are listed, named by path, with schema and read-only hint", async () => {
  const { rpc } = harness()

  const { result } = await rpc<ListToolsResult>("tools/list")

  expect(result?.tools.map((tool) => tool.name)).toEqual([
    "notes_search",
    "notes_list",
    "notes_add",
    "notes_fault",
  ])
  const [search, list, add] = result?.tools ?? []
  expect(search).toMatchObject({
    description: "Searches notes.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    annotations: { readOnlyHint: true },
  })
  expect(list?.inputSchema).toEqual({ type: "object" })
  expect(add?.annotations).toEqual({ readOnlyHint: false })
})

test("a call runs the procedure, logs it and reports it to onCall", async () => {
  const { callTool, sink, calls } = harness()

  const { result } = await callTool("notes_search", { text: "hi" })

  expect(result).toEqual({
    content: [{ type: "text", text: '{"hits":["hi"]}' }],
    structuredContent: { hits: ["hi"] },
  })
  expect(sink.written().map((record) => [record.message, record.level])).toEqual([
    ["trpc.notes.search", "info"],
  ])
  expect(calls.map((call) => call.outcome)).toEqual(["ok"])
})

test("a non-object result is returned as text only", async () => {
  const { callTool } = harness()

  const { result } = await callTool("notes_list", {})

  expect(result).toEqual({ content: [{ type: "text", text: '["a","b"]' }] })
})

test("the procedure's middleware is the auth", async () => {
  const { callTool } = harness()

  const anonymous = await callTool("notes_add", { text: "x" })
  const signedIn = await callTool("notes_add", { text: "x" }, { authorization: "Bearer ada" })

  expect(anonymous.result).toEqual({
    isError: true,
    content: [{ type: "text", text: "Sign in first" }],
  })
  expect(signedIn.result?.structuredContent).toEqual({ by: "ada", text: "x" })
})

test("a client fault keeps its message and logs at warn", async () => {
  const { callTool, sink } = harness()

  const { result } = await callTool("notes_fault", { kind: "client" })

  expect(result).toEqual({ isError: true, content: [{ type: "text", text: "bad input" }] })
  expect(sink.written().map((record) => record.level)).toEqual(["warn"])
})

test("invalid input is a client fault", async () => {
  const { callTool, sink } = harness()

  const { result } = await callTool("notes_search", { text: "" })

  expect(result?.isError).toBe(true)
  expect(sink.written().map((record) => record.level)).toEqual(["warn"])
})

test("a server fault is masked for the model and logged raw at error", async () => {
  const { callTool, sink } = harness()

  const { result } = await callTool("notes_fault", { kind: "server" })

  expect(result).toEqual({ isError: true, content: [{ type: "text", text: GENERIC }] })
  expect(JSON.stringify(result)).not.toContain("db-internal-7")
  const [record] = sink.written()
  expect(record?.level).toBe("error")
  expect(record?.cause).toMatchObject({ message: "db-internal-7 refused" })
})

test("an unknown or hidden tool is a protocol error, logged once under a flat message", async () => {
  const { callTool, sink, calls } = harness()

  const { error } = await callTool("hidden", {})

  expect(error?.message).toContain("Tool hidden not found")
  expect(sink.written().map((record) => [record.message, record.level, record.fields])).toEqual([
    ["mcp.failed", "warn", { tool: "hidden", code: "NOT_FOUND" }],
  ])
  expect(calls).toEqual([])
})

test("a router that cannot be exposed is rejected when the handler is built", () => {
  const { router, procedure } = createTrpc<BaseContext, McpMeta>()
  const tool = (description: string) => procedure.meta({ mcp: { description } })
  const build = (appRouter: Parameters<typeof createMcpHandler>[0]["router"]) =>
    createMcpHandler({
      router: appRouter,
      createContext: () => {
        throw new Error("unused")
      },
      toJsonSchema: (parser) => z.toJSONSchema(parser as z.ZodType),
      genericErrorMessage: GENERIC,
      server: { name: "test", version: "0" },
    })

  expect(() =>
    build(
      router({
        a: router({ b_c: tool("x").query(() => 1) }),
        a_b: router({ c: tool("y").query(() => 1) }),
      }),
    ),
  ).toThrow('"a_b_c" is derived from both')
  expect(() => build(router({ "bad name": tool("x").query(() => 1) }))).toThrow("must match")
  expect(() =>
    build(
      router({
        s: tool("x")
          .input(z.string())
          .query(() => 1),
      }),
    ),
  ).toThrow("object input")
  expect(() =>
    build(
      router({
        two: tool("x")
          .input(z.object({ a: z.string() }))
          .input(z.object({ b: z.string() }))
          .query(() => 1),
      }),
    ),
  ).toThrow("chains 2")
})

test("createMcpTools gives a caller the tools the endpoint serves, run through their middleware", async () => {
  type Context = BaseContext & { readonly user: string | null }
  const { router, procedure, logged, middleware } = createTrpc<Context, McpMeta>()
  const requireUser = middleware(({ ctx, next }) => {
    if (ctx.user === null) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first" })
    return next({ ctx: { user: ctx.user } })
  })
  const appRouter = router({
    hidden: procedure.use(logged).query(() => "not a tool"),
    notes: router({
      add: procedure
        .use(logged)
        .use(requireUser)
        .meta({ mcp: { description: "Adds a note." } })
        .input(z.object({ text: z.string() }))
        .mutation(({ ctx, input }) => ({ by: ctx.user, text: input.text })),
      boom: procedure
        .use(logged)
        .meta({ mcp: { description: "Fails." } })
        .query(() => {
          throw new Error("internal detail")
        }),
    }),
  })
  const tools = createMcpTools({
    router: appRouter,
    toJsonSchema: (parser) => z.toJSONSchema(parser as z.ZodType, { io: "input" }),
    genericErrorMessage: GENERIC,
  })
  const context = (user: string | null): Context => ({
    log: createLog([createMemorySink()]),
    onCall: () => {},
    user,
  })
  const signal = new AbortController().signal

  expect([...tools.keys()]).toEqual(["notes_add", "notes_boom"])
  expect(tools.get("notes_add")?.definition).toMatchObject({
    name: "notes_add",
    description: "Adds a note.",
    annotations: { readOnlyHint: false },
  })

  const added = await tools.get("notes_add")?.call(context("ada"), { text: "hi" }, signal)
  expect(added).toMatchObject({ structuredContent: { by: "ada", text: "hi" } })

  const refused = await tools.get("notes_add")?.call(context(null), { text: "hi" }, signal)
  expect(refused).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "Sign in first" }],
  })

  const failed = await tools.get("notes_boom")?.call(context("ada"), {}, signal)
  expect(failed).toMatchObject({ isError: true, content: [{ type: "text", text: GENERIC }] })
})

// Never called: `bun run typecheck` fails if any line below stops being a type error.
function misuse() {
  const { procedure } = createTrpc<BaseContext, McpMeta>()
  // @ts-expect-error exposing a procedure requires a description
  procedure.meta({ mcp: {} })
}
void misuse
