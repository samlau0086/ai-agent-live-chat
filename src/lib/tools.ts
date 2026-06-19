import { toolInvocationEventPayload } from "./event-contracts";
import { store } from "./store";
import type { ConversationWithMessages, ToolDefinition, ToolInvocationLog, ToolPermissionScope } from "./types";
import { emitWebhook } from "./webhooks";

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, string>;
  inputSchema: Record<string, unknown>;
  authConfig: Record<string, unknown>;
  timeoutMs: number;
  enabled: boolean;
  permissionScope: ToolPermissionScope;
  invoke: (input: Record<string, unknown>, context: { conversation?: ConversationWithMessages }) => Promise<unknown>;
};

type BuiltInTool = Pick<AgentTool, "name" | "description" | "parameters" | "invoke">;

function parametersToSchema(parameters: Record<string, string>) {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(parameters).map(([name, description]) => [name, { type: "string", description }]),
    ),
    additionalProperties: true,
  };
}

export const builtInTools: BuiltInTool[] = [
  {
    name: "lookup_customer_profile",
    description: "Returns known metadata for the current visitor session.",
    parameters: { conversationId: "Current conversation id" },
    async invoke(_input, context) {
      return {
        conversationId: context.conversation?.id,
        externalUserId: context.conversation?.externalUserId,
        metadata: context.conversation?.metadata ?? {},
      };
    },
  },
  {
    name: "create_support_note",
    description: "Records a support note in the conversation timeline.",
    parameters: { note: "Internal support note" },
    async invoke(input, context) {
      if (!context.conversation) throw new Error("Conversation required");
      const note = String(input.note ?? "").trim();
      if (!note) throw new Error("note is required");
      return store.addMessage({
        conversationId: context.conversation.id,
        role: "system",
        content: `Support note: ${note}`,
        metadata: { source: "tool" },
      });
    },
  },
];

function applyDefinition(tool: BuiltInTool, definition?: ToolDefinition): AgentTool {
  return {
    ...tool,
    description: definition?.description || tool.description,
    inputSchema: definition?.inputSchema ?? parametersToSchema(tool.parameters),
    authConfig: definition?.authConfig ?? {},
    timeoutMs: definition?.timeoutMs ?? 5000,
    enabled: definition?.enabled ?? true,
    permissionScope: definition?.permissionScope ?? "ai",
  };
}

export async function listConfiguredTools(scope?: ToolPermissionScope) {
  const definitions = await store.listToolDefinitions();
  const configured = builtInTools.map((tool) =>
    applyDefinition(
      tool,
      definitions.find((definition) => definition.name === tool.name),
    ),
  );
  const definitionOnlyTools = definitions
    .filter((definition) => !builtInTools.some((tool) => tool.name === definition.name))
    .map((definition) =>
      applyDefinition(
        {
          name: definition.name,
          description: definition.description,
          parameters: {},
          async invoke() {
            throw new Error(`Tool ${definition.name} has no server implementation`);
          },
        },
        definition,
      ),
    );
  const tools = [...configured, ...definitionOnlyTools].sort((a, b) => a.name.localeCompare(b.name));
  return scope ? tools.filter((tool) => tool.enabled && tool.permissionScope === scope) : tools;
}

export async function invokeTool(
  name: string,
  input: Record<string, unknown>,
  context: { conversation?: ConversationWithMessages },
) {
  const tool = (await listConfiguredTools()).find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!tool.enabled || !["ai", "agent"].includes(tool.permissionScope)) {
    throw new Error(`Tool is not enabled for invocation: ${name}`);
  }

  try {
    const output = await Promise.race([
      tool.invoke(input, context),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Tool timed out after ${tool.timeoutMs}ms`)), tool.timeoutMs);
      }),
    ]);
    const log = await store.addToolInvocationLog({
      toolName: name,
      conversationId: context.conversation?.id,
      input,
      output,
      status: "success",
    });
    await emitWebhook("tool.invocation", toolInvocationEventPayload(log as ToolInvocationLog));
    return output;
  } catch (error) {
    const log = await store.addToolInvocationLog({
      toolName: name,
      conversationId: context.conversation?.id,
      input,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    await emitWebhook("tool.invocation", toolInvocationEventPayload(log as ToolInvocationLog));
    throw error;
  }
}
