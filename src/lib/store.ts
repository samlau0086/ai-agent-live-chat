import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  AIConfiguration as PrismaAIConfiguration,
  AITrace as PrismaAITrace,
  ApiToken as PrismaApiToken,
  AgentStatus as PrismaAgentStatus,
  AuditLog as PrismaAuditLog,
  Conversation as PrismaConversation,
  KnowledgeBase as PrismaKnowledgeBase,
  KnowledgeChunk as PrismaKnowledgeChunk,
  KnowledgeDocument as PrismaKnowledgeDocument,
  KnowledgeEmbedding as PrismaKnowledgeEmbedding,
  KnowledgeSource as PrismaKnowledgeSource,
  Message as PrismaMessage,
  SecuritySettings as PrismaSecuritySettings,
  ToolDefinition as PrismaToolDefinition,
  User as PrismaUser,
  UserInvitation as PrismaUserInvitation,
  WidgetConfiguration as PrismaWidgetConfiguration,
  WebhookDelivery as PrismaWebhookDelivery,
  WebhookEndpoint as PrismaWebhookEndpoint,
} from "@prisma/client";
import { hashPassword, hmac, nowIso, randomId, randomToken } from "./crypto";
import { getProviderRegistryItem } from "./ai-providers";
import type {
  AIConfiguration,
  AIProviderChainItem,
  AnalyticsFilters,
  AnalyticsMetrics,
  AITrace,
  ApiToken,
  AgentStatus,
  AuditLog,
  Conversation,
  ConversationStatus,
  ConversationTag,
  ConversationWithMessages,
  CustomerProfile,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeEmbedding,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeSource,
  Message,
  MessageRole,
  SecuritySettings,
  StoreData,
  SystemHealth,
  ToolDefinition,
  ToolPermissionScope,
  User,
  UserInvitation,
  WidgetConfiguration,
  WebhookDelivery,
  WebhookEndpoint,
} from "./types";

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "store.json");

const defaultAdminUsername = process.env.ADMIN_USERNAME ?? "admin";
const defaultAdminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
const defaultSessionSecret = "dev-session-secret-change-me";
const defaultWebhookSecret = "dev-webhook-secret-change-me";
const apiTokenPrefix = "lc";
const localEmbeddingProvider = "local_hash";
const localEmbeddingModel = "hashing-v1";
const localEmbeddingDimensions = 64;

function legacyProviderChain(provider: string, model: string): AIProviderChainItem[] {
  const registryItem = getProviderRegistryItem(provider);
  const item: AIProviderChainItem = {
    id: "primary",
    provider,
    label: registryItem?.label ?? provider,
    model,
    models: [model],
    enabled: true,
    priority: 1,
    timeoutMs: 30000,
  };
  if (registryItem?.defaultBaseUrl) item.baseUrl = registryItem.defaultBaseUrl;
  if (registryItem?.defaultApiKeyEnv) item.apiKeyEnv = registryItem.defaultApiKeyEnv;
  return [item];
}

function normalizeModelList(model: string, value: unknown) {
  const models = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return [...new Set([model, ...models])];
}

function normalizeProviderChain(
  value: unknown,
  provider: string,
  model: string,
): AIProviderChainItem[] {
  const input = Array.isArray(value) ? value : [];
  const normalized = input
    .map((item, index) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as Record<string, unknown>;
      const itemProvider = String(record.provider ?? "").trim();
      const itemModel = String(record.model ?? "").trim();
      if (!itemProvider || !itemModel) return undefined;
      const registryItem = getProviderRegistryItem(itemProvider);
      const itemLabel = String(record.label ?? "").trim() || registryItem?.label || itemProvider;
      const normalizedItem: AIProviderChainItem = {
        id: String(record.id ?? `provider_${index + 1}`),
        provider: itemProvider,
        label: itemLabel,
        model: itemModel,
        models: normalizeModelList(itemModel, record.models),
        enabled: record.enabled === undefined ? true : Boolean(record.enabled),
        priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : index + 1,
        timeoutMs: Number.isFinite(Number(record.timeoutMs)) ? Number(record.timeoutMs) : 30000,
      };
      const baseUrl = String(record.baseUrl ?? registryItem?.defaultBaseUrl ?? "").trim();
      const apiKeyEnv = String(record.apiKeyEnv ?? registryItem?.defaultApiKeyEnv ?? "").trim();
      if (baseUrl) normalizedItem.baseUrl = baseUrl;
      if (apiKeyEnv) normalizedItem.apiKeyEnv = apiKeyEnv;
      return normalizedItem;
    })
    .filter((item): item is AIProviderChainItem => Boolean(item));
  return normalized.length ? normalized : legacyProviderChain(provider, model);
}

function defaultAIConfiguration(createdAt = nowIso()): AIConfiguration {
  const provider = (process.env.AI_PROVIDER as AIConfiguration["provider"]) ?? "mock";
  const model = process.env.OPENAI_MODEL ?? (provider === "mock" ? "mock-support" : "gpt-4o-mini");
  return {
    id: "global",
    provider,
    model,
    providerChain: legacyProviderChain(provider, model),
    providerFallbackStrategy: "priority",
    temperature: 0.2,
    maxContextMessages: 12,
    systemPrompt:
      "You are a concise customer support AI. Use available knowledge when relevant. Escalate politely when a human should help. Do not invent account data.",
    fallbackMessage: "I am not certain enough to answer that. A human agent can help from the console.",
    noAnswerStrategy: "continue",
    enableKnowledgeBase: true,
    enableTools: true,
    knowledgeBaseIds: [],
    translationEnabled: false,
    translationProvider: "mock",
    translationModel: "mock-translate",
    agentLanguage: "zh-CN",
    autoHandoff: {
      enabled: true,
      userRequestPatterns: ["human", "agent", "representative", "manual support", "customer service"],
      sensitiveKeywords: ["refund", "legal", "complaint", "lawsuit", "lawyer", "chargeback"],
      vipMetadataKeys: ["vip", "plan:enterprise", "priority"],
      aiFailureThreshold: 2,
      lowConfidenceKnowledgeScoreThreshold: 0,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function apiTokenHash(token: string) {
  return hmac(token, process.env.API_TOKEN_HASH_SECRET ?? sessionSecretForStore());
}

function sessionSecretForStore() {
  return process.env.SESSION_SECRET ?? defaultSessionSecret;
}

function createApiTokenSecret() {
  return `${apiTokenPrefix}_${randomToken(32)}`;
}

function apiTokenPrefixValue(token: string) {
  return token.slice(0, 12);
}

function tokenExpired(token: Pick<ApiToken, "expiresAt">) {
  return Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
}

function defaultSecuritySettings(updatedAt = nowIso()): SecuritySettings {
  return {
    id: "global",
    failedLoginLockoutThreshold: 5,
    lockoutMinutes: 15,
    passwordRotationDays: 90,
    updatedAt,
  };
}

function defaultWidgetConfiguration(createdAt = nowIso()): WidgetConfiguration {
  return {
    id: "global",
    themeColor: "#1f2a44",
    welcomeMessage:
      "Start a conversation. The AI agent will answer first, and a human can take over when needed.",
    offlineMessage: "No human agents are online right now. Leave a message and the AI agent will keep helping.",
    enableSatisfaction: true,
    enableTranscriptDownload: true,
    requireEndConfirmation: true,
    createdAt,
    updatedAt: createdAt,
  };
}

function defaultToolDefinitions(createdAt = nowIso()): ToolDefinition[] {
  return [
    {
      id: "tool_lookup_customer_profile",
      name: "lookup_customer_profile",
      description: "Returns known metadata for the current visitor session.",
      inputSchema: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "Current conversation id" },
        },
        additionalProperties: true,
      },
      authConfig: {},
      timeoutMs: 5000,
      enabled: true,
      permissionScope: "ai",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_create_support_note",
      name: "create_support_note",
      description: "Records a support note in the conversation timeline.",
      inputSchema: {
        type: "object",
        properties: {
          note: { type: "string", description: "Internal support note" },
        },
        required: ["note"],
        additionalProperties: true,
      },
      authConfig: {},
      timeoutMs: 5000,
      enabled: true,
      permissionScope: "agent",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_crm_lookup",
      name: "crm_lookup",
      description: "Template for looking up customer records in an external CRM.",
      inputSchema: {
        type: "object",
        properties: {
          externalUserId: { type: "string", description: "External customer id" },
          email: { type: "string", description: "Customer email address" },
        },
        additionalProperties: true,
      },
      authConfig: { type: "api_key", header: "Authorization", secretRef: "CRM_API_KEY" },
      timeoutMs: 5000,
      enabled: false,
      permissionScope: "disabled",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_order_lookup",
      name: "order_lookup",
      description: "Template for retrieving order details from an external commerce system.",
      inputSchema: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "Order id or order number" },
          externalUserId: { type: "string", description: "External customer id" },
        },
        required: ["orderId"],
        additionalProperties: true,
      },
      authConfig: { type: "api_key", header: "Authorization", secretRef: "ORDER_API_KEY" },
      timeoutMs: 5000,
      enabled: false,
      permissionScope: "disabled",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_ticket_create",
      name: "ticket_create",
      description: "Template for creating a support ticket in an external helpdesk.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Ticket subject" },
          description: { type: "string", description: "Ticket details" },
          priority: { type: "string", description: "Ticket priority" },
        },
        required: ["subject", "description"],
        additionalProperties: true,
      },
      authConfig: { type: "api_key", header: "Authorization", secretRef: "TICKET_API_KEY" },
      timeoutMs: 8000,
      enabled: false,
      permissionScope: "disabled",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_refund_status",
      name: "refund_status",
      description: "Template for checking refund or return status in an external order system.",
      inputSchema: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "Order id" },
          refundId: { type: "string", description: "Refund id" },
        },
        additionalProperties: true,
      },
      authConfig: { type: "api_key", header: "Authorization", secretRef: "REFUND_API_KEY" },
      timeoutMs: 5000,
      enabled: false,
      permissionScope: "disabled",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_subscription_status",
      name: "subscription_status",
      description: "Template for retrieving customer subscription or plan status.",
      inputSchema: {
        type: "object",
        properties: {
          externalUserId: { type: "string", description: "External customer id" },
          subscriptionId: { type: "string", description: "Subscription id" },
        },
        additionalProperties: true,
      },
      authConfig: { type: "api_key", header: "Authorization", secretRef: "SUBSCRIPTION_API_KEY" },
      timeoutMs: 5000,
      enabled: false,
      permissionScope: "disabled",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "tool_user_profile_sync",
      name: "user_profile_sync",
      description: "Template for syncing external user profile data into conversation metadata.",
      inputSchema: {
        type: "object",
        properties: {
          externalUserId: { type: "string", description: "External customer id" },
          profile: { type: "object", description: "Profile fields to sync" },
        },
        required: ["externalUserId", "profile"],
        additionalProperties: true,
      },
      authConfig: { type: "api_key", header: "Authorization", secretRef: "PROFILE_SYNC_API_KEY" },
      timeoutMs: 8000,
      enabled: false,
      permissionScope: "disabled",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function securityHealth(settings: SecuritySettings) {
  return {
    failedLoginLockoutThreshold: settings.failedLoginLockoutThreshold,
    lockoutMinutes: settings.lockoutMinutes,
    passwordRotationDays: settings.passwordRotationDays,
  };
}

function getSecretHealth(): SystemHealth["secrets"] {
  const insecureDefaults: string[] = [];
  const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET) && process.env.SESSION_SECRET !== defaultSessionSecret;
  const webhookSigningSecretConfigured =
    Boolean(process.env.WEBHOOK_SIGNING_SECRET) && process.env.WEBHOOK_SIGNING_SECRET !== defaultWebhookSecret;

  if (!sessionSecretConfigured) insecureDefaults.push("SESSION_SECRET");
  if (!webhookSigningSecretConfigured) insecureDefaults.push("WEBHOOK_SIGNING_SECRET");

  return {
    sessionSecretConfigured,
    webhookSigningSecretConfigured,
    insecureDefaults,
  };
}

function auditSummary(value: unknown) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return { type: "string", length: value.length, preview: value.slice(0, 120) };
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") return { type: "object", keys: Object.keys(value).slice(0, 20) };
  return { type: typeof value };
}

function jsonChanged(before: unknown, after: unknown) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function aiConfigAuditDiff(before: AIConfiguration, after: AIConfiguration) {
  const fields: Array<keyof AIConfiguration> = [
    "provider",
    "model",
    "providerChain",
    "providerFallbackStrategy",
    "temperature",
    "maxContextMessages",
    "systemPrompt",
    "fallbackMessage",
    "noAnswerStrategy",
    "enableKnowledgeBase",
    "enableTools",
    "knowledgeBaseIds",
    "translationEnabled",
    "translationProvider",
    "translationModel",
    "agentLanguage",
    "autoHandoff",
  ];
  const changes = fields
    .filter((field) => jsonChanged(before[field], after[field]))
    .map((field) => ({
      field,
      before: auditSummary(before[field]),
      after: auditSummary(after[field]),
    }));
  return {
    changedFields: changes.map((change) => change.field),
    changes,
  };
}

function normalizeAIConfiguration(config: AIConfiguration | undefined, now = nowIso()): AIConfiguration {
  const defaults = defaultAIConfiguration(now);
  if (!config) return defaults;
  return {
    ...defaults,
    ...config,
    providerChain: normalizeProviderChain(config.providerChain, config.provider ?? defaults.provider, config.model ?? defaults.model),
    providerFallbackStrategy: config.providerFallbackStrategy === "round_robin" ? "round_robin" : "priority",
    noAnswerStrategy: config.noAnswerStrategy ?? defaults.noAnswerStrategy,
    autoHandoff: { ...defaults.autoHandoff, ...(config.autoHandoff ?? {}) },
  };
}

function normalizeStore(data: Partial<StoreData>): StoreData {
  const now = nowIso();
  return {
    users: (data.users ?? []).map((user) => ({
      ...user,
      disabled: user.disabled ?? false,
      failedLoginCount: user.failedLoginCount ?? 0,
      lockedUntil: user.lockedUntil,
      passwordChangedAt: user.passwordChangedAt,
      forcePasswordChange: user.forcePasswordChange ?? false,
      locale: user.locale === "zh" ? "zh" : "en",
    })),
    userInvitations: data.userInvitations ?? [],
    conversations: data.conversations ?? [],
    messages: data.messages ?? [],
    webhookEndpoints: (data.webhookEndpoints ?? []).map((endpoint) => ({
      ...endpoint,
      retryMaxAttempts: endpoint.retryMaxAttempts ?? 3,
      retryBackoffSeconds: endpoint.retryBackoffSeconds ?? 30,
    })),
    webhookDeliveries: data.webhookDeliveries ?? [],
    apiTokens: (data.apiTokens ?? []).map((token) => ({
      ...token,
      scopes: token.scopes ?? [],
      disabled: token.disabled ?? false,
    })),
    toolDefinitions: data.toolDefinitions?.length ? data.toolDefinitions : defaultToolDefinitions(now),
    toolInvocationLogs: data.toolInvocationLogs ?? [],
    aiTraces: (data.aiTraces ?? []).map((trace) => ({ ...trace, toolCallPlaceholders: trace.toolCallPlaceholders ?? [] })),
    aiConfiguration: normalizeAIConfiguration(data.aiConfiguration, now),
    securitySettings: data.securitySettings ?? defaultSecuritySettings(now),
    widgetConfiguration: data.widgetConfiguration ?? defaultWidgetConfiguration(now),
    knowledgeBases: data.knowledgeBases ?? [],
    knowledgeSources: data.knowledgeSources ?? [],
    knowledgeDocuments: (data.knowledgeDocuments ?? []).map((document) => ({
      ...document,
      indexingStatus: document.indexingStatus ?? "indexed",
      indexedAt: document.indexedAt ?? document.updatedAt,
      contentHash: document.contentHash ?? contentHash(document.content),
    })),
    knowledgeChunks: (data.knowledgeChunks ?? []).map((chunk) => ({
      ...chunk,
      tokenCount: chunk.tokenCount ?? chunk.tokens.length,
    })),
    knowledgeEmbeddings: data.knowledgeEmbeddings ?? [],
    auditLogs: data.auditLogs ?? [],
    agentStatuses: data.agentStatuses ?? [],
  };
}

async function readStore(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return normalizeStore(JSON.parse(raw) as Partial<StoreData>);
  } catch {
    const createdAt = nowIso();
    const initial = normalizeStore({
      users: [
        {
          id: randomId("usr"),
          username: defaultAdminUsername,
          passwordHash: hashPassword(defaultAdminPassword),
          role: "admin",
          disabled: false,
          failedLoginCount: 0,
          passwordChangedAt: createdAt,
          forcePasswordChange: defaultAdminPassword === "admin123",
          locale: "en",
          createdAt,
        },
      ],
      conversations: [],
      messages: [],
      webhookEndpoints: [],
      webhookDeliveries: [],
      toolInvocationLogs: [],
    });
    await writeStore(initial);
    return initial;
  }
}

async function writeStore(data: StoreData) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

async function mutate<T>(fn: (data: StoreData) => T | Promise<T>) {
  const data = await readStore();
  const result = await fn(data);
  await writeStore(data);
  return result;
}

function withMessages(conversation: Conversation, data: StoreData): ConversationWithMessages {
  return {
    ...conversation,
    messages: data.messages
      .filter((message) => message.conversationId === conversation.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    takenOverBy: conversation.takenOverById
      ? data.users.find((user) => user.id === conversation.takenOverById)
      : undefined,
    tags: conversationTags(conversation.metadata),
    customerProfile: customerProfile(conversation.metadata),
    quickReplies: quickReplies(conversation.metadata),
  };
}

function conversationTags(metadata: Record<string, unknown>): ConversationTag[] {
  return Array.isArray(metadata.tags)
    ? metadata.tags
        .map((tag) => (tag && typeof tag === "object" ? (tag as ConversationTag) : undefined))
        .filter((tag): tag is ConversationTag => Boolean(tag?.name))
    : [];
}

function customerProfile(metadata: Record<string, unknown>): CustomerProfile {
  return metadata.customerProfile && typeof metadata.customerProfile === "object"
    ? (metadata.customerProfile as CustomerProfile)
    : {};
}

function quickReplies(metadata: Record<string, unknown>): string[] {
  return Array.isArray(metadata.quickReplies)
    ? metadata.quickReplies.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

export function sanitizeConversationForVisitor(conversation: ConversationWithMessages): ConversationWithMessages {
  return {
    ...conversation,
    messages: conversation.messages.filter((message) => !message.metadata?.internalNote),
  };
}

function numberOrUndefined(value: number) {
  return Number.isFinite(value) ? value : undefined;
}

function secondsBetween(start?: string, end?: string) {
  if (!start || !end) return undefined;
  const delta = (Date.parse(end) - Date.parse(start)) / 1000;
  return delta >= 0 ? delta : undefined;
}

function conversationChannel(conversation: ConversationWithMessages) {
  const metadataChannel = conversation.metadata.channel;
  if (typeof metadataChannel === "string" && metadataChannel.trim()) return metadataChannel;
  const [prefix] = conversation.visitorSessionId.split(":");
  return prefix && prefix !== conversation.visitorSessionId ? prefix : "web";
}

function messageKnowledgeSources(message: Message) {
  const sources = (message.metadata as { knowledgeSources?: unknown[] }).knowledgeSources;
  return Array.isArray(sources) ? sources : [];
}

function conversationMatchesKnowledgeBase(conversation: ConversationWithMessages, knowledgeBaseId?: string) {
  if (!knowledgeBaseId) return true;
  return conversation.messages.some((message) =>
    messageKnowledgeSources(message).some((source) => {
      if (!source || typeof source !== "object") return false;
      return (source as { knowledgeBaseId?: string }).knowledgeBaseId === knowledgeBaseId;
    }),
  );
}

function conversationMatchesAnalyticsFilters(conversation: ConversationWithMessages, filters: AnalyticsFilters) {
  const createdAt = Date.parse(conversation.createdAt);
  if (filters.dateFrom && createdAt < Date.parse(filters.dateFrom)) return false;
  if (filters.dateTo && createdAt > Date.parse(filters.dateTo)) return false;
  if (filters.status && conversation.status !== filters.status) return false;
  if (filters.agentId) {
    const handledByAgent =
      conversation.takenOverById === filters.agentId ||
      conversation.messages.some((message) => message.agentId === filters.agentId);
    if (!handledByAgent) return false;
  }
  if (filters.channel && conversationChannel(conversation) !== filters.channel) return false;
  if (filters.tag && !conversation.tags?.some((tag) => tag.name === filters.tag)) return false;
  if (!conversationMatchesKnowledgeBase(conversation, filters.knowledgeBaseId)) return false;
  return true;
}

function firstResponseSeconds(conversation: ConversationWithMessages) {
  const firstVisitor = conversation.messages.find((message) => message.role === "visitor");
  if (!firstVisitor) return undefined;
  const response = conversation.messages.find(
    (message) =>
      (message.role === "ai" || message.role === "human_agent") &&
      Date.parse(message.createdAt) >= Date.parse(firstVisitor.createdAt),
  );
  return secondsBetween(firstVisitor.createdAt, response?.createdAt);
}

function resolutionSeconds(conversation: ConversationWithMessages) {
  if (conversation.status !== "resolved" && conversation.status !== "closed") return undefined;
  const firstVisitor = conversation.messages.find((message) => message.role === "visitor");
  return secondsBetween(firstVisitor?.createdAt ?? conversation.createdAt, conversation.closedAt ?? conversation.updatedAt);
}

function average(values: Array<number | undefined>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : undefined;
}

function satisfactionRating(conversation: ConversationWithMessages) {
  const satisfaction = conversation.metadata.satisfaction;
  if (!satisfaction || typeof satisfaction !== "object") return undefined;
  const rating = Number((satisfaction as { rating?: unknown }).rating);
  return Number.isFinite(rating) ? rating : undefined;
}

function computeAnalyticsMetrics(
  conversations: ConversationWithMessages[],
  filters: AnalyticsFilters = {},
): AnalyticsMetrics {
  const filtered = conversations.filter((conversation) => conversationMatchesAnalyticsFilters(conversation, filters));
  const messages = filtered.flatMap((conversation) => conversation.messages);
  const totalConversations = filtered.length;
  const aiMessages = messages.filter((message) => message.role === "ai").length;
  const humanMessages = messages.filter((message) => message.role === "human_agent").length;
  const visitorMessages = messages.filter((message) => message.role === "visitor").length;
  const humanHandled = filtered.filter(
    (conversation) =>
      Boolean(conversation.takenOverById) || conversation.messages.some((message) => message.role === "human_agent"),
  ).length;
  const resolvedConversations = filtered.filter((conversation) => conversation.status === "resolved").length;
  const closedConversations = filtered.filter((conversation) => conversation.status === "closed").length;
  const aiResolved = filtered.filter(
    (conversation) =>
      conversation.status === "resolved" &&
      conversation.messages.some((message) => message.role === "ai") &&
      !conversation.messages.some((message) => message.role === "human_agent") &&
      !conversation.takenOverById,
  ).length;
  const knowledgeHits = messages.filter((message) => message.role === "ai" && messageKnowledgeSources(message).length > 0).length;
  const satisfactionScores = filtered.map(satisfactionRating).filter((rating): rating is number => rating !== undefined);
  const byStatus = filtered.reduce(
    (counts, conversation) => {
      counts[conversation.status] += 1;
      return counts;
    },
    {
      ai_active: 0,
      queued_for_human: 0,
      human_active: 0,
      resolved: 0,
      closed: 0,
    } satisfies Record<ConversationStatus, number>,
  );
  const byChannel = filtered.reduce<Record<string, number>>((counts, conversation) => {
    const channel = conversationChannel(conversation);
    counts[channel] = (counts[channel] ?? 0) + 1;
    return counts;
  }, {});

  return {
    filters,
    totalConversations,
    openConversations: filtered.filter((conversation) => !["resolved", "closed"].includes(conversation.status)).length,
    resolvedConversations,
    closedConversations,
    aiMessages,
    humanMessages,
    visitorMessages,
    humanHandoffRate: totalConversations ? humanHandled / totalConversations : 0,
    aiResolutionRate: resolvedConversations ? aiResolved / resolvedConversations : 0,
    knowledgeHitRate: aiMessages ? knowledgeHits / aiMessages : 0,
    averageFirstResponseSeconds: numberOrUndefined(average(filtered.map(firstResponseSeconds)) ?? Number.NaN),
    averageResolutionSeconds: numberOrUndefined(average(filtered.map(resolutionSeconds)) ?? Number.NaN),
    averageSatisfactionScore: numberOrUndefined(average(satisfactionScores) ?? Number.NaN),
    satisfactionResponses: satisfactionScores.length,
    byStatus,
    byChannel,
  };
}

function tokenize(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function cleanKnowledgeText(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkDocument(content: string) {
  const cleaned = cleanKnowledgeText(content);
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [cleaned]) {
    if ((current + "\n\n" + paragraph).length > 900 && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function localEmbedding(input: string) {
  const vector = Array.from({ length: localEmbeddingDimensions }, () => 0);
  const tokens = tokenize(input);
  for (const token of tokens) {
    const digest = crypto.createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % localEmbeddingDimensions;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function vectorLiteral(vector: number[]) {
  return `[${vector.map((value) => Number(value.toFixed(6))).join(",")}]`;
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function keywordScore(queryTokens: string[], chunkTokens: string[]) {
  const uniqueChunkTokens = new Set(chunkTokens);
  const overlap = [...new Set(queryTokens)].filter((token) => uniqueChunkTokens.has(token)).length;
  return overlap / Math.max(new Set(queryTokens).size, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeSearchOptions(input: KnowledgeSearchOptions) {
  const keywordWeight = clamp(Number(input.keywordWeight ?? 0.65), 0, 1);
  const vectorWeight = clamp(Number(input.vectorWeight ?? 0.35), 0, 1);
  const total = keywordWeight + vectorWeight || 1;
  return {
    ...input,
    topK: Math.max(1, Math.min(Number(input.topK ?? 5), 25)),
    keywordWeight: keywordWeight / total,
    vectorWeight: vectorWeight / total,
    minScore: clamp(Number(input.minScore ?? 0.05), 0, 1),
    candidateMultiplier: Math.max(5, Math.min(Number(input.candidateMultiplier ?? 20), 100)),
    sourceTypes: input.sourceTypes?.length ? input.sourceTypes : undefined,
  };
}

function rewriteKnowledgeQuery(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(how|what|when|where|why|can|could|would|should|please|tell|me|about|the|a|an|is|are|do|does|i|we|you)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || query.trim();
}

function sourceTypeMatches(sourceType: KnowledgeSource["type"] | undefined, filters?: KnowledgeSource["type"][]) {
  return !filters?.length || Boolean(sourceType && filters.includes(sourceType));
}

function hybridScore(keyword: number, vector: number, options?: Pick<KnowledgeSearchOptions, "keywordWeight" | "vectorWeight">) {
  const keywordWeight = options?.keywordWeight ?? 0.65;
  const vectorWeight = options?.vectorWeight ?? 0.35;
  return keyword * keywordWeight + Math.max(0, vector) * vectorWeight;
}

function contentHash(content: string) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function indexedEmbedding(input: {
  knowledgeBaseId: string;
  sourceId?: string;
  documentId: string;
  chunkId: string;
  content: string;
  createdAt: string;
}): KnowledgeEmbedding {
  return {
    id: randomId("emb"),
    knowledgeBaseId: input.knowledgeBaseId,
    sourceId: input.sourceId,
    documentId: input.documentId,
    chunkId: input.chunkId,
    provider: localEmbeddingProvider,
    model: localEmbeddingModel,
    dimensions: localEmbeddingDimensions,
    embedding: localEmbedding(input.content),
    status: "indexed",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function buildKnowledgeIndex(input: {
  knowledgeBaseId: string;
  sourceId?: string;
  documentId: string;
  content: string;
  createdAt: string;
}) {
  const chunks = chunkDocument(input.content);
  if (!chunks.length || chunks.every((chunk) => tokenize(chunk).length === 0)) {
    throw new Error("Document produced no indexable text chunks.");
  }
  return chunks.map((content, index) => {
    const tokens = tokenize(content);
    const chunk = {
      id: randomId("chk"),
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: input.documentId,
      sourceId: input.sourceId,
      content,
      ordinal: index,
      tokens,
      tokenCount: tokens.length,
      createdAt: input.createdAt,
    };
    return {
      chunk,
      embedding: indexedEmbedding({
        knowledgeBaseId: input.knowledgeBaseId,
        sourceId: input.sourceId,
        documentId: input.documentId,
        chunkId: chunk.id,
        content,
        createdAt: input.createdAt,
      }),
    };
  });
}

const fileStore = {
  async findUserByUsername(username: string) {
    const data = await readStore();
    return data.users.find((user) => user.username === username);
  },

  async findUserById(id: string) {
    const data = await readStore();
    return data.users.find((user) => user.id === id);
  },

  async listUsers() {
    const data = await readStore();
    return [...data.users].sort((a, b) => a.username.localeCompare(b.username));
  },

  async listAgentStatuses() {
    const data = await readStore();
    return [...data.agentStatuses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async setAgentStatus(userId: string, status: AgentStatus["status"]) {
    return mutate((data) => {
      const user = data.users.find((item) => item.id === userId);
      if (!user) throw new Error("User not found");
      const updatedAt = nowIso();
      const existing = data.agentStatuses.find((item) => item.userId === userId);
      if (existing) {
        existing.status = status;
        existing.updatedAt = updatedAt;
        return existing;
      }
      const agentStatus: AgentStatus = { userId, status, updatedAt };
      data.agentStatuses.push(agentStatus);
      return agentStatus;
    });
  },

  async createUser(
    input: { username: string; password: string; role: User["role"]; disabled?: boolean; forcePasswordChange?: boolean },
    actorId?: string,
  ) {
    return mutate((data) => {
      if (data.users.some((user) => user.username === input.username)) throw new Error("Username already exists");
      const createdAt = nowIso();
      const user: User = {
        id: randomId("usr"),
        username: input.username,
        passwordHash: hashPassword(input.password),
        role: input.role,
        disabled: input.disabled ?? false,
        failedLoginCount: 0,
        lockedUntil: undefined,
        passwordChangedAt: createdAt,
        forcePasswordChange: input.forcePasswordChange ?? true,
        locale: "en",
        createdAt,
      };
      data.users.push(user);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "user.created",
        targetType: "User",
        targetId: user.id,
        metadata: { username: user.username, role: user.role },
        createdAt,
      });
      return user;
    });
  },

  async updateUser(
    id: string,
    input: Partial<{
      password: string;
      role: User["role"];
      disabled: boolean;
      forcePasswordChange: boolean;
      unlock: boolean;
      locale: User["locale"];
    }>,
    actorId?: string,
  ) {
    return mutate((data) => {
      const user = data.users.find((item) => item.id === id);
      if (!user) throw new Error("User not found");
      if (input.role) user.role = input.role;
      if (input.locale) user.locale = input.locale;
      if (typeof input.disabled === "boolean") user.disabled = input.disabled;
      if (typeof input.forcePasswordChange === "boolean") user.forcePasswordChange = input.forcePasswordChange;
      if (input.unlock) {
        user.failedLoginCount = 0;
        user.lockedUntil = undefined;
      }
      if (input.password) {
        user.passwordHash = hashPassword(input.password);
        user.passwordChangedAt = nowIso();
        user.forcePasswordChange = input.forcePasswordChange ?? true;
        user.failedLoginCount = 0;
        user.lockedUntil = undefined;
      }
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "user.updated",
        targetType: "User",
        targetId: user.id,
        metadata: {
          role: user.role,
          locale: user.locale,
          disabled: user.disabled,
          passwordChanged: Boolean(input.password),
          forcePasswordChange: user.forcePasswordChange,
          unlocked: Boolean(input.unlock),
        },
        createdAt: nowIso(),
      });
      return user;
    });
  },

  async listUserInvitations() {
    const data = await readStore();
    return [...data.userInvitations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createUserInvitation(
    input: { username: string; role: User["role"]; tokenHash: string; expiresAt: string },
    actorId?: string,
  ) {
    return mutate((data) => {
      if (data.users.some((user) => user.username === input.username)) throw new Error("Username already exists");
      const existingActive = data.userInvitations.find(
        (invite) =>
          invite.username === input.username &&
          !invite.acceptedAt &&
          !invite.revokedAt &&
          new Date(invite.expiresAt).getTime() > Date.now(),
      );
      if (existingActive) throw new Error("Active invitation already exists for this username");
      const createdAt = nowIso();
      const invitation: UserInvitation = {
        id: randomId("inv"),
        username: input.username,
        role: input.role,
        tokenHash: input.tokenHash,
        invitedById: actorId,
        expiresAt: input.expiresAt,
        createdAt,
      };
      data.userInvitations.push(invitation);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "user_invitation.created",
        targetType: "UserInvitation",
        targetId: invitation.id,
        metadata: { username: invitation.username, role: invitation.role, expiresAt: invitation.expiresAt },
        createdAt,
      });
      return invitation;
    });
  },

  async findUserInvitationByTokenHash(tokenHash: string) {
    const data = await readStore();
    return data.userInvitations.find((invitation) => invitation.tokenHash === tokenHash);
  },

  async revokeUserInvitation(id: string, actorId?: string) {
    return mutate((data) => {
      const invitation = data.userInvitations.find((item) => item.id === id);
      if (!invitation) throw new Error("Invitation not found");
      if (!invitation.revokedAt) invitation.revokedAt = nowIso();
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "user_invitation.revoked",
        targetType: "UserInvitation",
        targetId: invitation.id,
        metadata: { username: invitation.username, role: invitation.role },
        createdAt: nowIso(),
      });
      return invitation;
    });
  },

  async acceptUserInvitation(tokenHash: string, password: string) {
    return mutate((data) => {
      const invitation = data.userInvitations.find((item) => item.tokenHash === tokenHash);
      if (!invitation) throw new Error("Invitation not found");
      if (invitation.acceptedAt) throw new Error("Invitation already accepted");
      if (invitation.revokedAt) throw new Error("Invitation revoked");
      if (new Date(invitation.expiresAt).getTime() <= Date.now()) throw new Error("Invitation expired");
      if (data.users.some((user) => user.username === invitation.username)) throw new Error("Username already exists");
      const createdAt = nowIso();
      const user: User = {
        id: randomId("usr"),
        username: invitation.username,
        passwordHash: hashPassword(password),
        role: invitation.role,
        disabled: false,
        failedLoginCount: 0,
        lockedUntil: undefined,
        passwordChangedAt: createdAt,
        forcePasswordChange: false,
        locale: "en",
        createdAt,
      };
      data.users.push(user);
      invitation.acceptedAt = createdAt;
      invitation.acceptedUserId = user.id;
      data.auditLogs.push({
        id: randomId("aud"),
        action: "user_invitation.accepted",
        targetType: "UserInvitation",
        targetId: invitation.id,
        metadata: { username: user.username, role: user.role, acceptedUserId: user.id },
        createdAt,
      });
      return { invitation, user };
    });
  },

  async recordFailedLogin(userId: string) {
    return mutate((data) => {
      const user = data.users.find((item) => item.id === userId);
      if (!user) throw new Error("User not found");
      const settings = data.securitySettings ?? defaultSecuritySettings();
      const failedLoginCount = (user.failedLoginCount ?? 0) + 1;
      user.failedLoginCount = failedLoginCount;
      if (failedLoginCount >= settings.failedLoginLockoutThreshold) {
        user.lockedUntil = new Date(Date.now() + settings.lockoutMinutes * 60 * 1000).toISOString();
      }
      data.auditLogs.push({
        id: randomId("aud"),
        actorId: user.id,
        action: user.lockedUntil ? "auth.account_locked" : "auth.failed_login_counted",
        targetType: "User",
        targetId: user.id,
        metadata: {
          failedLoginCount,
          lockedUntil: user.lockedUntil,
          lockoutThreshold: settings.failedLoginLockoutThreshold,
          lockoutMinutes: settings.lockoutMinutes,
        },
        createdAt: nowIso(),
      });
      return user;
    });
  },

  async recordSuccessfulLogin(userId: string) {
    return mutate((data) => {
      const user = data.users.find((item) => item.id === userId);
      if (!user) throw new Error("User not found");
      user.failedLoginCount = 0;
      user.lockedUntil = undefined;
      return user;
    });
  },

  async getAIConfiguration() {
    const data = await readStore();
    return normalizeAIConfiguration(data.aiConfiguration);
  },

  async getSecuritySettings() {
    const data = await readStore();
    return data.securitySettings ?? defaultSecuritySettings();
  },

  async getWidgetConfiguration() {
    const data = await readStore();
    return data.widgetConfiguration ?? defaultWidgetConfiguration();
  },

  async updateWidgetConfiguration(input: Partial<Omit<WidgetConfiguration, "id" | "createdAt" | "updatedAt">>, actorId?: string) {
    return mutate((data) => {
      const current = data.widgetConfiguration ?? defaultWidgetConfiguration();
      const updated: WidgetConfiguration = {
        ...current,
        themeColor: String(input.themeColor ?? current.themeColor).trim() || current.themeColor,
        welcomeMessage: String(input.welcomeMessage ?? current.welcomeMessage).trim() || current.welcomeMessage,
        offlineMessage: String(input.offlineMessage ?? current.offlineMessage).trim() || current.offlineMessage,
        enableSatisfaction: input.enableSatisfaction ?? current.enableSatisfaction,
        enableTranscriptDownload: input.enableTranscriptDownload ?? current.enableTranscriptDownload,
        requireEndConfirmation: input.requireEndConfirmation ?? current.requireEndConfirmation,
        updatedAt: nowIso(),
      };
      data.widgetConfiguration = updated;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "widget_config.updated",
        targetType: "WidgetConfiguration",
        targetId: "global",
        metadata: { before: current, after: updated },
        createdAt: updated.updatedAt,
      });
      return updated;
    });
  },

  async updateSecuritySettings(input: Partial<Omit<SecuritySettings, "id" | "updatedAt">>, actorId?: string) {
    return mutate((data) => {
      const current = data.securitySettings ?? defaultSecuritySettings();
      const updated: SecuritySettings = {
        ...current,
        failedLoginLockoutThreshold: Math.max(1, Number(input.failedLoginLockoutThreshold ?? current.failedLoginLockoutThreshold)),
        lockoutMinutes: Math.max(1, Number(input.lockoutMinutes ?? current.lockoutMinutes)),
        passwordRotationDays: Math.max(0, Number(input.passwordRotationDays ?? current.passwordRotationDays)),
        updatedAt: nowIso(),
      };
      data.securitySettings = updated;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "security_settings.updated",
        targetType: "SecuritySettings",
        targetId: "global",
        metadata: { before: current, after: updated },
        createdAt: updated.updatedAt,
      });
      return updated;
    });
  },

  async updateAIConfiguration(input: Partial<AIConfiguration>, actorId?: string) {
    return mutate((data) => {
      const current = normalizeAIConfiguration(data.aiConfiguration);
      const primary = normalizeProviderChain(input.providerChain, input.provider ?? current.provider, input.model ?? current.model).find(
        (item) => item.enabled,
      );
      const updated: AIConfiguration = {
        ...current,
        ...input,
        id: "global",
        provider: primary?.provider ?? input.provider ?? current.provider,
        model: primary?.model ?? input.model ?? current.model,
        providerChain: normalizeProviderChain(input.providerChain, input.provider ?? current.provider, input.model ?? current.model),
        providerFallbackStrategy: input.providerFallbackStrategy === "round_robin" ? "round_robin" : "priority",
        autoHandoff: { ...current.autoHandoff, ...(input.autoHandoff ?? {}) },
        updatedAt: nowIso(),
      };
      data.aiConfiguration = updated;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "ai_config.updated",
        targetType: "AIConfiguration",
        targetId: updated.id,
        metadata: {
          provider: updated.provider,
          model: updated.model,
          ...aiConfigAuditDiff(current, updated),
        },
        createdAt: updated.updatedAt,
      });
      return updated;
    });
  },

  async addAITrace(input: Omit<AITrace, "id" | "createdAt">) {
    return mutate((data) => {
      const trace: AITrace = { ...input, id: randomId("ait"), createdAt: nowIso() };
      data.aiTraces.unshift(trace);
      data.aiTraces = data.aiTraces.slice(0, 500);
      return trace;
    });
  },

  async listAITraces(limit = 50) {
    const data = await readStore();
    return [...data.aiTraces]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  },

  async getOrCreateConversation(visitorSessionId: string) {
    return mutate((data) => {
      let conversation = data.conversations.find((item) => item.visitorSessionId === visitorSessionId);
      if (conversation) return withMessages(conversation, data);

      const createdAt = nowIso();
      conversation = {
        id: randomId("con"),
        visitorSessionId,
        status: "ai_active",
        metadata: {},
        createdAt,
        updatedAt: createdAt,
      };
      data.conversations.unshift(conversation);
      data.auditLogs.push({
        id: randomId("aud"),
        action: "conversation.created",
        targetType: "Conversation",
        targetId: conversation.id,
        metadata: { visitorSessionId },
        createdAt,
      });
      return withMessages(conversation, data);
    });
  },

  async createConversation(input?: {
    visitorSessionId?: string;
    externalUserId?: string;
    subject?: string;
    metadata?: Record<string, unknown>;
  }) {
    return mutate((data) => {
      const createdAt = nowIso();
      const conversation: Conversation = {
        id: randomId("con"),
        visitorSessionId: input?.visitorSessionId ?? randomId("vis"),
        externalUserId: input?.externalUserId,
        subject: input?.subject,
        status: "ai_active",
        metadata: input?.metadata ?? {},
        createdAt,
        updatedAt: createdAt,
      };
      data.conversations.unshift(conversation);
      data.auditLogs.push({
        id: randomId("aud"),
        action: "conversation.created",
        targetType: "Conversation",
        targetId: conversation.id,
        metadata: { source: "integration", externalUserId: input?.externalUserId },
        createdAt,
      });
      return withMessages(conversation, data);
    });
  },

  async getConversation(id: string) {
    const data = await readStore();
    const conversation = data.conversations.find((item) => item.id === id);
    return conversation ? withMessages(conversation, data) : undefined;
  },

  async getConversationByVisitorSession(visitorSessionId: string) {
    const data = await readStore();
    const conversation = data.conversations.find((item) => item.visitorSessionId === visitorSessionId);
    return conversation ? withMessages(conversation, data) : undefined;
  },

  async listConversations() {
    const data = await readStore();
    return [...data.conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((conversation) => withMessages(conversation, data));
  },

  async addMessage(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return mutate((data) => {
      const conversation = data.conversations.find((item) => item.id === input.conversationId);
      if (!conversation) throw new Error("Conversation not found");

      const createdAt = nowIso();
      const message: Message = {
        id: randomId("msg"),
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        agentId: input.agentId,
        metadata: input.metadata ?? {},
        createdAt,
      };
      data.messages.push(message);
      conversation.updatedAt = createdAt;
      if (!conversation.subject && input.role === "visitor") {
        conversation.subject = input.content.slice(0, 80);
      }
      return message;
    });
  },

  async setConversationStatus(id: string, status: ConversationStatus, agentId?: string) {
    return mutate((data) => {
      const conversation = data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation not found");
      const updatedAt = nowIso();
      const previousStatus = conversation.status;
      const previousAgentId = conversation.takenOverById;
      conversation.status = status;
      conversation.updatedAt = updatedAt;
      if (status === "human_active") {
        conversation.takenOverById = agentId;
        conversation.takenOverAt = updatedAt;
      }
      if (status === "ai_active") {
        conversation.takenOverById = undefined;
        conversation.takenOverAt = undefined;
      }
      if (status === "closed") {
        conversation.closedAt = updatedAt;
      }
      data.auditLogs.push({
        id: randomId("aud"),
        actorId: agentId,
        action: `conversation.${status}`,
        targetType: "Conversation",
        targetId: id,
        metadata: {
          previousStatus,
          status,
          previousAgentId,
          agentId,
          closedAt: conversation.closedAt,
          takenOverAt: conversation.takenOverAt,
        },
        createdAt: updatedAt,
      });
      return withMessages(conversation, data);
    });
  },

  async deleteConversation(id: string, actorId?: string) {
    return mutate((data) => {
      const conversation = data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation not found");
      const messageCount = data.messages.filter((message) => message.conversationId === id).length;
      const traceCount = data.aiTraces.filter((trace) => trace.conversationId === id).length;
      const toolLogCount = data.toolInvocationLogs.filter((log) => log.conversationId === id).length;
      data.conversations = data.conversations.filter((item) => item.id !== id);
      data.messages = data.messages.filter((message) => message.conversationId !== id);
      data.aiTraces = data.aiTraces.filter((trace) => trace.conversationId !== id);
      data.toolInvocationLogs = data.toolInvocationLogs.filter((log) => log.conversationId !== id);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "conversation.deleted",
        targetType: "Conversation",
        targetId: id,
        metadata: {
          visitorSessionId: conversation.visitorSessionId,
          status: conversation.status,
          messageCount,
          traceCount,
          toolLogCount,
        },
        createdAt: nowIso(),
      });
      return { ok: true };
    });
  },

  async mergeConversationMetadata(id: string, metadata: Record<string, unknown>) {
    return mutate((data) => {
      const conversation = data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation not found");
      const changedFields = Object.keys(metadata);
      conversation.metadata = { ...conversation.metadata, ...metadata };
      const updatedAt = nowIso();
      conversation.updatedAt = updatedAt;
      data.auditLogs.push({
        id: randomId("aud"),
        action: "conversation.metadata_updated",
        targetType: "Conversation",
        targetId: id,
        metadata: {
          changedFields,
          metadataSummary: auditSummary(metadata),
        },
        createdAt: updatedAt,
      });
      return withMessages(conversation, data);
    });
  },

  async bindConversationExternalUser(id: string, externalUserId: string, metadata?: Record<string, unknown>) {
    return mutate((data) => {
      const conversation = data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation not found");
      const updatedAt = nowIso();
      const previousExternalUserId = conversation.externalUserId;
      conversation.externalUserId = externalUserId;
      conversation.metadata = { ...conversation.metadata, ...(metadata ?? {}) };
      conversation.updatedAt = updatedAt;
      data.auditLogs.push({
        id: randomId("aud"),
        action: "conversation.external_user_bound",
        targetType: "Conversation",
        targetId: id,
        metadata: {
          previousExternalUserId,
          externalUserId,
          metadataSummary: auditSummary(metadata ?? {}),
        },
        createdAt: updatedAt,
      });
      return withMessages(conversation, data);
    });
  },

  async listWebhookEndpoints() {
    const data = await readStore();
    return data.webhookEndpoints.filter((endpoint) => endpoint.enabled);
  },

  async getWebhookEndpoint(id: string) {
    const data = await readStore();
    return data.webhookEndpoints.find((endpoint) => endpoint.id === id);
  },

  async listToolDefinitions() {
    const data = await readStore();
    return [...data.toolDefinitions].sort((a, b) => a.name.localeCompare(b.name));
  },

  async upsertToolDefinition(
    input: Partial<Omit<ToolDefinition, "id" | "createdAt" | "updatedAt">> & Pick<ToolDefinition, "name">,
    actorId?: string,
  ) {
    return mutate((data) => {
      const name = input.name.trim();
      if (!name) throw new Error("Tool name is required");
      const createdAt = nowIso();
      const existing = data.toolDefinitions.find((tool) => tool.name === name);
      const permissionScope = (input.permissionScope ?? existing?.permissionScope ?? "ai") as ToolPermissionScope;
      const updated: ToolDefinition = {
        id: existing?.id ?? randomId("tool"),
        name,
        description: String(input.description ?? existing?.description ?? "").trim(),
        inputSchema: input.inputSchema ?? existing?.inputSchema ?? {},
        authConfig: input.authConfig ?? existing?.authConfig ?? {},
        timeoutMs: Math.max(100, Number(input.timeoutMs ?? existing?.timeoutMs ?? 5000)),
        enabled: input.enabled ?? existing?.enabled ?? true,
        permissionScope,
        createdAt: existing?.createdAt ?? createdAt,
        updatedAt: createdAt,
      };
      if (existing) {
        Object.assign(existing, updated);
      } else {
        data.toolDefinitions.push(updated);
      }
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: existing ? "tool_definition.updated" : "tool_definition.created",
        targetType: "ToolDefinition",
        targetId: updated.id,
        metadata: {
          name: updated.name,
          enabled: updated.enabled,
          permissionScope: updated.permissionScope,
          timeoutMs: updated.timeoutMs,
        },
        createdAt,
      });
      return updated;
    });
  },

  async addWebhookDelivery(input: Omit<WebhookDelivery, "id" | "createdAt">) {
    return mutate((data) => {
      const delivery: WebhookDelivery = { ...input, id: randomId("whd"), createdAt: nowIso() };
      data.webhookDeliveries.push(delivery);
      data.auditLogs.push({
        id: randomId("aud"),
        action: `webhook_delivery.${input.status}`,
        targetType: "WebhookDelivery",
        targetId: delivery.id,
        metadata: {
          endpointId: input.endpointId,
          event: input.event,
          attempts: input.attempts,
          lastError: input.lastError,
        },
        createdAt: delivery.createdAt,
      });
      return delivery;
    });
  },

  async listWebhookDeliveries() {
    const data = await readStore();
    return data.webhookDeliveries;
  },

  async getWebhookDelivery(id: string) {
    const data = await readStore();
    return data.webhookDeliveries.find((delivery) => delivery.id === id);
  },

  async addWebhookEndpoint(
    input: Pick<WebhookEndpoint, "name" | "url" | "events" | "secret"> &
      Partial<Pick<WebhookEndpoint, "retryMaxAttempts" | "retryBackoffSeconds">>,
  ) {
    return mutate((data) => {
      const createdAt = nowIso();
      const endpoint: WebhookEndpoint = {
        ...input,
        id: randomId("whe"),
        enabled: true,
        retryMaxAttempts: Math.max(1, Number(input.retryMaxAttempts ?? 3)),
        retryBackoffSeconds: Math.max(0, Number(input.retryBackoffSeconds ?? 30)),
        createdAt,
        updatedAt: createdAt,
      };
      data.webhookEndpoints.push(endpoint);
      return endpoint;
    });
  },

  async addAuditLog(input: Omit<AuditLog, "id" | "createdAt">) {
    return mutate((data) => {
      const log: AuditLog = { ...input, id: randomId("aud"), createdAt: nowIso() };
      data.auditLogs.push(log);
      return log;
    });
  },

  async listAuditLogs(limit = 100) {
    const data = await readStore();
    return [...data.auditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  },

  async listApiTokens() {
    const data = await readStore();
    return [...data.apiTokens].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createApiToken(input: { name: string; scopes: string[]; expiresAt?: string }, actorId?: string) {
    return mutate((data) => {
      const now = nowIso();
      const token = createApiTokenSecret();
      const apiToken: ApiToken = {
        id: randomId("tok"),
        name: input.name,
        tokenPrefix: apiTokenPrefixValue(token),
        tokenHash: apiTokenHash(token),
        scopes: input.scopes,
        disabled: false,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      };
      data.apiTokens.push(apiToken);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "api_token.created",
        targetType: "ApiToken",
        targetId: apiToken.id,
        metadata: { name: apiToken.name, scopes: apiToken.scopes, expiresAt: apiToken.expiresAt },
        createdAt: now,
      });
      return { apiToken, token };
    });
  },

  async updateApiToken(
    id: string,
    input: Partial<Pick<ApiToken, "name" | "scopes" | "disabled" | "expiresAt">>,
    actorId?: string,
  ) {
    return mutate((data) => {
      const apiToken = data.apiTokens.find((item) => item.id === id);
      if (!apiToken) throw new Error("API token not found");
      Object.assign(apiToken, input, { updatedAt: nowIso() });
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "api_token.updated",
        targetType: "ApiToken",
        targetId: id,
        metadata: { ...input, tokenHash: undefined },
        createdAt: apiToken.updatedAt,
      });
      return apiToken;
    });
  },

  async deleteApiToken(id: string, actorId?: string) {
    return mutate((data) => {
      const token = data.apiTokens.find((item) => item.id === id);
      if (!token) throw new Error("API token not found");
      data.apiTokens = data.apiTokens.filter((item) => item.id !== id);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "api_token.deleted",
        targetType: "ApiToken",
        targetId: id,
        metadata: { name: token.name },
        createdAt: nowIso(),
      });
      return { ok: true };
    });
  },

  async verifyApiToken(token: string, scope: string) {
    return mutate((data) => {
      const hashed = apiTokenHash(token);
      const apiToken = data.apiTokens.find((item) => item.tokenHash === hashed);
      if (!apiToken || apiToken.disabled || tokenExpired(apiToken)) return undefined;
      if (!apiToken.scopes.includes("*") && !apiToken.scopes.includes(scope)) return undefined;
      apiToken.lastUsedAt = nowIso();
      apiToken.updatedAt = apiToken.updatedAt || apiToken.lastUsedAt;
      return apiToken;
    });
  },

  async getSystemHealth(): Promise<SystemHealth> {
    const time = new Date().toISOString();
    try {
      const data = await readStore();
      const aiConfig = normalizeAIConfiguration(data.aiConfiguration);
      const securitySettings = data.securitySettings ?? defaultSecuritySettings();
      return {
        ok: true,
        time,
        storage: "file-store",
        database: {
          ok: true,
          provider: "file",
          migrationStatus: "not_applicable",
        },
        ai: {
          ok: Boolean(aiConfig.provider && aiConfig.model),
          provider: aiConfig.provider,
          model: aiConfig.model,
          openAIKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        },
        secrets: getSecretHealth(),
        security: securityHealth(securitySettings),
      };
    } catch (error) {
      return {
        ok: false,
        time,
        storage: "file-store",
        database: {
          ok: false,
          provider: "file",
          migrationStatus: "not_applicable",
          error: error instanceof Error ? error.message : "Unknown file-store error",
        },
        ai: {
          ok: false,
          openAIKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
          error: "AI configuration could not be loaded",
        },
        secrets: getSecretHealth(),
        security: securityHealth(defaultSecuritySettings()),
      };
    }
  },

  async getMetrics(filters: AnalyticsFilters = {}) {
    const data = await readStore();
    return computeAnalyticsMetrics(data.conversations.map((conversation) => withMessages(conversation, data)), filters);
  },

  async listKnowledgeBases() {
    const data = await readStore();
    return [...data.knowledgeBases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createKnowledgeBase(input: { name: string; description?: string; enabled?: boolean }, actorId?: string) {
    return mutate((data) => {
      const createdAt = nowIso();
      const knowledgeBase: KnowledgeBase = {
        id: randomId("kb"),
        name: input.name,
        description: input.description,
        enabled: input.enabled ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      data.knowledgeBases.push(knowledgeBase);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_base.created",
        targetType: "KnowledgeBase",
        targetId: knowledgeBase.id,
        metadata: { name: knowledgeBase.name },
        createdAt,
      });
      return knowledgeBase;
    });
  },

  async updateKnowledgeBase(
    id: string,
    input: Partial<Pick<KnowledgeBase, "name" | "description" | "enabled">>,
    actorId?: string,
  ) {
    return mutate((data) => {
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === id);
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      Object.assign(knowledgeBase, input, { updatedAt: nowIso() });
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_base.updated",
        targetType: "KnowledgeBase",
        targetId: id,
        metadata: input,
        createdAt: knowledgeBase.updatedAt,
      });
      return knowledgeBase;
    });
  },

  async deleteKnowledgeBase(id: string, actorId?: string) {
    return mutate((data) => {
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === id);
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      data.knowledgeBases = data.knowledgeBases.filter((item) => item.id !== id);
      data.knowledgeSources = data.knowledgeSources.filter((item) => item.knowledgeBaseId !== id);
      data.knowledgeDocuments = data.knowledgeDocuments.filter((item) => item.knowledgeBaseId !== id);
      data.knowledgeChunks = data.knowledgeChunks.filter((item) => item.knowledgeBaseId !== id);
      data.knowledgeEmbeddings = data.knowledgeEmbeddings.filter((item) => item.knowledgeBaseId !== id);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_base.deleted",
        targetType: "KnowledgeBase",
        targetId: id,
        metadata: { name: knowledgeBase.name },
        createdAt: nowIso(),
      });
      return { ok: true };
    });
  },

  async listKnowledgeDocuments(knowledgeBaseId?: string) {
    const data = await readStore();
    return data.knowledgeDocuments
      .filter((document) => !knowledgeBaseId || document.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async listKnowledgeSources(knowledgeBaseId?: string) {
    const data = await readStore();
    return data.knowledgeSources
      .filter((source) => !knowledgeBaseId || source.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async listKnowledgeEmbeddings(knowledgeBaseId?: string) {
    const data = await readStore();
    return data.knowledgeEmbeddings
      .filter((embedding) => !knowledgeBaseId || embedding.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createKnowledgeDocument(
    input: {
      knowledgeBaseId: string;
      title: string;
      content: string;
      sourceType?: KnowledgeDocument["sourceType"];
      sourceUri?: string;
      sourceMetadata?: Record<string, unknown>;
      enabled?: boolean;
    },
    actorId?: string,
  ) {
    return mutate((data) => {
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      const createdAt = nowIso();
      const content = cleanKnowledgeText(input.content);
      const source: KnowledgeSource = {
        id: randomId("src"),
        knowledgeBaseId: input.knowledgeBaseId,
        type: input.sourceType ?? "manual",
        name: input.title,
        uri: input.sourceUri,
        metadata: input.sourceMetadata ?? {},
        createdAt,
        updatedAt: createdAt,
      };
      const document: KnowledgeDocument = {
        id: randomId("doc"),
        knowledgeBaseId: input.knowledgeBaseId,
        sourceId: source.id,
        title: input.title,
        content,
        sourceType: source.type,
        enabled: input.enabled ?? true,
        contentHash: contentHash(content),
        indexingStatus: "pending",
        createdAt,
        updatedAt: createdAt,
      };
      data.knowledgeSources.push(source);
      data.knowledgeDocuments.push(document);
      try {
        const indexed = buildKnowledgeIndex({
          knowledgeBaseId: document.knowledgeBaseId,
          sourceId: source.id,
          documentId: document.id,
          content: document.content,
          createdAt,
        });
        data.knowledgeChunks.push(...indexed.map((item) => item.chunk));
        data.knowledgeEmbeddings.push(...indexed.map((item) => item.embedding));
        document.indexingStatus = "indexed";
        document.indexedAt = createdAt;
      } catch (error) {
        document.indexingStatus = "failed";
        document.lastIndexError = error instanceof Error ? error.message : "Knowledge indexing failed.";
      }
      knowledgeBase.updatedAt = createdAt;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_document.created",
        targetType: "KnowledgeDocument",
        targetId: document.id,
        metadata: {
          knowledgeBaseId: document.knowledgeBaseId,
          sourceId: source.id,
          sourceType: source.type,
          sourceUri: source.uri,
          sourceMetadata: auditSummary(source.metadata),
          title: document.title,
          indexingStatus: document.indexingStatus,
          chunkCount: data.knowledgeChunks.filter((chunk) => chunk.documentId === document.id).length,
        },
        createdAt,
      });
      return document;
    });
  },

  async updateKnowledgeDocument(
    id: string,
    input: Partial<Pick<KnowledgeDocument, "title" | "content" | "enabled">> & {
      sourceUri?: string;
      sourceMetadata?: Record<string, unknown>;
    },
    actorId?: string,
  ) {
    return mutate((data) => {
      const document = data.knowledgeDocuments.find((item) => item.id === id);
      if (!document) throw new Error("Knowledge document not found");
      const updatedAt = nowIso();
      if (input.title !== undefined) document.title = input.title;
      if (input.content !== undefined) document.content = cleanKnowledgeText(input.content);
      if (input.enabled !== undefined) document.enabled = input.enabled;
      document.updatedAt = updatedAt;
      document.contentHash = contentHash(cleanKnowledgeText(document.content));
      const source = document.sourceId ? data.knowledgeSources.find((item) => item.id === document.sourceId) : undefined;
      if (source) {
        if (input.title !== undefined) source.name = input.title;
        if (input.sourceUri !== undefined) source.uri = input.sourceUri;
        if (input.sourceMetadata !== undefined) source.metadata = input.sourceMetadata;
        source.updatedAt = updatedAt;
      }
      data.knowledgeChunks = data.knowledgeChunks.filter((chunk) => chunk.documentId !== id);
      data.knowledgeEmbeddings = data.knowledgeEmbeddings.filter((embedding) => embedding.documentId !== id);
      if (document.enabled) {
        try {
          const indexed = buildKnowledgeIndex({
            knowledgeBaseId: document.knowledgeBaseId,
            documentId: document.id,
            sourceId: document.sourceId,
            createdAt: updatedAt,
            content: document.content,
          });
          data.knowledgeChunks.push(...indexed.map((item) => item.chunk));
          data.knowledgeEmbeddings.push(...indexed.map((item) => item.embedding));
          document.indexingStatus = "indexed";
          document.indexedAt = updatedAt;
          document.lastIndexError = undefined;
        } catch (error) {
          document.indexingStatus = "failed";
          document.lastIndexError = error instanceof Error ? error.message : "Knowledge indexing failed.";
        }
      } else {
        document.indexingStatus = "pending";
        document.indexedAt = undefined;
        document.lastIndexError = undefined;
      }
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === document.knowledgeBaseId);
      if (knowledgeBase) knowledgeBase.updatedAt = updatedAt;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_document.updated",
        targetType: "KnowledgeDocument",
        targetId: id,
        metadata: { fields: Object.keys(input), knowledgeBaseId: document.knowledgeBaseId },
        createdAt: updatedAt,
      });
      return document;
    });
  },

  async deleteKnowledgeDocument(id: string, actorId?: string) {
    return mutate((data) => {
      const document = data.knowledgeDocuments.find((item) => item.id === id);
      if (!document) throw new Error("Knowledge document not found");
      const sourceId = document.sourceId;
      data.knowledgeDocuments = data.knowledgeDocuments.filter((item) => item.id !== id);
      data.knowledgeChunks = data.knowledgeChunks.filter((item) => item.documentId !== id);
      data.knowledgeEmbeddings = data.knowledgeEmbeddings.filter((item) => item.documentId !== id);
      if (sourceId) {
        data.knowledgeSources = data.knowledgeSources.filter((item) => item.id !== sourceId);
      }
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === document.knowledgeBaseId);
      if (knowledgeBase) knowledgeBase.updatedAt = nowIso();
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_document.deleted",
        targetType: "KnowledgeDocument",
        targetId: id,
        metadata: { title: document.title, knowledgeBaseId: document.knowledgeBaseId },
        createdAt: nowIso(),
      });
      return { ok: true };
    });
  },

  async reindexKnowledgeBase(knowledgeBaseId: string, actorId?: string) {
    return mutate((data) => {
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === knowledgeBaseId);
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      const createdAt = nowIso();
      data.knowledgeChunks = data.knowledgeChunks.filter((chunk) => chunk.knowledgeBaseId !== knowledgeBaseId);
      data.knowledgeEmbeddings = data.knowledgeEmbeddings.filter((embedding) => embedding.knowledgeBaseId !== knowledgeBaseId);
      data.knowledgeDocuments
        .filter((document) => document.knowledgeBaseId === knowledgeBaseId && document.enabled)
        .forEach((document) => {
          try {
            const indexed = buildKnowledgeIndex({
              knowledgeBaseId,
              documentId: document.id,
              sourceId: document.sourceId,
              createdAt,
              content: document.content,
            });
            data.knowledgeChunks.push(...indexed.map((item) => item.chunk));
            data.knowledgeEmbeddings.push(...indexed.map((item) => item.embedding));
            document.indexingStatus = "indexed";
            document.indexedAt = createdAt;
            document.lastIndexError = undefined;
            document.contentHash = contentHash(cleanKnowledgeText(document.content));
          } catch (error) {
            document.indexingStatus = "failed";
            document.lastIndexError = error instanceof Error ? error.message : "Knowledge indexing failed.";
          }
          document.updatedAt = createdAt;
        });
      knowledgeBase.updatedAt = createdAt;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_base.reindexed",
        targetType: "KnowledgeBase",
        targetId: knowledgeBaseId,
        metadata: { chunkCount: data.knowledgeChunks.filter((chunk) => chunk.knowledgeBaseId === knowledgeBaseId).length },
        createdAt,
      });
      return knowledgeBase;
    });
  },

  async searchKnowledge(input: KnowledgeSearchOptions) {
    const data = await readStore();
    const options = normalizeSearchOptions(input);
    const rewrittenQuery = rewriteKnowledgeQuery(input.query);
    const queryTokens = tokenize(rewrittenQuery);
    if (queryTokens.length === 0) return [] as KnowledgeSearchResult[];
    const queryEmbedding = localEmbedding(rewrittenQuery);
    const enabledKbIds = new Set(
      data.knowledgeBases
        .filter((kb) => kb.enabled && (!input.knowledgeBaseIds?.length || input.knowledgeBaseIds.includes(kb.id)))
        .map((kb) => kb.id),
    );
    const enabledDocumentIds = new Set(
      data.knowledgeDocuments
        .filter((document) => document.enabled && enabledKbIds.has(document.knowledgeBaseId))
        .map((document) => document.id),
    );
    return data.knowledgeChunks
      .filter((chunk) => enabledKbIds.has(chunk.knowledgeBaseId) && enabledDocumentIds.has(chunk.documentId))
      .map((chunk): KnowledgeSearchResult | undefined => {
        const embedding = data.knowledgeEmbeddings.find(
          (item) =>
            item.chunkId === chunk.id &&
            item.provider === localEmbeddingProvider &&
            item.model === localEmbeddingModel &&
            item.status === "indexed",
        );
        const keyword = keywordScore(queryTokens, chunk.tokens);
        const vector = embedding?.embedding ? cosineSimilarity(queryEmbedding, embedding.embedding) : 0;
        const document = data.knowledgeDocuments.find((item) => item.id === chunk.documentId);
        const source = chunk.sourceId
          ? data.knowledgeSources.find((item) => item.id === chunk.sourceId)
          : document?.sourceId
            ? data.knowledgeSources.find((item) => item.id === document.sourceId)
            : undefined;
        if (!sourceTypeMatches(source?.type, options.sourceTypes)) return undefined;
        return {
          ...chunk,
          score: hybridScore(keyword, vector, options),
          documentTitle: document?.title ?? "Untitled",
          sourceName: source?.name,
          sourceType: source?.type,
        };
      })
      .filter((result): result is KnowledgeSearchResult => {
        if (!result) return false;
        return result.score > (options.minScore ?? 0.05);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK);
  },

  async addToolInvocationLog(input: {
    toolName: string;
    conversationId?: string;
    input: unknown;
    output?: unknown;
    status: "success" | "failed";
    error?: string;
  }) {
    return mutate((data) => {
      const log = { id: randomId("til"), createdAt: nowIso(), ...input };
      data.toolInvocationLogs.push(log);
      data.auditLogs.push({
        id: randomId("aud"),
        action: `tool.${input.status}`,
        targetType: "Tool",
        targetId: input.toolName,
        metadata: {
          conversationId: input.conversationId,
          status: input.status,
          error: input.error,
          inputSummary: auditSummary(input.input),
          outputSummary: auditSummary(input.output),
        },
        createdAt: log.createdAt,
      });
      return log;
    });
  },
};

type PrismaConversationWithRelations = PrismaConversation & {
  messages?: PrismaMessage[];
  takenOverBy?: Pick<PrismaUser, "id" | "username" | "role"> | null;
};

type PrismaKnowledgeSearchChunk = PrismaKnowledgeChunk & {
  score?: number;
  document?: Pick<PrismaKnowledgeDocument, "title"> | null;
  source?: Pick<PrismaKnowledgeSource, "name" | "type"> | null;
};

declare global {
  var __liveChatPrisma: PrismaClient | undefined;
}

async function getPrisma() {
  if (globalThis.__liveChatPrisma) return globalThis.__liveChatPrisma;
  const client = new PrismaClient();
  globalThis.__liveChatPrisma = client;
  return client;
}

function dateToIso(value?: Date | string | null) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function optionalPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : toPrismaJson(value);
}

function mapAutoHandoff(value: unknown): AIConfiguration["autoHandoff"] {
  return { ...defaultAIConfiguration().autoHandoff, ...recordValue(value) };
}

function mapUser(user: PrismaUser): User {
  return {
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role as User["role"],
    disabled: user.disabled ?? false,
    failedLoginCount: user.failedLoginCount ?? 0,
    lockedUntil: dateToIso(user.lockedUntil),
    passwordChangedAt: dateToIso(user.passwordChangedAt),
    forcePasswordChange: user.forcePasswordChange ?? false,
    locale: user.locale === "zh" ? "zh" : "en",
    createdAt: dateToIso(user.createdAt) ?? nowIso(),
  };
}

function mapAgentStatus(status: PrismaAgentStatus): AgentStatus {
  return {
    userId: status.userId,
    status: status.status as AgentStatus["status"],
    updatedAt: dateToIso(status.updatedAt) ?? nowIso(),
  };
}

function mapUserInvitation(invitation: PrismaUserInvitation): UserInvitation {
  return {
    id: invitation.id,
    username: invitation.username,
    role: invitation.role as UserInvitation["role"],
    tokenHash: invitation.tokenHash,
    invitedById: invitation.invitedById ?? undefined,
    acceptedUserId: invitation.acceptedUserId ?? undefined,
    expiresAt: dateToIso(invitation.expiresAt) ?? nowIso(),
    acceptedAt: dateToIso(invitation.acceptedAt),
    revokedAt: dateToIso(invitation.revokedAt),
    createdAt: dateToIso(invitation.createdAt) ?? nowIso(),
  };
}

function mapAITrace(trace: PrismaAITrace): AITrace {
  return {
    id: trace.id,
    conversationId: trace.conversationId ?? undefined,
    action: trace.action as AITrace["action"],
    provider: trace.provider as AITrace["provider"],
    model: trace.model,
    latencyMs: trace.latencyMs,
    configSnapshot: recordValue(trace.configSnapshot),
    selectedMessages: Array.isArray(trace.selectedMessages)
      ? (trace.selectedMessages as AITrace["selectedMessages"])
      : [],
    knowledgeSources: Array.isArray(trace.knowledgeSources)
      ? (trace.knowledgeSources as AITrace["knowledgeSources"])
      : [],
    toolNames: trace.toolNames,
    toolCallPlaceholders: Array.isArray(trace.toolCallPlaceholders)
      ? (trace.toolCallPlaceholders as AITrace["toolCallPlaceholders"])
      : [],
    handoffReason: trace.handoffReason ?? undefined,
    fallbackReason: trace.fallbackReason ?? undefined,
    error: trace.error ?? undefined,
    replyMessageId: trace.replyMessageId ?? undefined,
    createdAt: dateToIso(trace.createdAt) ?? nowIso(),
  };
}

function mapMessage(message: PrismaMessage): Message {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role as Message["role"],
    content: message.content,
    metadata: recordValue(message.metadata),
    agentId: message.agentId ?? undefined,
    createdAt: dateToIso(message.createdAt) ?? nowIso(),
  };
}

function mapConversation(conversation: PrismaConversation): Conversation {
  return {
    id: conversation.id,
    visitorSessionId: conversation.visitorSessionId,
    externalUserId: conversation.externalUserId ?? undefined,
    status: conversation.status as Conversation["status"],
    subject: conversation.subject ?? undefined,
    metadata: recordValue(conversation.metadata),
    takenOverById: conversation.takenOverById ?? undefined,
    takenOverAt: dateToIso(conversation.takenOverAt),
    createdAt: dateToIso(conversation.createdAt) ?? nowIso(),
    updatedAt: dateToIso(conversation.updatedAt) ?? nowIso(),
    closedAt: dateToIso(conversation.closedAt),
  };
}

function mapConversationWithMessages(conversation: PrismaConversationWithRelations): ConversationWithMessages {
  const base = mapConversation(conversation);
  return {
    ...base,
    messages: (conversation.messages ?? []).map(mapMessage),
    takenOverBy: conversation.takenOverBy
      ? {
          id: conversation.takenOverBy.id,
          username: conversation.takenOverBy.username,
          role: conversation.takenOverBy.role as User["role"],
        }
      : undefined,
    tags: conversationTags(base.metadata),
    customerProfile: customerProfile(base.metadata),
    quickReplies: quickReplies(base.metadata),
  };
}

function mapAIConfiguration(config: PrismaAIConfiguration): AIConfiguration {
  const provider = config.provider as AIConfiguration["provider"];
  const model = config.model;
  return {
    id: config.id,
    provider,
    model,
    providerChain: normalizeProviderChain(config.providerChain, provider, model),
    providerFallbackStrategy: config.providerFallbackStrategy === "round_robin" ? "round_robin" : "priority",
    temperature: config.temperature,
    maxContextMessages: config.maxContextMessages,
    systemPrompt: config.systemPrompt,
    fallbackMessage: config.fallbackMessage,
    noAnswerStrategy: config.noAnswerStrategy as AIConfiguration["noAnswerStrategy"],
    enableKnowledgeBase: config.enableKnowledgeBase,
    enableTools: config.enableTools,
    knowledgeBaseIds: stringArray(config.knowledgeBaseIds),
    translationEnabled: config.translationEnabled ?? false,
    translationProvider: (config.translationProvider as AIConfiguration["translationProvider"]) ?? "mock",
    translationModel: config.translationModel ?? "mock-translate",
    agentLanguage: (config.agentLanguage as AIConfiguration["agentLanguage"]) ?? "zh-CN",
    autoHandoff: mapAutoHandoff(config.autoHandoff),
    createdAt: dateToIso(config.createdAt) ?? nowIso(),
    updatedAt: dateToIso(config.updatedAt) ?? nowIso(),
  };
}

function mapApiToken(token: PrismaApiToken): ApiToken {
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    tokenHash: token.tokenHash,
    scopes: token.scopes,
    disabled: token.disabled,
    expiresAt: dateToIso(token.expiresAt),
    lastUsedAt: dateToIso(token.lastUsedAt),
    createdAt: dateToIso(token.createdAt) ?? nowIso(),
    updatedAt: dateToIso(token.updatedAt) ?? nowIso(),
  };
}

function mapSecuritySettings(settings: PrismaSecuritySettings): SecuritySettings {
  return {
    id: "global",
    failedLoginLockoutThreshold: settings.failedLoginLockoutThreshold,
    lockoutMinutes: settings.lockoutMinutes,
    passwordRotationDays: settings.passwordRotationDays,
    updatedAt: dateToIso(settings.updatedAt) ?? nowIso(),
  };
}

function mapWidgetConfiguration(config: PrismaWidgetConfiguration): WidgetConfiguration {
  return {
    id: "global",
    themeColor: config.themeColor,
    welcomeMessage: config.welcomeMessage,
    offlineMessage: config.offlineMessage,
    enableSatisfaction: config.enableSatisfaction,
    enableTranscriptDownload: config.enableTranscriptDownload,
    requireEndConfirmation: config.requireEndConfirmation,
    createdAt: dateToIso(config.createdAt) ?? nowIso(),
    updatedAt: dateToIso(config.updatedAt) ?? nowIso(),
  };
}

function mapToolDefinition(tool: PrismaToolDefinition): ToolDefinition {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    inputSchema: recordValue(tool.inputSchema),
    authConfig: recordValue(tool.authConfig),
    timeoutMs: tool.timeoutMs,
    enabled: tool.enabled,
    permissionScope: tool.permissionScope as ToolPermissionScope,
    createdAt: dateToIso(tool.createdAt) ?? nowIso(),
    updatedAt: dateToIso(tool.updatedAt) ?? nowIso(),
  };
}

function mapKnowledgeBase(item: PrismaKnowledgeBase): KnowledgeBase {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? undefined,
    enabled: item.enabled,
    createdAt: dateToIso(item.createdAt) ?? nowIso(),
    updatedAt: dateToIso(item.updatedAt) ?? nowIso(),
  };
}

function mapKnowledgeSource(item: PrismaKnowledgeSource): KnowledgeSource {
  return {
    id: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    type: item.type as KnowledgeSource["type"],
    name: item.name,
    uri: item.uri ?? undefined,
    metadata: recordValue(item.metadata),
    createdAt: dateToIso(item.createdAt) ?? nowIso(),
    updatedAt: dateToIso(item.updatedAt) ?? nowIso(),
  };
}

function mapKnowledgeDocument(item: PrismaKnowledgeDocument): KnowledgeDocument {
  return {
    id: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    sourceId: item.sourceId ?? undefined,
    title: item.title,
    sourceType: item.sourceType as KnowledgeDocument["sourceType"],
    content: item.content,
    enabled: item.enabled,
    contentHash: item.contentHash ?? undefined,
    indexingStatus: item.indexingStatus as KnowledgeDocument["indexingStatus"],
    indexedAt: dateToIso(item.indexedAt),
    lastIndexError: item.lastIndexError ?? undefined,
    createdAt: dateToIso(item.createdAt) ?? nowIso(),
    updatedAt: dateToIso(item.updatedAt) ?? nowIso(),
  };
}

function mapKnowledgeSearchResult(chunk: PrismaKnowledgeSearchChunk): KnowledgeSearchResult {
  return {
    id: chunk.id,
    knowledgeBaseId: chunk.knowledgeBaseId,
    documentId: chunk.documentId,
    sourceId: chunk.sourceId ?? undefined,
    content: chunk.content,
    ordinal: chunk.ordinal,
    tokens: stringArray(chunk.tokens),
    tokenCount: chunk.tokenCount,
    createdAt: dateToIso(chunk.createdAt) ?? nowIso(),
    score: chunk.score ?? 0,
    documentTitle: chunk.document?.title ?? "Untitled",
    sourceName: chunk.source?.name,
    sourceType: chunk.source?.type as KnowledgeSource["type"] | undefined,
  };
}

function mapKnowledgeEmbedding(item: PrismaKnowledgeEmbedding): KnowledgeEmbedding {
  return {
    id: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    sourceId: item.sourceId ?? undefined,
    documentId: item.documentId,
    chunkId: item.chunkId,
    provider: item.provider,
    model: item.model,
    dimensions: item.dimensions,
    status: item.status as KnowledgeEmbedding["status"],
    error: item.error ?? undefined,
    createdAt: dateToIso(item.createdAt) ?? nowIso(),
    updatedAt: dateToIso(item.updatedAt) ?? nowIso(),
  };
}

async function writePrismaKnowledgeEmbedding(client: PrismaClient, embedding: KnowledgeEmbedding) {
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Knowledge embedding write failed.");
  try {
    const vector = vectorLiteral(embedding.embedding ?? []);
    await client.$executeRawUnsafe(
      `UPDATE "KnowledgeChunk" SET "embedding" = $1::vector WHERE "id" = $2`,
      vector,
      embedding.chunkId,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "KnowledgeEmbedding"
        ("id", "knowledgeBaseId", "sourceId", "documentId", "chunkId", "provider", "model", "dimensions", "embedding", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, 'indexed', $10, $10)
       ON CONFLICT ("chunkId", "provider", "model")
       DO UPDATE SET
        "knowledgeBaseId" = EXCLUDED."knowledgeBaseId",
        "sourceId" = EXCLUDED."sourceId",
        "documentId" = EXCLUDED."documentId",
        "dimensions" = EXCLUDED."dimensions",
        "embedding" = EXCLUDED."embedding",
        "status" = 'indexed',
        "error" = NULL,
        "updatedAt" = EXCLUDED."updatedAt"`,
      embedding.id,
      embedding.knowledgeBaseId,
      embedding.sourceId ?? null,
      embedding.documentId,
      embedding.chunkId,
      embedding.provider,
      embedding.model,
      embedding.dimensions,
      vector,
      new Date(embedding.updatedAt),
    );
  } catch (error) {
    await client.knowledgeEmbedding.upsert({
      where: {
        chunkId_provider_model: {
          chunkId: embedding.chunkId,
          provider: embedding.provider,
          model: embedding.model,
        },
      },
      create: {
        id: embedding.id,
        knowledgeBaseId: embedding.knowledgeBaseId,
        sourceId: embedding.sourceId,
        documentId: embedding.documentId,
        chunkId: embedding.chunkId,
        provider: embedding.provider,
        model: embedding.model,
        dimensions: embedding.dimensions,
        status: "failed",
        error: errorMessage(error),
      },
      update: {
        dimensions: embedding.dimensions,
        status: "failed",
        error: errorMessage(error),
      },
    });
    throw error;
  }
}

async function prismaVectorScores(client: PrismaClient, chunkIds: string[], query: string) {
  if (!chunkIds.length) return new Map<string, number>();
  const queryVector = vectorLiteral(localEmbedding(query));
  const chunkPlaceholders = chunkIds.map((_, index) => `$${index + 4}`).join(", ");
  try {
    const rows = await client.$queryRawUnsafe<Array<{ chunkId: string; vectorScore: number | string }>>(
      `SELECT "chunkId", GREATEST(0, 1 - ("embedding" <=> $1::vector))::float AS "vectorScore"
       FROM "KnowledgeEmbedding"
       WHERE "provider" = $2
        AND "model" = $3
        AND "status" = 'indexed'
        AND "embedding" IS NOT NULL
        AND "chunkId" IN (${chunkPlaceholders})`,
      queryVector,
      localEmbeddingProvider,
      localEmbeddingModel,
      ...chunkIds,
    );
    return new Map(rows.map((row) => [row.chunkId, Number(row.vectorScore)]));
  } catch {
    return new Map<string, number>();
  }
}

async function prismaVectorCandidates(
  client: PrismaClient,
  input: { query: string; knowledgeBaseIds?: string[]; sourceTypes?: KnowledgeSource["type"][]; limit: number },
) {
  const queryVector = vectorLiteral(localEmbedding(input.query));
  const params: Array<string | number> = [queryVector, localEmbeddingProvider, localEmbeddingModel, input.limit];
  let parameterIndex = 5;
  const knowledgeBaseClause = input.knowledgeBaseIds?.length
    ? `AND kb."id" IN (${input.knowledgeBaseIds.map(() => `$${parameterIndex++}`).join(", ")})`
    : "";
  if (input.knowledgeBaseIds?.length) params.push(...input.knowledgeBaseIds);
  const sourceTypeClause = input.sourceTypes?.length
    ? `AND s."type" IN (${input.sourceTypes.map(() => `$${parameterIndex++}`).join(", ")})`
    : "";
  if (input.sourceTypes?.length) params.push(...input.sourceTypes);

  try {
    const rows = await client.$queryRawUnsafe<Array<{ chunkId: string; vectorScore: number | string }>>(
      `SELECT e."chunkId", GREATEST(0, 1 - (e."embedding" <=> $1::vector))::float AS "vectorScore"
       FROM "KnowledgeEmbedding" e
       INNER JOIN "KnowledgeChunk" c ON c."id" = e."chunkId"
       INNER JOIN "KnowledgeDocument" d ON d."id" = e."documentId"
       INNER JOIN "KnowledgeBase" kb ON kb."id" = e."knowledgeBaseId"
       LEFT JOIN "KnowledgeSource" s ON s."id" = e."sourceId"
       WHERE e."provider" = $2
        AND e."model" = $3
        AND e."status" = 'indexed'
        AND e."embedding" IS NOT NULL
        AND d."enabled" = true
        AND kb."enabled" = true
        ${knowledgeBaseClause}
        ${sourceTypeClause}
       ORDER BY e."embedding" <=> $1::vector
       LIMIT $4`,
      ...params,
    );
    return new Map(rows.map((row) => [row.chunkId, Number(row.vectorScore)]));
  } catch {
    return new Map<string, number>();
  }
}

function mapWebhookEndpoint(endpoint: PrismaWebhookEndpoint): WebhookEndpoint {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    secret: endpoint.secret ?? undefined,
    enabled: endpoint.enabled,
    events: stringArray(endpoint.events) as WebhookEndpoint["events"],
    retryMaxAttempts: endpoint.retryMaxAttempts,
    retryBackoffSeconds: endpoint.retryBackoffSeconds,
    createdAt: dateToIso(endpoint.createdAt) ?? nowIso(),
    updatedAt: dateToIso(endpoint.updatedAt) ?? nowIso(),
  };
}

function mapWebhookDelivery(delivery: PrismaWebhookDelivery): WebhookDelivery {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    event: delivery.event as WebhookDelivery["event"],
    payload: delivery.payload,
    status: delivery.status as WebhookDelivery["status"],
    attempts: delivery.attempts,
    lastError: delivery.lastError ?? undefined,
    createdAt: dateToIso(delivery.createdAt) ?? nowIso(),
  };
}

function mapAuditLog(log: PrismaAuditLog): AuditLog {
  return {
    id: log.id,
    actorId: log.actorId ?? undefined,
    action: log.action,
    targetType: log.targetType ?? undefined,
    targetId: log.targetId ?? undefined,
    metadata: recordValue(log.metadata),
    createdAt: dateToIso(log.createdAt) ?? nowIso(),
  };
}

async function getConversationInclude(prisma: PrismaClient, where: { id: string } | { visitorSessionId: string }) {
  const conversation = await prisma.conversation.findUnique({
    where,
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      takenOverBy: true,
    },
  });
  return conversation ? mapConversationWithMessages(conversation) : undefined;
}

async function ensurePrismaDefaults(prisma: PrismaClient) {
  const [userCount, aiConfig, securitySettings, widgetConfiguration, toolDefinitionCount] = await Promise.all([
    prisma.user.count(),
    prisma.aIConfiguration.findUnique({ where: { id: "global" } }),
    prisma.securitySettings.findUnique({ where: { id: "global" } }),
    prisma.widgetConfiguration.findUnique({ where: { id: "global" } }),
    prisma.toolDefinition.count(),
  ]);
  if (userCount === 0) {
    await prisma.user.create({
      data: {
        username: defaultAdminUsername,
        passwordHash: hashPassword(defaultAdminPassword),
        role: "admin",
        disabled: false,
        failedLoginCount: 0,
        passwordChangedAt: new Date(),
        forcePasswordChange: defaultAdminPassword === "admin123",
        locale: "en",
      },
    });
  }
  if (!aiConfig) {
    const config = defaultAIConfiguration();
    await prisma.aIConfiguration.create({
      data: {
        id: config.id,
        provider: config.provider,
        model: config.model,
        temperature: config.temperature,
        maxContextMessages: config.maxContextMessages,
        systemPrompt: config.systemPrompt,
        fallbackMessage: config.fallbackMessage,
        noAnswerStrategy: config.noAnswerStrategy,
        enableKnowledgeBase: config.enableKnowledgeBase,
        enableTools: config.enableTools,
        knowledgeBaseIds: config.knowledgeBaseIds,
        autoHandoff: config.autoHandoff,
      },
    });
  }
  if (!securitySettings) {
    await prisma.securitySettings.create({
      data: {
        id: "global",
        failedLoginLockoutThreshold: 5,
        lockoutMinutes: 15,
        passwordRotationDays: 90,
      },
    });
  }
  if (!widgetConfiguration) {
    const config = defaultWidgetConfiguration();
    await prisma.widgetConfiguration.create({
      data: {
        id: config.id,
        themeColor: config.themeColor,
        welcomeMessage: config.welcomeMessage,
        offlineMessage: config.offlineMessage,
        enableSatisfaction: config.enableSatisfaction,
        enableTranscriptDownload: config.enableTranscriptDownload,
        requireEndConfirmation: config.requireEndConfirmation,
      },
    });
  }
  if (toolDefinitionCount === 0) {
    await prisma.toolDefinition.createMany({
      data: defaultToolDefinitions().map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputSchema: toPrismaJson(tool.inputSchema),
        authConfig: toPrismaJson(tool.authConfig),
        timeoutMs: tool.timeoutMs,
        enabled: tool.enabled,
        permissionScope: tool.permissionScope,
      })),
      skipDuplicates: true,
    });
  }
}

function createPrismaStore() {
  async function prisma() {
    const client = await getPrisma();
    await ensurePrismaDefaults(client);
    return client;
  }

  return {
    async findUserByUsername(username: string) {
      const client = await prisma();
      const user = await client.user.findUnique({ where: { username } });
      return user ? mapUser(user) : undefined;
    },

    async findUserById(id: string) {
      const client = await prisma();
      const user = await client.user.findUnique({ where: { id } });
      return user ? mapUser(user) : undefined;
    },

    async listUsers() {
      const client = await prisma();
      const users = await client.user.findMany({ orderBy: { username: "asc" } });
      return users.map(mapUser);
    },

    async listAgentStatuses() {
      const client = await prisma();
      const statuses = await client.agentStatus.findMany({ orderBy: { updatedAt: "desc" } });
      return statuses.map(mapAgentStatus);
    },

    async setAgentStatus(userId: string, status: AgentStatus["status"]) {
      const client = await prisma();
      const agentStatus = await client.agentStatus.upsert({
        where: { userId },
        create: { userId, status },
        update: { status },
      });
      return mapAgentStatus(agentStatus);
    },

    async createUser(
      input: { username: string; password: string; role: User["role"]; disabled?: boolean; forcePasswordChange?: boolean },
      actorId?: string,
    ) {
      const client = await prisma();
      const user = await client.user.create({
        data: {
          username: input.username,
          passwordHash: hashPassword(input.password),
          role: input.role,
          disabled: input.disabled ?? false,
          failedLoginCount: 0,
          passwordChangedAt: new Date(),
          forcePasswordChange: input.forcePasswordChange ?? true,
          locale: "en",
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "user.created",
          targetType: "User",
          targetId: user.id,
          metadata: { username: user.username, role: user.role },
        },
      });
      return mapUser(user);
    },

    async updateUser(
      id: string,
      input: Partial<{
        password: string;
        role: User["role"];
        disabled: boolean;
        forcePasswordChange: boolean;
        unlock: boolean;
        locale: User["locale"];
      }>,
      actorId?: string,
    ) {
      const client = await prisma();
      const data: Record<string, unknown> = {};
      if (input.role) data.role = input.role;
      if (input.locale) data.locale = input.locale;
      if (typeof input.disabled === "boolean") data.disabled = input.disabled;
      if (typeof input.forcePasswordChange === "boolean") data.forcePasswordChange = input.forcePasswordChange;
      if (input.unlock) {
        data.failedLoginCount = 0;
        data.lockedUntil = null;
      }
      if (input.password) {
        data.passwordHash = hashPassword(input.password);
        data.passwordChangedAt = new Date();
        data.forcePasswordChange = input.forcePasswordChange ?? true;
        data.failedLoginCount = 0;
        data.lockedUntil = null;
      }
      const user = await client.user.update({ where: { id }, data });
      await client.auditLog.create({
        data: {
          actorId,
          action: "user.updated",
          targetType: "User",
          targetId: user.id,
          metadata: {
            role: user.role,
            locale: user.locale,
            disabled: user.disabled,
            passwordChanged: Boolean(input.password),
            forcePasswordChange: user.forcePasswordChange,
            unlocked: Boolean(input.unlock),
          },
        },
      });
      return mapUser(user);
    },

    async listUserInvitations() {
      const client = await prisma();
      const invitations = await client.userInvitation.findMany({ orderBy: { createdAt: "desc" } });
      return invitations.map(mapUserInvitation);
    },

    async createUserInvitation(
      input: { username: string; role: User["role"]; tokenHash: string; expiresAt: string },
      actorId?: string,
    ) {
      const client = await prisma();
      const existingUser = await client.user.findUnique({ where: { username: input.username } });
      if (existingUser) throw new Error("Username already exists");
      const existingActive = await client.userInvitation.findFirst({
        where: {
          username: input.username,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (existingActive) throw new Error("Active invitation already exists for this username");
      const invitation = await client.userInvitation.create({
        data: {
          username: input.username,
          role: input.role,
          tokenHash: input.tokenHash,
          invitedById: actorId,
          expiresAt: new Date(input.expiresAt),
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "user_invitation.created",
          targetType: "UserInvitation",
          targetId: invitation.id,
          metadata: toPrismaJson({ username: invitation.username, role: invitation.role, expiresAt: invitation.expiresAt }),
        },
      });
      return mapUserInvitation(invitation);
    },

    async findUserInvitationByTokenHash(tokenHash: string) {
      const client = await prisma();
      const invitation = await client.userInvitation.findUnique({ where: { tokenHash } });
      return invitation ? mapUserInvitation(invitation) : undefined;
    },

    async revokeUserInvitation(id: string, actorId?: string) {
      const client = await prisma();
      const invitation = await client.userInvitation.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "user_invitation.revoked",
          targetType: "UserInvitation",
          targetId: invitation.id,
          metadata: toPrismaJson({ username: invitation.username, role: invitation.role }),
        },
      });
      return mapUserInvitation(invitation);
    },

    async acceptUserInvitation(tokenHash: string, password: string) {
      const client = await prisma();
      return client.$transaction(async (tx) => {
        const invitation = await tx.userInvitation.findUnique({ where: { tokenHash } });
        if (!invitation) throw new Error("Invitation not found");
        if (invitation.acceptedAt) throw new Error("Invitation already accepted");
        if (invitation.revokedAt) throw new Error("Invitation revoked");
        if (invitation.expiresAt.getTime() <= Date.now()) throw new Error("Invitation expired");
        const existingUser = await tx.user.findUnique({ where: { username: invitation.username } });
        if (existingUser) throw new Error("Username already exists");
        const user = await tx.user.create({
          data: {
            username: invitation.username,
            passwordHash: hashPassword(password),
            role: invitation.role,
            disabled: false,
            failedLoginCount: 0,
            passwordChangedAt: new Date(),
            forcePasswordChange: false,
            locale: "en",
          },
        });
        const accepted = await tx.userInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date(), acceptedUserId: user.id },
        });
        await tx.auditLog.create({
          data: {
            action: "user_invitation.accepted",
            targetType: "UserInvitation",
            targetId: accepted.id,
            metadata: toPrismaJson({ username: user.username, role: user.role, acceptedUserId: user.id }),
          },
        });
        return { invitation: mapUserInvitation(accepted), user: mapUser(user) };
      });
    },

    async recordFailedLogin(userId: string) {
      const client = await prisma();
      const current = await client.user.findUnique({ where: { id: userId } });
      if (!current) throw new Error("User not found");
      const settingsRecord = await client.securitySettings.findUnique({ where: { id: "global" } });
      const settings = settingsRecord ? mapSecuritySettings(settingsRecord) : defaultSecuritySettings();
      const failedLoginCount = current.failedLoginCount + 1;
      const lockedUntil =
        failedLoginCount >= settings.failedLoginLockoutThreshold
          ? new Date(Date.now() + settings.lockoutMinutes * 60 * 1000)
          : null;
      const user = await client.user.update({
        where: { id: userId },
        data: { failedLoginCount, lockedUntil },
      });
      await client.auditLog.create({
        data: {
          actorId: user.id,
          action: lockedUntil ? "auth.account_locked" : "auth.failed_login_counted",
          targetType: "User",
          targetId: user.id,
          metadata: toPrismaJson({
            failedLoginCount,
            lockedUntil: lockedUntil?.toISOString(),
            lockoutThreshold: settings.failedLoginLockoutThreshold,
            lockoutMinutes: settings.lockoutMinutes,
          }),
        },
      });
      return mapUser(user);
    },

    async recordSuccessfulLogin(userId: string) {
      const client = await prisma();
      const user = await client.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      return mapUser(user);
    },

    async getAIConfiguration() {
      const client = await prisma();
      const config = await client.aIConfiguration.findUnique({ where: { id: "global" } });
      return config ? mapAIConfiguration(config) : defaultAIConfiguration();
    },

    async getSecuritySettings() {
      const client = await prisma();
      const settings = await client.securitySettings.findUnique({ where: { id: "global" } });
      return settings ? mapSecuritySettings(settings) : defaultSecuritySettings();
    },

    async getWidgetConfiguration() {
      const client = await prisma();
      const config = await client.widgetConfiguration.findUnique({ where: { id: "global" } });
      return config ? mapWidgetConfiguration(config) : defaultWidgetConfiguration();
    },

    async updateWidgetConfiguration(
      input: Partial<Omit<WidgetConfiguration, "id" | "createdAt" | "updatedAt">>,
      actorId?: string,
    ) {
      const client = await prisma();
      const current = await this.getWidgetConfiguration();
      const normalized = {
        themeColor: String(input.themeColor ?? current.themeColor).trim() || current.themeColor,
        welcomeMessage: String(input.welcomeMessage ?? current.welcomeMessage).trim() || current.welcomeMessage,
        offlineMessage: String(input.offlineMessage ?? current.offlineMessage).trim() || current.offlineMessage,
        enableSatisfaction: input.enableSatisfaction ?? current.enableSatisfaction,
        enableTranscriptDownload: input.enableTranscriptDownload ?? current.enableTranscriptDownload,
        requireEndConfirmation: input.requireEndConfirmation ?? current.requireEndConfirmation,
      };
      const updated = await client.widgetConfiguration.upsert({
        where: { id: "global" },
        create: {
          id: "global",
          ...normalized,
        },
        update: normalized,
      });
      const mapped = mapWidgetConfiguration(updated);
      await client.auditLog.create({
        data: {
          actorId,
          action: "widget_config.updated",
          targetType: "WidgetConfiguration",
          targetId: "global",
          metadata: toPrismaJson({ before: current, after: mapped }),
        },
      });
      return mapped;
    },

    async updateSecuritySettings(input: Partial<Omit<SecuritySettings, "id" | "updatedAt">>, actorId?: string) {
      const client = await prisma();
      const current = await this.getSecuritySettings();
      const updated = await client.securitySettings.upsert({
        where: { id: "global" },
        create: {
          id: "global",
          failedLoginLockoutThreshold: Math.max(
            1,
            Number(input.failedLoginLockoutThreshold ?? current.failedLoginLockoutThreshold),
          ),
          lockoutMinutes: Math.max(1, Number(input.lockoutMinutes ?? current.lockoutMinutes)),
          passwordRotationDays: Math.max(0, Number(input.passwordRotationDays ?? current.passwordRotationDays)),
        },
        update: {
          failedLoginLockoutThreshold: Math.max(
            1,
            Number(input.failedLoginLockoutThreshold ?? current.failedLoginLockoutThreshold),
          ),
          lockoutMinutes: Math.max(1, Number(input.lockoutMinutes ?? current.lockoutMinutes)),
          passwordRotationDays: Math.max(0, Number(input.passwordRotationDays ?? current.passwordRotationDays)),
        },
      });
      const mapped = mapSecuritySettings(updated);
      await client.auditLog.create({
        data: {
          actorId,
          action: "security_settings.updated",
          targetType: "SecuritySettings",
          targetId: "global",
          metadata: toPrismaJson({ before: current, after: mapped }),
        },
      });
      return mapped;
    },

    async updateAIConfiguration(input: Partial<AIConfiguration>, actorId?: string) {
      const client = await prisma();
      const current = await this.getAIConfiguration();
      const providerChain = normalizeProviderChain(
        input.providerChain,
        input.provider ?? current.provider,
        input.model ?? current.model,
      );
      const primary = providerChain.find((item) => item.enabled) ?? providerChain[0];
      const normalizedInput = {
        ...input,
        provider: primary?.provider ?? input.provider ?? current.provider,
        model: primary?.model ?? input.model ?? current.model,
        providerChain,
        providerFallbackStrategy: input.providerFallbackStrategy === "round_robin" ? "round_robin" : "priority",
        autoHandoff: { ...current.autoHandoff, ...(input.autoHandoff ?? {}) },
      };
      const updated = await client.aIConfiguration.upsert({
        where: { id: "global" },
        create: {
          ...defaultAIConfiguration(),
          ...normalizedInput,
          id: "global",
        },
        update: {
          ...normalizedInput,
          id: undefined,
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "ai_config.updated",
          targetType: "AIConfiguration",
          targetId: "global",
          metadata: toPrismaJson({
            provider: updated.provider,
            model: updated.model,
            ...aiConfigAuditDiff(current, mapAIConfiguration(updated)),
          }),
        },
      });
      return mapAIConfiguration(updated);
    },

    async addAITrace(input: Omit<AITrace, "id" | "createdAt">) {
      const client = await prisma();
      const trace = await client.aITrace.create({
        data: {
          conversationId: input.conversationId,
          action: input.action,
          provider: input.provider,
          model: input.model,
          latencyMs: input.latencyMs,
          configSnapshot: toPrismaJson(input.configSnapshot),
          selectedMessages: toPrismaJson(input.selectedMessages),
          knowledgeSources: toPrismaJson(input.knowledgeSources),
          toolNames: input.toolNames,
          toolCallPlaceholders: toPrismaJson(input.toolCallPlaceholders),
          handoffReason: input.handoffReason,
          fallbackReason: input.fallbackReason,
          error: input.error,
          replyMessageId: input.replyMessageId,
        },
      });
      return mapAITrace(trace);
    },

    async listAITraces(limit = 50) {
      const client = await prisma();
      const traces = await client.aITrace.findMany({
        orderBy: { createdAt: "desc" },
        take: Math.max(1, Math.min(limit, 200)),
      });
      return traces.map(mapAITrace);
    },

    async getOrCreateConversation(visitorSessionId: string) {
      const client = await prisma();
      const existing = await getConversationInclude(client, { visitorSessionId });
      if (existing) return existing;
      const conversation = await client.conversation.create({
        data: {
          visitorSessionId,
          status: "ai_active",
          metadata: {},
        },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          takenOverBy: true,
        },
      });
      await client.auditLog.create({
        data: {
          action: "conversation.created",
          targetType: "Conversation",
          targetId: conversation.id,
          metadata: { visitorSessionId },
        },
      });
      return mapConversationWithMessages(conversation);
    },

    async createConversation(input?: {
      visitorSessionId?: string;
      externalUserId?: string;
      subject?: string;
      metadata?: Record<string, unknown>;
    }) {
      const client = await prisma();
      const conversation = await client.conversation.create({
        data: {
          visitorSessionId: input?.visitorSessionId ?? randomId("vis"),
          externalUserId: input?.externalUserId,
          subject: input?.subject,
          status: "ai_active",
          metadata: toPrismaJson(input?.metadata),
        },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          takenOverBy: true,
        },
      });
      await client.auditLog.create({
        data: {
          action: "conversation.created",
          targetType: "Conversation",
          targetId: conversation.id,
          metadata: { source: "integration", externalUserId: input?.externalUserId },
        },
      });
      return mapConversationWithMessages(conversation);
    },

    async getConversation(id: string) {
      const client = await prisma();
      return getConversationInclude(client, { id });
    },

    async getConversationByVisitorSession(visitorSessionId: string) {
      const client = await prisma();
      return getConversationInclude(client, { visitorSessionId });
    },

    async listConversations() {
      const client = await prisma();
      const conversations = await client.conversation.findMany({
        orderBy: { updatedAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          takenOverBy: true,
        },
      });
      return conversations.map(mapConversationWithMessages);
    },

    async addMessage(input: {
      conversationId: string;
      role: MessageRole;
      content: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    }) {
      const client = await prisma();
      const conversation = await client.conversation.findUnique({ where: { id: input.conversationId } });
      if (!conversation) throw new Error("Conversation not found");
      const message = await client.message.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          agentId: input.agentId,
          metadata: toPrismaJson(input.metadata),
        },
      });
      await client.conversation.update({
        where: { id: input.conversationId },
        data: {
          updatedAt: new Date(),
          subject: conversation.subject || input.role !== "visitor" ? conversation.subject : input.content.slice(0, 80),
        },
      });
      return mapMessage(message);
    },

    async setConversationStatus(id: string, status: ConversationStatus, agentId?: string) {
      const client = await prisma();
      const current = await client.conversation.findUnique({ where: { id } });
      if (!current) throw new Error("Conversation not found");
      const data: Record<string, unknown> = { status, updatedAt: new Date() };
      if (status === "human_active") {
        data.takenOverById = agentId;
        data.takenOverAt = new Date();
      }
      if (status === "ai_active") {
        data.takenOverById = null;
        data.takenOverAt = null;
      }
      if (status === "closed") data.closedAt = new Date();
      await client.conversation.update({ where: { id }, data });
      await client.auditLog.create({
        data: {
          actorId: agentId,
          action: `conversation.${status}`,
          targetType: "Conversation",
          targetId: id,
          metadata: toPrismaJson({
            previousStatus: current.status,
            status,
            previousAgentId: current.takenOverById,
            agentId,
            closedAt: data.closedAt instanceof Date ? data.closedAt.toISOString() : undefined,
            takenOverAt: data.takenOverAt instanceof Date ? data.takenOverAt.toISOString() : undefined,
          }),
        },
      });
      const conversation = await getConversationInclude(client, { id });
      if (!conversation) throw new Error("Conversation not found");
      return conversation;
    },

    async deleteConversation(id: string, actorId?: string) {
      const client = await prisma();
      const conversation = await client.conversation.findUnique({
        where: { id },
        include: { _count: { select: { messages: true, tags: true } } },
      });
      if (!conversation) throw new Error("Conversation not found");
      const [traceDelete, toolLogDelete] = await Promise.all([
        client.aITrace.deleteMany({ where: { conversationId: id } }),
        client.toolInvocationLog.deleteMany({ where: { conversationId: id } }),
      ]);
      await client.conversation.delete({ where: { id } });
      await client.auditLog.create({
        data: {
          actorId,
          action: "conversation.deleted",
          targetType: "Conversation",
          targetId: id,
          metadata: toPrismaJson({
            visitorSessionId: conversation.visitorSessionId,
            status: conversation.status,
            messageCount: conversation._count.messages,
            tagCount: conversation._count.tags,
            traceCount: traceDelete.count,
            toolLogCount: toolLogDelete.count,
          }),
        },
      });
      return { ok: true };
    },

    async mergeConversationMetadata(id: string, metadata: Record<string, unknown>) {
      const client = await prisma();
      const existing = await client.conversation.findUnique({ where: { id } });
      if (!existing) throw new Error("Conversation not found");
      await client.conversation.update({
        where: { id },
        data: { metadata: toPrismaJson({ ...recordValue(existing.metadata), ...metadata }) },
      });
      await client.auditLog.create({
        data: {
          action: "conversation.metadata_updated",
          targetType: "Conversation",
          targetId: id,
          metadata: toPrismaJson({
            changedFields: Object.keys(metadata),
            metadataSummary: auditSummary(metadata),
          }),
        },
      });
      const conversation = await getConversationInclude(client, { id });
      if (!conversation) throw new Error("Conversation not found");
      return conversation;
    },

    async bindConversationExternalUser(id: string, externalUserId: string, metadata?: Record<string, unknown>) {
      const client = await prisma();
      const existing = await client.conversation.findUnique({ where: { id } });
      if (!existing) throw new Error("Conversation not found");
      await client.conversation.update({
        where: { id },
        data: {
          externalUserId,
          metadata: toPrismaJson({ ...recordValue(existing.metadata), ...(metadata ?? {}) }),
        },
      });
      await client.auditLog.create({
        data: {
          action: "conversation.external_user_bound",
          targetType: "Conversation",
          targetId: id,
          metadata: toPrismaJson({
            previousExternalUserId: existing.externalUserId,
            externalUserId,
            metadataSummary: auditSummary(metadata ?? {}),
          }),
        },
      });
      const conversation = await getConversationInclude(client, { id });
      if (!conversation) throw new Error("Conversation not found");
      return conversation;
    },

    async listWebhookEndpoints() {
      const client = await prisma();
      const endpoints = await client.webhookEndpoint.findMany({ where: { enabled: true } });
      return endpoints.map(mapWebhookEndpoint);
    },

    async getWebhookEndpoint(id: string) {
      const client = await prisma();
      const endpoint = await client.webhookEndpoint.findUnique({ where: { id } });
      return endpoint ? mapWebhookEndpoint(endpoint) : undefined;
    },

    async listToolDefinitions() {
      const client = await prisma();
      const tools = await client.toolDefinition.findMany({ orderBy: { name: "asc" } });
      return tools.map(mapToolDefinition);
    },

    async upsertToolDefinition(
      input: Partial<Omit<ToolDefinition, "id" | "createdAt" | "updatedAt">> & Pick<ToolDefinition, "name">,
      actorId?: string,
    ) {
      const client = await prisma();
      const name = input.name.trim();
      if (!name) throw new Error("Tool name is required");
      const existing = await client.toolDefinition.findUnique({ where: { name } });
      const normalized = {
        description: String(input.description ?? existing?.description ?? "").trim(),
        inputSchema: toPrismaJson(input.inputSchema ?? recordValue(existing?.inputSchema) ?? {}),
        authConfig: toPrismaJson(input.authConfig ?? recordValue(existing?.authConfig) ?? {}),
        timeoutMs: Math.max(100, Number(input.timeoutMs ?? existing?.timeoutMs ?? 5000)),
        enabled: input.enabled ?? existing?.enabled ?? true,
        permissionScope: input.permissionScope ?? (existing?.permissionScope as ToolPermissionScope | undefined) ?? "ai",
      };
      const tool = await client.toolDefinition.upsert({
        where: { name },
        create: {
          name,
          ...normalized,
        },
        update: normalized,
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: existing ? "tool_definition.updated" : "tool_definition.created",
          targetType: "ToolDefinition",
          targetId: tool.id,
          metadata: toPrismaJson({
            name: tool.name,
            enabled: tool.enabled,
            permissionScope: tool.permissionScope,
            timeoutMs: tool.timeoutMs,
          }),
        },
      });
      return mapToolDefinition(tool);
    },

    async addWebhookDelivery(input: Omit<WebhookDelivery, "id" | "createdAt">) {
      const client = await prisma();
      const delivery = await client.webhookDelivery.create({
        data: {
          endpointId: input.endpointId,
          event: input.event,
          payload: toPrismaJson(input.payload),
          status: input.status,
          attempts: input.attempts,
          lastError: input.lastError,
        },
      });
      await client.auditLog.create({
        data: {
          action: `webhook_delivery.${input.status}`,
          targetType: "WebhookDelivery",
          targetId: delivery.id,
          metadata: {
            endpointId: input.endpointId,
            event: input.event,
            attempts: input.attempts,
            lastError: input.lastError,
          },
        },
      });
      return mapWebhookDelivery(delivery);
    },

    async listWebhookDeliveries() {
      const client = await prisma();
      const deliveries = await client.webhookDelivery.findMany({ orderBy: { createdAt: "desc" } });
      return deliveries.map(mapWebhookDelivery);
    },

    async getWebhookDelivery(id: string) {
      const client = await prisma();
      const delivery = await client.webhookDelivery.findUnique({ where: { id } });
      return delivery ? mapWebhookDelivery(delivery) : undefined;
    },

    async addWebhookEndpoint(
      input: Pick<WebhookEndpoint, "name" | "url" | "events" | "secret"> &
        Partial<Pick<WebhookEndpoint, "retryMaxAttempts" | "retryBackoffSeconds">>,
    ) {
      const client = await prisma();
      const endpoint = await client.webhookEndpoint.create({
        data: {
          name: input.name,
          url: input.url,
          secret: input.secret,
          events: input.events,
          enabled: true,
          retryMaxAttempts: Math.max(1, Number(input.retryMaxAttempts ?? 3)),
          retryBackoffSeconds: Math.max(0, Number(input.retryBackoffSeconds ?? 30)),
        },
      });
      return mapWebhookEndpoint(endpoint);
    },

    async addAuditLog(input: Omit<AuditLog, "id" | "createdAt">) {
      const client = await prisma();
      const log = await client.auditLog.create({
        data: {
          actorId: input.actorId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: toPrismaJson(input.metadata),
        },
      });
      return mapAuditLog(log);
    },

    async listAuditLogs(limit = 100) {
      const client = await prisma();
      const logs = await client.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
      return logs.map(mapAuditLog);
    },

    async listApiTokens() {
      const client = await prisma();
      const tokens = await client.apiToken.findMany({ orderBy: { createdAt: "desc" } });
      return tokens.map(mapApiToken);
    },

    async createApiToken(input: { name: string; scopes: string[]; expiresAt?: string }, actorId?: string) {
      const client = await prisma();
      const token = createApiTokenSecret();
      const apiToken = await client.apiToken.create({
        data: {
          name: input.name,
          tokenPrefix: apiTokenPrefixValue(token),
          tokenHash: apiTokenHash(token),
          scopes: input.scopes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "api_token.created",
          targetType: "ApiToken",
          targetId: apiToken.id,
          metadata: toPrismaJson({ name: apiToken.name, scopes: apiToken.scopes, expiresAt: input.expiresAt }),
        },
      });
      return { apiToken: mapApiToken(apiToken), token };
    },

    async updateApiToken(
      id: string,
      input: Partial<Pick<ApiToken, "name" | "scopes" | "disabled" | "expiresAt">>,
      actorId?: string,
    ) {
      const client = await prisma();
      const apiToken = await client.apiToken.update({
        where: { id },
        data: {
          name: input.name,
          scopes: input.scopes,
          disabled: input.disabled,
          expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "api_token.updated",
          targetType: "ApiToken",
          targetId: id,
          metadata: toPrismaJson(input),
        },
      });
      return mapApiToken(apiToken);
    },

    async deleteApiToken(id: string, actorId?: string) {
      const client = await prisma();
      const token = await client.apiToken.delete({ where: { id } });
      await client.auditLog.create({
        data: {
          actorId,
          action: "api_token.deleted",
          targetType: "ApiToken",
          targetId: id,
          metadata: toPrismaJson({ name: token.name }),
        },
      });
      return { ok: true };
    },

    async verifyApiToken(token: string, scope: string) {
      const client = await prisma();
      const apiToken = await client.apiToken.findUnique({ where: { tokenHash: apiTokenHash(token) } });
      if (!apiToken || apiToken.disabled || tokenExpired(mapApiToken(apiToken))) return undefined;
      if (!apiToken.scopes.includes("*") && !apiToken.scopes.includes(scope)) return undefined;
      const updated = await client.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } });
      return mapApiToken(updated);
    },

    async getSystemHealth(): Promise<SystemHealth> {
      const time = new Date().toISOString();
      const secrets = getSecretHealth();
      const base: Pick<SystemHealth, "time" | "storage" | "secrets"> = {
        time,
        storage: "prisma",
        secrets,
      };

      try {
        const client = await getPrisma();
        await client.$queryRaw`SELECT 1`;

        let migrationStatus: SystemHealth["database"]["migrationStatus"] = "ok";
        let appliedMigrations = 0;
        let latestMigration: string | undefined;
        try {
          const migrations = await client.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
            SELECT migration_name, finished_at
            FROM "_prisma_migrations"
            WHERE finished_at IS NOT NULL
            ORDER BY finished_at DESC
          `;
          appliedMigrations = migrations.length;
          latestMigration = migrations[0]?.migration_name;
          if (appliedMigrations === 0) migrationStatus = "missing";
        } catch {
          migrationStatus = "missing";
        }

        const [aiConfig, securitySettings] = await Promise.all([
          client.aIConfiguration.findUnique({ where: { id: "global" } }),
          client.securitySettings.findUnique({ where: { id: "global" } }),
        ]);
        const mappedSecuritySettings = securitySettings ? mapSecuritySettings(securitySettings) : defaultSecuritySettings();
        const aiOk = Boolean(aiConfig?.provider && aiConfig?.model);
        const databaseOk = migrationStatus === "ok";
        return {
          ok: databaseOk && aiOk,
          ...base,
          database: {
            ok: databaseOk,
            provider: "postgresql",
            migrationStatus,
            appliedMigrations,
            latestMigration,
          },
          ai: {
            ok: aiOk,
            provider: aiConfig?.provider as AIConfiguration["provider"] | undefined,
            model: aiConfig?.model,
            openAIKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
            error: aiOk ? undefined : "AI configuration row is missing or incomplete",
          },
          security: securityHealth(mappedSecuritySettings),
        };
      } catch (error) {
        return {
          ok: false,
          ...base,
          database: {
            ok: false,
            provider: "postgresql",
            migrationStatus: "error",
            error: error instanceof Error ? error.message : "Unknown database health check error",
          },
          ai: {
            ok: false,
            openAIKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
            error: "AI configuration could not be loaded",
          },
          security: securityHealth(defaultSecuritySettings()),
        };
      }
    },

    async getMetrics(filters: AnalyticsFilters = {}) {
      const client = await prisma();
      const conversations = await client.conversation.findMany({
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          takenOverBy: true,
        },
      });
      return computeAnalyticsMetrics(conversations.map(mapConversationWithMessages), filters);
    },

    async listKnowledgeBases() {
      const client = await prisma();
      const bases = await client.knowledgeBase.findMany({ orderBy: { updatedAt: "desc" } });
      return bases.map(mapKnowledgeBase);
    },

    async createKnowledgeBase(input: { name: string; description?: string; enabled?: boolean }, actorId?: string) {
      const client = await prisma();
      const knowledgeBase = await client.knowledgeBase.create({
        data: {
          name: input.name,
          description: input.description,
          enabled: input.enabled ?? true,
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_base.created",
          targetType: "KnowledgeBase",
          targetId: knowledgeBase.id,
          metadata: { name: knowledgeBase.name },
        },
      });
      return mapKnowledgeBase(knowledgeBase);
    },

    async updateKnowledgeBase(
      id: string,
      input: Partial<Pick<KnowledgeBase, "name" | "description" | "enabled">>,
      actorId?: string,
    ) {
      const client = await prisma();
      const knowledgeBase = await client.knowledgeBase.update({ where: { id }, data: input });
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_base.updated",
          targetType: "KnowledgeBase",
          targetId: id,
          metadata: input,
        },
      });
      return mapKnowledgeBase(knowledgeBase);
    },

    async deleteKnowledgeBase(id: string, actorId?: string) {
      const client = await prisma();
      const knowledgeBase = await client.knowledgeBase.delete({ where: { id } });
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_base.deleted",
          targetType: "KnowledgeBase",
          targetId: id,
          metadata: toPrismaJson({ name: knowledgeBase.name }),
        },
      });
      return { ok: true };
    },

    async listKnowledgeDocuments(knowledgeBaseId?: string) {
      const client = await prisma();
      const documents = await client.knowledgeDocument.findMany({
        where: knowledgeBaseId ? { knowledgeBaseId } : undefined,
        orderBy: { updatedAt: "desc" },
      });
      return documents.map(mapKnowledgeDocument);
    },

    async listKnowledgeSources(knowledgeBaseId?: string) {
      const client = await prisma();
      const sources = await client.knowledgeSource.findMany({
        where: knowledgeBaseId ? { knowledgeBaseId } : undefined,
        orderBy: { updatedAt: "desc" },
      });
      return sources.map(mapKnowledgeSource);
    },

    async listKnowledgeEmbeddings(knowledgeBaseId?: string) {
      const client = await prisma();
      const embeddings = await client.knowledgeEmbedding.findMany({
        where: knowledgeBaseId ? { knowledgeBaseId } : undefined,
        orderBy: { updatedAt: "desc" },
      });
      return embeddings.map(mapKnowledgeEmbedding);
    },

    async createKnowledgeDocument(
      input: {
        knowledgeBaseId: string;
        title: string;
        content: string;
        sourceType?: KnowledgeDocument["sourceType"];
        sourceUri?: string;
        sourceMetadata?: Record<string, unknown>;
        enabled?: boolean;
      },
      actorId?: string,
    ) {
      const client = await prisma();
      const now = new Date();
      const createdAt = now.toISOString();
      const sourceType = input.sourceType ?? "manual";
      const content = cleanKnowledgeText(input.content);
      const source = await client.knowledgeSource.create({
        data: {
          knowledgeBaseId: input.knowledgeBaseId,
          type: sourceType,
          name: input.title,
          uri: input.sourceUri,
          metadata: toPrismaJson(input.sourceMetadata ?? {}),
        },
      });
      const document = await client.knowledgeDocument.create({
        data: {
          knowledgeBaseId: input.knowledgeBaseId,
          sourceId: source.id,
          title: input.title,
          content,
          sourceType,
          enabled: input.enabled ?? true,
          contentHash: contentHash(content),
          indexingStatus: "pending",
        },
      });
      let indexedDocument = document;
      let chunkCount = 0;
      try {
        const indexed = buildKnowledgeIndex({
          knowledgeBaseId: document.knowledgeBaseId,
          sourceId: source.id,
          documentId: document.id,
          content: document.content,
          createdAt,
        });
        for (const item of indexed) {
          await client.knowledgeChunk.create({
            data: {
              id: item.chunk.id,
              knowledgeBaseId: item.chunk.knowledgeBaseId,
              documentId: item.chunk.documentId,
              sourceId: item.chunk.sourceId,
              content: item.chunk.content,
              ordinal: item.chunk.ordinal,
              tokens: item.chunk.tokens,
              tokenCount: item.chunk.tokenCount,
            },
          });
          await writePrismaKnowledgeEmbedding(client, item.embedding);
          chunkCount += 1;
        }
        indexedDocument = await client.knowledgeDocument.update({
          where: { id: document.id },
          data: {
            indexingStatus: "indexed",
            indexedAt: now,
            lastIndexError: null,
          },
        });
      } catch (error) {
        indexedDocument = await client.knowledgeDocument.update({
          where: { id: document.id },
          data: {
            indexingStatus: "failed",
            lastIndexError: error instanceof Error ? error.message : "Knowledge indexing failed.",
          },
        });
      }
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_document.created",
          targetType: "KnowledgeDocument",
          targetId: document.id,
          metadata: {
            knowledgeBaseId: document.knowledgeBaseId,
            sourceId: source.id,
            sourceType: source.type,
            sourceUri: source.uri,
            sourceMetadata: auditSummary(source.metadata),
            title: document.title,
            indexingStatus: indexedDocument.indexingStatus,
            chunkCount,
          },
        },
      });
      return mapKnowledgeDocument(indexedDocument);
    },

    async updateKnowledgeDocument(
      id: string,
      input: Partial<Pick<KnowledgeDocument, "title" | "content" | "enabled">> & {
        sourceUri?: string;
        sourceMetadata?: Record<string, unknown>;
      },
      actorId?: string,
    ) {
      const client = await prisma();
      const existing = await client.knowledgeDocument.findUnique({ where: { id } });
      if (!existing) throw new Error("Knowledge document not found");
      const content = input.content === undefined ? existing.content : cleanKnowledgeText(input.content);
      const enabled = input.enabled ?? existing.enabled;
      if (existing.sourceId) {
        await client.knowledgeSource.update({
          where: { id: existing.sourceId },
          data: {
            name: input.title,
            uri: input.sourceUri,
            metadata: input.sourceMetadata === undefined ? undefined : toPrismaJson(input.sourceMetadata),
          },
        });
      }
      await client.knowledgeEmbedding.deleteMany({ where: { documentId: id } });
      await client.knowledgeChunk.deleteMany({ where: { documentId: id } });
      let document = await client.knowledgeDocument.update({
        where: { id },
        data: {
          title: input.title,
          content,
          enabled,
          contentHash: contentHash(content),
          indexingStatus: enabled ? "pending" : "pending",
          indexedAt: enabled ? undefined : null,
          lastIndexError: null,
        },
      });
      if (enabled) {
        try {
          const indexedAt = new Date();
          const indexed = buildKnowledgeIndex({
            knowledgeBaseId: document.knowledgeBaseId,
            sourceId: document.sourceId ?? undefined,
            documentId: document.id,
            content: document.content,
            createdAt: indexedAt.toISOString(),
          });
          for (const item of indexed) {
            await client.knowledgeChunk.create({
              data: {
                id: item.chunk.id,
                knowledgeBaseId: item.chunk.knowledgeBaseId,
                documentId: item.chunk.documentId,
                sourceId: item.chunk.sourceId,
                content: item.chunk.content,
                ordinal: item.chunk.ordinal,
                tokens: item.chunk.tokens,
                tokenCount: item.chunk.tokenCount,
              },
            });
            await writePrismaKnowledgeEmbedding(client, item.embedding);
          }
          document = await client.knowledgeDocument.update({
            where: { id },
            data: { indexingStatus: "indexed", indexedAt, lastIndexError: null },
          });
        } catch (error) {
          document = await client.knowledgeDocument.update({
            where: { id },
            data: {
              indexingStatus: "failed",
              lastIndexError: error instanceof Error ? error.message : "Knowledge indexing failed.",
            },
          });
        }
      }
      await client.knowledgeBase.update({ where: { id: document.knowledgeBaseId }, data: { updatedAt: new Date() } });
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_document.updated",
          targetType: "KnowledgeDocument",
          targetId: id,
          metadata: toPrismaJson({ fields: Object.keys(input), knowledgeBaseId: document.knowledgeBaseId }),
        },
      });
      return mapKnowledgeDocument(document);
    },

    async deleteKnowledgeDocument(id: string, actorId?: string) {
      const client = await prisma();
      const document = await client.knowledgeDocument.delete({ where: { id } });
      if (document.sourceId) {
        await client.knowledgeSource.delete({ where: { id: document.sourceId } }).catch(() => undefined);
      }
      await client.knowledgeBase.update({ where: { id: document.knowledgeBaseId }, data: { updatedAt: new Date() } });
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_document.deleted",
          targetType: "KnowledgeDocument",
          targetId: id,
          metadata: toPrismaJson({ title: document.title, knowledgeBaseId: document.knowledgeBaseId }),
        },
      });
      return { ok: true };
    },

    async reindexKnowledgeBase(knowledgeBaseId: string, actorId?: string) {
      const client = await prisma();
      const knowledgeBase = await client.knowledgeBase.findUnique({
        where: { id: knowledgeBaseId },
        include: { documents: true },
      });
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      await client.knowledgeEmbedding.deleteMany({ where: { knowledgeBaseId } });
      await client.knowledgeChunk.deleteMany({ where: { knowledgeBaseId } });
      let chunkCount = 0;
      for (const document of knowledgeBase.documents.filter((item) => item.enabled)) {
        try {
          const indexedAt = new Date();
          const indexed = buildKnowledgeIndex({
            knowledgeBaseId,
            documentId: document.id,
            sourceId: document.sourceId ?? undefined,
            content: document.content,
            createdAt: indexedAt.toISOString(),
          });
          for (const item of indexed) {
            await client.knowledgeChunk.create({
              data: {
                id: item.chunk.id,
                knowledgeBaseId,
                documentId: document.id,
                sourceId: document.sourceId,
                content: item.chunk.content,
                ordinal: item.chunk.ordinal,
                tokens: item.chunk.tokens,
                tokenCount: item.chunk.tokenCount,
              },
            });
            await writePrismaKnowledgeEmbedding(client, item.embedding);
            chunkCount += 1;
          }
          await client.knowledgeDocument.update({
            where: { id: document.id },
            data: {
              indexingStatus: "indexed",
              indexedAt,
              lastIndexError: null,
              contentHash: contentHash(cleanKnowledgeText(document.content)),
            },
          });
        } catch (error) {
          await client.knowledgeDocument.update({
            where: { id: document.id },
            data: {
              indexingStatus: "failed",
              lastIndexError: error instanceof Error ? error.message : "Knowledge indexing failed.",
            },
          });
        }
      }
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_base.reindexed",
          targetType: "KnowledgeBase",
          targetId: knowledgeBaseId,
          metadata: { chunkCount },
        },
      });
      const updated = await client.knowledgeBase.update({ where: { id: knowledgeBaseId }, data: { updatedAt: new Date() } });
      return mapKnowledgeBase(updated);
    },

    async searchKnowledge(input: KnowledgeSearchOptions) {
      const client = await prisma();
      const options = normalizeSearchOptions(input);
      const rewrittenQuery = rewriteKnowledgeQuery(input.query);
      const queryTokens = tokenize(rewrittenQuery);
      if (queryTokens.length === 0) return [] as KnowledgeSearchResult[];
      const limit = options.topK ?? 5;
      const candidateLimit = Math.max(limit * (options.candidateMultiplier ?? 20), 50);
      const vectorCandidates = await prismaVectorCandidates(client, {
        query: rewrittenQuery,
        knowledgeBaseIds: input.knowledgeBaseIds,
        sourceTypes: options.sourceTypes,
        limit: candidateLimit,
      });
      const keywordChunks = await client.knowledgeChunk.findMany({
        where: {
          knowledgeBase: {
            enabled: true,
            id: input.knowledgeBaseIds?.length ? { in: input.knowledgeBaseIds } : undefined,
          },
          document: { enabled: true },
          source: options.sourceTypes?.length ? { type: { in: options.sourceTypes } } : undefined,
        },
        include: { document: true, source: true },
        take: candidateLimit,
      });

      const candidateIds = [...new Set([...keywordChunks.map((chunk) => chunk.id), ...vectorCandidates.keys()])];
      const candidates = candidateIds.length
        ? await client.knowledgeChunk.findMany({
            where: { id: { in: candidateIds } },
            include: { document: true, source: true },
          })
        : keywordChunks;
      const missingVectorIds = candidates
        .map((chunk) => chunk.id)
        .filter((id) => !vectorCandidates.has(id));
      const fallbackVectorScores = await prismaVectorScores(client, missingVectorIds, rewrittenQuery);

      return candidates
        .map((chunk): PrismaKnowledgeSearchChunk => {
          const keyword = keywordScore(queryTokens, stringArray(chunk.tokens));
          const vector = vectorCandidates.get(chunk.id) ?? fallbackVectorScores.get(chunk.id) ?? 0;
          return { ...chunk, score: hybridScore(keyword, vector, options) };
        })
        .filter((chunk) => (chunk.score ?? 0) > (options.minScore ?? 0.05))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit)
        .map(mapKnowledgeSearchResult);
    },

    async addToolInvocationLog(input: {
      toolName: string;
      conversationId?: string;
      input: unknown;
      output?: unknown;
      status: "success" | "failed";
      error?: string;
    }) {
      const client = await prisma();
      const log = await client.toolInvocationLog.create({
        data: {
          toolName: input.toolName,
          conversationId: input.conversationId,
          input: toPrismaJson(input.input),
          output: optionalPrismaJson(input.output),
          status: input.status,
          error: input.error,
        },
      });
      await client.auditLog.create({
        data: {
          action: `tool.${input.status}`,
          targetType: "Tool",
          targetId: input.toolName,
          metadata: toPrismaJson({
            conversationId: input.conversationId,
            status: input.status,
            error: input.error,
            inputSummary: auditSummary(input.input),
            outputSummary: auditSummary(input.output),
          }),
        },
      });
      return {
        id: log.id,
        toolName: log.toolName,
        conversationId: log.conversationId ?? undefined,
        input: log.input,
        output: log.output ?? undefined,
        status: log.status === "success" ? "success" : "failed",
        error: log.error ?? undefined,
        createdAt: dateToIso(log.createdAt) ?? nowIso(),
      };
    },
  };
}

export const store = process.env.STORE_DRIVER === "prisma" ? createPrismaStore() : fileStore;
