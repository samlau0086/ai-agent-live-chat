import type { AgentTool } from "./tools";
import type { AIConfiguration, ConversationWithMessages, KnowledgeSearchResult, Message } from "./types";

export type AIProvider = {
  name: string;
  generateReply(input: {
    conversation: ConversationWithMessages;
    messages: Message[];
    tools: AgentTool[];
    aiConfig: AIConfiguration;
    knowledgeContext: KnowledgeSearchResult[];
  }): Promise<string>;
};

const mockProvider: AIProvider = {
  name: "mock",
  async generateReply({ messages, knowledgeContext }) {
    const latest = [...messages].reverse().find((message) => message.role === "visitor");
    const content = latest?.content ?? "";
    const source = knowledgeContext[0]
      ? ` I found a related knowledge entry: ${knowledgeContext[0].documentTitle}.`
      : "";
    return `AI assistant: I received "${content}".${source} A human agent can take over this conversation at any time.`;
  },
};

const openAIProvider: AIProvider = {
  name: "openai",
  async generateReply({ messages, aiConfig, knowledgeContext }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return aiConfig.fallbackMessage;
    }

    const knowledgePrompt = knowledgeContext.length
      ? `\n\nKnowledge context:\n${knowledgeContext
          .map((result, index) => `[${index + 1}] ${result.documentTitle}\n${result.content}`)
          .join("\n\n")}`
      : "";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: aiConfig.temperature,
        messages: [
          {
            role: "system",
            content: `${aiConfig.systemPrompt}${knowledgePrompt}`,
          },
          ...messages.slice(-12).map((message) => ({
            role: message.role === "visitor" ? "user" : "assistant",
            content: message.content,
          })),
        ],
      }),
    });

    if (!response.ok) {
      return "I am having trouble reaching the AI service right now. A human agent can help from the console.";
    }

    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() || "I am here to help. Could you share a bit more detail?";
  },
};

export function getAIProvider(aiConfig?: Pick<AIConfiguration, "provider">) {
  return (aiConfig?.provider ?? process.env.AI_PROVIDER) === "openai" ? openAIProvider : mockProvider;
}
