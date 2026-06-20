import type { AIProviderName } from "./types";

export type AIProviderRegistryItem = {
  name: AIProviderName;
  label: string;
  capabilities: Array<"chat" | "translation">;
  chatModels: string[];
  translationModels: string[];
  defaults: {
    chatModel: string;
    translationModel: string;
  };
};

export const aiProviderRegistry: AIProviderRegistryItem[] = [
  {
    name: "mock",
    label: "Mock",
    capabilities: ["chat", "translation"],
    chatModels: ["mock-support"],
    translationModels: ["mock-translate"],
    defaults: {
      chatModel: "mock-support",
      translationModel: "mock-translate",
    },
  },
  {
    name: "openai",
    label: "OpenAI",
    capabilities: ["chat", "translation"],
    chatModels: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    translationModels: ["gpt-4o-mini", "gpt-4.1-mini"],
    defaults: {
      chatModel: "gpt-4o-mini",
      translationModel: "gpt-4o-mini",
    },
  },
];

export function getProviderRegistryItem(name?: string) {
  return aiProviderRegistry.find((provider) => provider.name === name);
}
