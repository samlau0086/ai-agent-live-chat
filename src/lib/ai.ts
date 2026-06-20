import type { AgentTool } from "./tools";
import { getProviderRegistryItem } from "./ai-providers";
import type { AIConfiguration, AIProviderChainItem, ConversationWithMessages } from "./types";

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
    providerConfig: AIProviderChainItem;
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
      text: `Local mock AI responder received "${content}".${source} Configure the OpenAI provider to use real AI replies.`,
      toolCallPlaceholders: [],
      finishReason: "stop",
    };
  },
};

function providerBaseUrl(providerConfig: AIProviderChainItem) {
  const registryItem = getProviderRegistryItem(providerConfig.provider);
  return (providerConfig.baseUrl ?? registryItem?.defaultBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
}

function providerApiKeyEnv(providerConfig: AIProviderChainItem) {
  const registryItem = getProviderRegistryItem(providerConfig.provider);
  return providerConfig.apiKeyEnv ?? registryItem?.defaultApiKeyEnv;
}

const openAICompatibleProvider: AIProvider = {
  name: "openai-compatible",
  async generateReply({ prompt, tools, aiConfig, providerConfig }) {
    const apiKeyEnv = providerApiKeyEnv(providerConfig);
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
    if (!apiKey) {
      throw new Error(`${apiKeyEnv ?? "API key env"} is not configured`);
    }

    const response = await fetch(`${providerBaseUrl(providerConfig)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: providerConfig.model,
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
      throw new Error(`${providerConfig.provider} request failed with ${response.status}`);
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

export function getAIProvider(providerName?: string) {
  return providerName === "mock" ? mockProvider : openAICompatibleProvider;
}

export function resolveProviderChain(aiConfig: AIConfiguration, conversationId?: string) {
  const chain = (aiConfig.providerChain?.length
    ? aiConfig.providerChain
    : [
        {
          id: "primary",
          provider: aiConfig.provider,
          model: aiConfig.model,
          enabled: true,
          priority: 1,
        },
      ])
    .filter((provider) => provider.enabled)
    .sort((left, right) => left.priority - right.priority);

  if (aiConfig.providerFallbackStrategy !== "round_robin" || chain.length <= 1) return chain;

  const source = conversationId ?? new Date().toISOString().slice(0, 16);
  const offset =
    [...source].reduce((total, character) => total + character.charCodeAt(0), 0) % chain.length;
  return [...chain.slice(offset), ...chain.slice(0, offset)];
}
