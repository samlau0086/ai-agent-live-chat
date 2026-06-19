import type { AgentTool } from "./tools";
import type { AIConfiguration, ConversationWithMessages } from "./types";

export type AIProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIProviderPrompt = {
  messages: AIProviderMessage[];
  systemPrompt: string;
};

export type AIProviderToolCallPlaceholder = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
};

export type AIProviderResult = {
  text: string;
  toolCallPlaceholders: AIProviderToolCallPlaceholder[];
  finishReason?: string;
};

export type AIProvider = {
  name: string;
  generateReply(input: {
    conversation: ConversationWithMessages;
    prompt: AIProviderPrompt;
    tools: AgentTool[];
    aiConfig: AIConfiguration;
  }): Promise<AIProviderResult>;
};

function toolParametersSchema(tool: AgentTool) {
  return Object.keys(tool.inputSchema ?? {}).length
    ? tool.inputSchema
    : {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([name, description]) => [name, { type: "string", description }]),
        ),
        additionalProperties: true,
      };
}

function openAIToolDefinitions(tools: AgentTool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParametersSchema(tool),
    },
  }));
}

function parseToolArguments(rawArguments?: string) {
  if (!rawArguments) return {};
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const mockProvider: AIProvider = {
  name: "mock",
  async generateReply({ prompt }) {
    const latest = [...prompt.messages].reverse().find((message) => message.role === "user");
    const content = latest?.content ?? "";
    const source = prompt.systemPrompt.includes("Knowledge context") ? " I found related knowledge context." : "";
    return {
      text: `AI assistant: I received "${content}".${source} A human agent can take over this conversation at any time.`,
      toolCallPlaceholders: [],
      finishReason: "stop",
    };
  },
};

const openAIProvider: AIProvider = {
  name: "openai",
  async generateReply({ prompt, tools, aiConfig }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: aiConfig.temperature,
        messages: prompt.messages,
        ...(tools.length
          ? {
              tools: openAIToolDefinitions(tools),
              tool_choice: "auto",
            }
          : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string | null;
          tool_calls?: {
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };
    const choice = json.choices?.[0];
    const toolCallPlaceholders =
      choice?.message?.tool_calls
        ?.filter((call) => call.type === "function" && call.function?.name)
        .map((call) => ({
          id: call.id,
          name: call.function?.name ?? "unknown_tool",
          arguments: parseToolArguments(call.function?.arguments),
          rawArguments: call.function?.arguments,
        })) ?? [];

    return {
      text: choice?.message?.content?.trim() || "",
      toolCallPlaceholders,
      finishReason: choice?.finish_reason,
    };
  },
};

export function getAIProvider(aiConfig?: Pick<AIConfiguration, "provider">) {
  return (aiConfig?.provider ?? process.env.AI_PROVIDER) === "openai" ? openAIProvider : mockProvider;
}
