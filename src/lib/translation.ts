import type { AIConfiguration, ConversationWithMessages, Message, MessageRole } from "./types";

type TranslationProvider = AIConfiguration["translationProvider"];

export type TranslationResult = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: TranslationProvider;
  model: string;
};

export function detectLanguage(text: string) {
  return /[\u3400-\u9fff]/.test(text) ? "zh-CN" : "en-US";
}

function normalizeLanguage(language?: string) {
  if (!language) return undefined;
  if (language.toLowerCase().startsWith("zh")) return "zh-CN";
  if (language.toLowerCase().startsWith("en")) return "en-US";
  return language;
}

function conversationTranslationMetadata(conversation: ConversationWithMessages) {
  const value = conversation.metadata.translation;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function conversationTranslationEnabled(conversation: ConversationWithMessages, aiConfig: AIConfiguration) {
  const override = conversationTranslationMetadata(conversation).enabled;
  return typeof override === "boolean" ? override : aiConfig.translationEnabled;
}

export function visitorLanguage(conversation: ConversationWithMessages) {
  const metadataLanguage = conversationTranslationMetadata(conversation).visitorLanguage;
  if (typeof metadataLanguage === "string") return normalizeLanguage(metadataLanguage);

  const visitorMessage = [...conversation.messages].reverse().find((message) => message.role === "visitor");
  const messageLanguage = visitorMessage?.metadata.language;
  if (typeof messageLanguage === "string") return normalizeLanguage(messageLanguage);
  return visitorMessage ? detectLanguage(visitorMessage.content) : undefined;
}

export function displayContentForRole(message: Pick<Message, "role" | "content" | "metadata">, target: "agent" | "visitor") {
  const translation = message.metadata.translation;
  const record = translation && typeof translation === "object" && !Array.isArray(translation)
    ? (translation as Record<string, unknown>)
    : {};
  if (target === "agent" && message.role === "visitor" && typeof record.agentText === "string") return record.agentText;
  if (target === "visitor" && message.role !== "visitor" && typeof record.visitorText === "string") {
    return record.visitorText;
  }
  return message.content;
}

export async function translateText(input: {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  provider: TranslationProvider;
  model: string;
}): Promise<TranslationResult> {
  const sourceLanguage = normalizeLanguage(input.sourceLanguage) ?? detectLanguage(input.text);
  const targetLanguage = normalizeLanguage(input.targetLanguage) ?? input.targetLanguage;
  if (!input.text.trim() || sourceLanguage === targetLanguage) {
    return { text: input.text, sourceLanguage, targetLanguage, provider: input.provider, model: input.model };
  }

  if (input.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Translate the user text only. Do not explain, summarize, add quotes, or change formatting beyond the translation.",
          },
          {
            role: "user",
            content: `Source language: ${sourceLanguage}\nTarget language: ${targetLanguage}\nText:\n${input.text}`,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI translation failed with ${response.status}`);
    const json = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
    const translated = json.choices?.[0]?.message?.content?.trim();
    return {
      text: translated || input.text,
      sourceLanguage,
      targetLanguage,
      provider: input.provider,
      model: input.model,
    };
  }

  return {
    text: `[${targetLanguage}] ${input.text}`,
    sourceLanguage,
    targetLanguage,
    provider: "mock",
    model: input.model,
  };
}

function baseTranslationMetadata(result: TranslationResult) {
  return {
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    provider: result.provider,
    model: result.model,
  };
}

export async function visitorMessageMetadata(input: {
  conversation: ConversationWithMessages;
  aiConfig: AIConfiguration;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  if (!conversationTranslationEnabled(input.conversation, input.aiConfig)) return input.metadata ?? {};
  const sourceLanguage = detectLanguage(input.content);
  try {
    const result = await translateText({
      text: input.content,
      sourceLanguage,
      targetLanguage: input.aiConfig.agentLanguage,
      provider: input.aiConfig.translationProvider,
      model: input.aiConfig.translationModel,
    });
    return {
      ...(input.metadata ?? {}),
      language: sourceLanguage,
      translation: {
        ...baseTranslationMetadata(result),
        agentText: result.text,
      },
    };
  } catch (error) {
    return {
      ...(input.metadata ?? {}),
      language: sourceLanguage,
      translation: {
        sourceLanguage,
        targetLanguage: input.aiConfig.agentLanguage,
        provider: input.aiConfig.translationProvider,
        model: input.aiConfig.translationModel,
        error: error instanceof Error ? error.message : "translation failed",
      },
    };
  }
}

export async function outgoingMessageMetadata(input: {
  conversation: ConversationWithMessages;
  aiConfig: AIConfiguration;
  content: string;
  role: Extract<MessageRole, "ai" | "human_agent">;
  metadata?: Record<string, unknown>;
}) {
  if (!conversationTranslationEnabled(input.conversation, input.aiConfig)) return input.metadata ?? {};
  const targetLanguage = visitorLanguage(input.conversation);
  if (!targetLanguage) return input.metadata ?? {};
  try {
    const result = await translateText({
      text: input.content,
      sourceLanguage: input.aiConfig.agentLanguage,
      targetLanguage,
      provider: input.aiConfig.translationProvider,
      model: input.aiConfig.translationModel,
    });
    return {
      ...(input.metadata ?? {}),
      language: input.aiConfig.agentLanguage,
      translation: {
        ...baseTranslationMetadata(result),
        visitorText: result.text,
      },
    };
  } catch (error) {
    return {
      ...(input.metadata ?? {}),
      language: input.aiConfig.agentLanguage,
      translation: {
        sourceLanguage: input.aiConfig.agentLanguage,
        targetLanguage,
        provider: input.aiConfig.translationProvider,
        model: input.aiConfig.translationModel,
        error: error instanceof Error ? error.message : "translation failed",
      },
    };
  }
}

export function translatedPromptContent(message: Message) {
  return displayContentForRole(message, "agent");
}
