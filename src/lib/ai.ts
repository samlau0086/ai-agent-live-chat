import type { AgentTool } from "./tools";
import type { ConversationWithMessages, Message } from "./types";

export type AIProvider = {
  name: string;
  generateReply(input: {
    conversation: ConversationWithMessages;
    messages: Message[];
    tools: AgentTool[];
  }): Promise<string>;
};

const mockProvider: AIProvider = {
  name: "mock",
  async generateReply({ messages }) {
    const latest = [...messages].reverse().find((message) => message.role === "visitor");
    const content = latest?.content ?? "";
    return `AI assistant: I received "${content}". A human agent can take over this conversation at any time.`;
  },
};

const openAIProvider: AIProvider = {
  name: "openai",
  async generateReply({ messages, tools }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return mockProvider.generateReply({ conversation: {} as never, messages, tools });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a concise customer support AI. Escalate politely when a human has taken over. Do not invent account data.",
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

export function getAIProvider() {
  return process.env.AI_PROVIDER === "openai" ? openAIProvider : mockProvider;
}
