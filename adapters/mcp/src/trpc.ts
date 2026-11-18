import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import type { BaseContext } from "@sujstack/trpc-core"
import {
  type AnyTRPCProcedure,
  type AnyTRPCRouter,
  callTRPCProcedure,
  getTRPCErrorFromUnknown,
  type inferRouterContext,
} from "@trpc/server"

/** Procedure meta. A procedure is exposed as a tool only when it sets `mcp`. */
export type McpMeta = { readonly mcp?: { readonly description: string } }

export type JsonSchema = Record<string, unknown>

type Target = { readonly path: string; readonly type: "query" | "mutation" }

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

/** One opted-in procedure as a tool: its MCP definition, and a call that runs the procedure. */
export interface McpTool<TContext> {
  readonly definition: Tool
  call(ctx: TContext, args: unknown, signal: AbortSignal): Promise<CallToolResult>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Every procedure whose meta sets `mcp`, as tools keyed by name (the path with `.` → `_`). Each
 * call goes through the procedure itself, so its middleware runs as usual. Throws on a bad tree.
 */
export function createMcpTools<TRouter extends AnyTRPCRouter>({
  router,
  toJsonSchema,
  genericErrorMessage,
}: {
  readonly router: TRouter
  /** Converts one `.input()` parser to JSON Schema, e.g. `z.toJSONSchema`. */
  readonly toJsonSchema: (parser: unknown) => JsonSchema
  /** Replaces the message of a server fault, which `errorFormatter` never sees on this path. */
  readonly genericErrorMessage: string
}): ReadonlyMap<string, McpTool<inferRouterContext<TRouter> & BaseContext>> {
  const tools = new Map<string, McpTool<inferRouterContext<TRouter> & BaseContext>>()
  const targets = new Map<string, Target>()
  const procedures = router._def.procedures as Record<string, AnyTRPCProcedure>

  for (const [path, procedure] of Object.entries(procedures)) {
    const { type, meta, inputs } = procedure._def
    const mcp = (meta as McpMeta | undefined)?.mcp
    if (mcp === undefined || type === "subscription") continue

    const name = path.replaceAll(".", "_")
    if (!TOOL_NAME.test(name)) {
      throw new Error(`MCP tool name "${name}" (from ${path}) must match ${TOOL_NAME}`)
    }
    const clash = targets.get(name)
    if (clash !== undefined) {
      throw new Error(`MCP tool name "${name}" is derived from both ${clash.path} and ${path}`)
    }
    if (inputs.length > 1) {
      throw new Error(`MCP tool ${path} chains ${inputs.length} .input() calls; expose one`)
    }
    const inputSchema = inputs[0] === undefined ? { type: "object" } : toJsonSchema(inputs[0])
    if (inputSchema.type !== "object") {
      throw new Error(`MCP tool ${path} must take an object input, not ${String(inputSchema.type)}`)
    }

    targets.set(name, { path, type })
    tools.set(name, {
      definition: {
        name,
        description: mcp.description,
        inputSchema: inputSchema as Tool["inputSchema"],
        annotations: { readOnlyHint: type === "query" },
      },
      async call(ctx, args, signal) {
        try {
          const result: unknown = await callTRPCProcedure({
            router,
            path,
            type,
            ctx,
            getRawInput: async () => args,
            signal,
            batchIndex: 0,
          })
          return {
            content: [{ type: "text", text: JSON.stringify(result ?? null) }],
            ...(isRecord(result) && { structuredContent: result }),
          }
        } catch (cause) {
          // Already logged by `logged`; only the message the caller sees is decided here.
          const error = getTRPCErrorFromUnknown(cause)
          const text = error.code === "INTERNAL_SERVER_ERROR" ? genericErrorMessage : error.message
          return { isError: true, content: [{ type: "text", text }] }
        }
      },
    })
  }
  return tools
}

/**
 * A stateless Streamable HTTP endpoint (JSON responses, no SSE) serving `createMcpTools`' tools.
 */
export function createMcpHandler<TRouter extends AnyTRPCRouter>({
  router,
  createContext,
  toJsonSchema,
  genericErrorMessage,
  server: info,
}: {
  readonly router: TRouter
  readonly createContext: (
    request: Request,
  ) =>
    | (inferRouterContext<TRouter> & BaseContext)
    | Promise<inferRouterContext<TRouter> & BaseContext>
  /** Converts one `.input()` parser to JSON Schema, e.g. `z.toJSONSchema`. */
  readonly toJsonSchema: (parser: unknown) => JsonSchema
  /** Replaces the message of a server fault, which `errorFormatter` never sees on this path. */
  readonly genericErrorMessage: string
  readonly server: { readonly name: string; readonly version: string }
}): (request: Request) => Promise<Response> {
  const tools = createMcpTools({ router, toJsonSchema, genericErrorMessage })
  const definitions = [...tools.values()].map((tool) => tool.definition)

  return async (request) => {
    const server = new Server(info, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: definitions }))
    server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
      const ctx = await createContext(request)
      const tool = tools.get(params.name)
      if (tool === undefined) {
        // The name is client input, so it stays in the fields.
        ctx.log.warn("mcp.failed", { tool: params.name, code: "NOT_FOUND" })
        throw new McpError(ErrorCode.InvalidParams, `Tool ${params.name} not found`)
      }
      return tool.call(ctx, params.arguments ?? {}, signal)
    })

    // No `sessionIdGenerator`: stateless, so each request gets a fresh server and transport.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(request)
    } finally {
      await server.close()
    }
  }
}
