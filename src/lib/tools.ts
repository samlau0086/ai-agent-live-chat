import { store } from "./store";
import type { ConversationWithMessages } from "./types";

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, string>;
  invoke: (input: Record<string, unknown>, context: { conversation?: ConversationWithMessages }) => Promise<unknown>;
};

export const tools: AgentTool[] = [
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

export async function invokeTool(
  name: string,
  input: Record<string, unknown>,
  context: { conversation?: ConversationWithMessages },
) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  try {
    const output = await tool.invoke(input, context);
    await store.addToolInvocationLog({
      toolName: name,
      conversationId: context.conversation?.id,
      input,
      output,
      status: "success",
    });
    return output;
  } catch (error) {
    await store.addToolInvocationLog({
      toolName: name,
      conversationId: context.conversation?.id,
      input,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
