import type { AIProviderName } from "./types";

export type AIProviderRegistryItem = {
  name: AIProviderName;
  label: string;
  description: string;
  capabilities: Array<"chat" | "translation">;
  chatModels: string[];
  translationModels: string[];
  defaultBaseUrl?: string;
  defaultApiKeyEnv?: string;
  supportsCustomBaseUrl: boolean;
  supportsCustomModels: boolean;
  defaults: {
    chatModel: string;
    translationModel: string;
  };
};

export const aiProviderRegistry: AIProviderRegistryItem[] = [
  {
    name: "mock",
    label: "Mock",
    description: "Local deterministic provider for development and tests.",
    capabilities: ["chat", "translation"],
    chatModels: ["mock-support"],
    translationModels: ["mock-translate"],
    supportsCustomBaseUrl: false,
    supportsCustomModels: false,
    defaults: {
      chatModel: "mock-support",
      translationModel: "mock-translate",
    },
  },
  {
    name: "openai",
    label: "OpenAI",
    description: "OpenAI Chat Completions compatible provider.",
    capabilities: ["chat", "translation"],
    chatModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    translationModels: ["gpt-4o-mini", "gpt-4.1-mini"],
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    supportsCustomBaseUrl: false,
    supportsCustomModels: true,
    defaults: {
      chatModel: "gpt-4o-mini",
      translationModel: "gpt-4o-mini",
    },
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter OpenAI-compatible routing endpoint.",
    capabilities: ["chat", "translation"],
    chatModels: ["openai/gpt-4o-mini", "openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5"],
    translationModels: ["openai/gpt-4o-mini", "openai/gpt-4o", "google/gemini-flash-1.5"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultApiKeyEnv: "OPENROUTER_API_KEY",
    supportsCustomBaseUrl: false,
    supportsCustomModels: true,
    defaults: {
      chatModel: "openai/gpt-4o-mini",
      translationModel: "openai/gpt-4o-mini",
    },
  },
  {
    name: "custom",
    label: "Custom",
    description: "Any OpenAI-compatible Chat Completions endpoint.",
    capabilities: ["chat"],
    chatModels: [],
    translationModels: [],
    supportsCustomBaseUrl: true,
    supportsCustomModels: true,
    defaults: {
      chatModel: "custom-model",
      translationModel: "custom-model",
    },
  },
];

export function getProviderRegistryItem(name?: string) {
  return aiProviderRegistry.find((provider) => provider.name === name);
}
