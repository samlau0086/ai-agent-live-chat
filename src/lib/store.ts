import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  AIConfiguration as PrismaAIConfiguration,
  AuditLog as PrismaAuditLog,
  Conversation as PrismaConversation,
  KnowledgeBase as PrismaKnowledgeBase,
  KnowledgeChunk as PrismaKnowledgeChunk,
  KnowledgeDocument as PrismaKnowledgeDocument,
  Message as PrismaMessage,
  User as PrismaUser,
  WebhookDelivery as PrismaWebhookDelivery,
  WebhookEndpoint as PrismaWebhookEndpoint,
} from "@prisma/client";
import { hashPassword, nowIso, randomId } from "./crypto";
import type {
  AIConfiguration,
  AuditLog,
  Conversation,
  ConversationStatus,
  ConversationWithMessages,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeSearchResult,
  Message,
  MessageRole,
  StoreData,
  User,
  WebhookDelivery,
  WebhookEndpoint,
} from "./types";

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "store.json");

const defaultAdminUsername = process.env.ADMIN_USERNAME ?? "admin";
const defaultAdminPassword = process.env.ADMIN_PASSWORD ?? "admin123";

function defaultAIConfiguration(createdAt = nowIso()): AIConfiguration {
  return {
    id: "global",
    provider: (process.env.AI_PROVIDER as AIConfiguration["provider"]) ?? "mock",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    maxContextMessages: 12,
    systemPrompt:
      "You are a concise customer support AI. Use available knowledge when relevant. Escalate politely when a human should help. Do not invent account data.",
    fallbackMessage: "I am not certain enough to answer that. A human agent can help from the console.",
    enableKnowledgeBase: true,
    enableTools: true,
    knowledgeBaseIds: [],
    autoHandoff: {
      enabled: true,
      userRequestPatterns: ["human", "agent", "representative", "manual support", "customer service"],
      sensitiveKeywords: ["refund", "legal", "complaint", "lawsuit", "lawyer", "chargeback"],
      vipMetadataKeys: ["vip", "plan:enterprise", "priority"],
      aiFailureThreshold: 2,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeStore(data: Partial<StoreData>): StoreData {
  const now = nowIso();
  return {
    users: (data.users ?? []).map((user) => ({ ...user, disabled: user.disabled ?? false })),
    conversations: data.conversations ?? [],
    messages: data.messages ?? [],
    webhookEndpoints: data.webhookEndpoints ?? [],
    webhookDeliveries: data.webhookDeliveries ?? [],
    toolInvocationLogs: data.toolInvocationLogs ?? [],
    aiConfiguration: data.aiConfiguration ?? defaultAIConfiguration(now),
    knowledgeBases: data.knowledgeBases ?? [],
    knowledgeDocuments: data.knowledgeDocuments ?? [],
    knowledgeChunks: data.knowledgeChunks ?? [],
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
  };
}

function tokenize(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function chunkDocument(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [content]) {
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

  async createUser(input: { username: string; password: string; role: User["role"]; disabled?: boolean }, actorId?: string) {
    return mutate((data) => {
      if (data.users.some((user) => user.username === input.username)) throw new Error("Username already exists");
      const createdAt = nowIso();
      const user: User = {
        id: randomId("usr"),
        username: input.username,
        passwordHash: hashPassword(input.password),
        role: input.role,
        disabled: input.disabled ?? false,
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
    input: Partial<{ password: string; role: User["role"]; disabled: boolean }>,
    actorId?: string,
  ) {
    return mutate((data) => {
      const user = data.users.find((item) => item.id === id);
      if (!user) throw new Error("User not found");
      if (input.role) user.role = input.role;
      if (typeof input.disabled === "boolean") user.disabled = input.disabled;
      if (input.password) user.passwordHash = hashPassword(input.password);
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "user.updated",
        targetType: "User",
        targetId: user.id,
        metadata: { role: user.role, disabled: user.disabled, passwordChanged: Boolean(input.password) },
        createdAt: nowIso(),
      });
      return user;
    });
  },

  async getAIConfiguration() {
    const data = await readStore();
    return data.aiConfiguration ?? defaultAIConfiguration();
  },

  async updateAIConfiguration(input: Partial<AIConfiguration>, actorId?: string) {
    return mutate((data) => {
      const current = data.aiConfiguration ?? defaultAIConfiguration();
      const updated: AIConfiguration = {
        ...current,
        ...input,
        id: "global",
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
        metadata: { provider: updated.provider, model: updated.model },
        createdAt: updated.updatedAt,
      });
      return updated;
    });
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
        metadata: { status },
        createdAt: updatedAt,
      });
      return withMessages(conversation, data);
    });
  },

  async mergeConversationMetadata(id: string, metadata: Record<string, unknown>) {
    return mutate((data) => {
      const conversation = data.conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("Conversation not found");
      conversation.metadata = { ...conversation.metadata, ...metadata };
      conversation.updatedAt = nowIso();
      return withMessages(conversation, data);
    });
  },

  async listWebhookEndpoints() {
    const data = await readStore();
    return data.webhookEndpoints.filter((endpoint) => endpoint.enabled);
  },

  async addWebhookDelivery(input: Omit<WebhookDelivery, "id" | "createdAt">) {
    return mutate((data) => {
      const delivery: WebhookDelivery = { ...input, id: randomId("whd"), createdAt: nowIso() };
      data.webhookDeliveries.push(delivery);
      return delivery;
    });
  },

  async listWebhookDeliveries() {
    const data = await readStore();
    return data.webhookDeliveries;
  },

  async addWebhookEndpoint(input: Pick<WebhookEndpoint, "name" | "url" | "events" | "secret">) {
    return mutate((data) => {
      const createdAt = nowIso();
      const endpoint: WebhookEndpoint = {
        id: randomId("whe"),
        enabled: true,
        createdAt,
        updatedAt: createdAt,
        ...input,
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

  async getMetrics() {
    const data = await readStore();
    const totalConversations = data.conversations.length;
    const aiMessages = data.messages.filter((message) => message.role === "ai").length;
    const humanMessages = data.messages.filter((message) => message.role === "human_agent").length;
    const humanHandled = data.conversations.filter((conversation) => conversation.takenOverById).length;
    const resolved = data.conversations.filter((conversation) => conversation.status === "resolved").length;
    const knowledgeHits = data.messages.filter((message) => {
      const sources = (message.metadata as { knowledgeSources?: unknown[] }).knowledgeSources;
      return Array.isArray(sources) && sources.length > 0;
    }).length;
    return {
      totalConversations,
      aiMessages,
      humanMessages,
      humanHandoffRate: totalConversations ? humanHandled / totalConversations : 0,
      aiResolutionRate: totalConversations ? resolved / totalConversations : 0,
      knowledgeHitRate: aiMessages ? knowledgeHits / aiMessages : 0,
      openConversations: data.conversations.filter((conversation) => !["resolved", "closed"].includes(conversation.status)).length,
    };
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

  async listKnowledgeDocuments(knowledgeBaseId?: string) {
    const data = await readStore();
    return data.knowledgeDocuments
      .filter((document) => !knowledgeBaseId || document.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createKnowledgeDocument(
    input: {
      knowledgeBaseId: string;
      title: string;
      content: string;
      sourceType?: KnowledgeDocument["sourceType"];
      enabled?: boolean;
    },
    actorId?: string,
  ) {
    return mutate((data) => {
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === input.knowledgeBaseId);
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      const createdAt = nowIso();
      const document: KnowledgeDocument = {
        id: randomId("doc"),
        knowledgeBaseId: input.knowledgeBaseId,
        title: input.title,
        content: input.content,
        sourceType: input.sourceType ?? "manual",
        enabled: input.enabled ?? true,
        createdAt,
        updatedAt: createdAt,
      };
      data.knowledgeDocuments.push(document);
      chunkDocument(document.content).forEach((content, index) => {
        data.knowledgeChunks.push({
          id: randomId("chk"),
          knowledgeBaseId: document.knowledgeBaseId,
          documentId: document.id,
          content,
          ordinal: index,
          tokens: tokenize(content),
          createdAt,
        });
      });
      knowledgeBase.updatedAt = createdAt;
      data.auditLogs.push({
        id: randomId("aud"),
        actorId,
        action: "knowledge_document.created",
        targetType: "KnowledgeDocument",
        targetId: document.id,
        metadata: { knowledgeBaseId: document.knowledgeBaseId, title: document.title },
        createdAt,
      });
      return document;
    });
  },

  async reindexKnowledgeBase(knowledgeBaseId: string, actorId?: string) {
    return mutate((data) => {
      const knowledgeBase = data.knowledgeBases.find((item) => item.id === knowledgeBaseId);
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      const createdAt = nowIso();
      data.knowledgeChunks = data.knowledgeChunks.filter((chunk) => chunk.knowledgeBaseId !== knowledgeBaseId);
      data.knowledgeDocuments
        .filter((document) => document.knowledgeBaseId === knowledgeBaseId && document.enabled)
        .forEach((document) => {
          chunkDocument(document.content).forEach((content, index) => {
            data.knowledgeChunks.push({
              id: randomId("chk"),
              knowledgeBaseId,
              documentId: document.id,
              content,
              ordinal: index,
              tokens: tokenize(content),
              createdAt,
            });
          });
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

  async searchKnowledge(input: { query: string; knowledgeBaseIds?: string[]; topK?: number }) {
    const data = await readStore();
    const queryTokens = tokenize(input.query);
    if (queryTokens.length === 0) return [] as KnowledgeSearchResult[];
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
      .map((chunk) => {
        const overlap = queryTokens.filter((token) => chunk.tokens.includes(token)).length;
        const document = data.knowledgeDocuments.find((item) => item.id === chunk.documentId);
        return { ...chunk, score: overlap / Math.max(queryTokens.length, 1), documentTitle: document?.title ?? "Untitled" };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK ?? 5);
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
        metadata: { conversationId: input.conversationId, error: input.error },
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
  return (value ?? {}) as Prisma.InputJsonValue;
}

function optionalPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
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
    createdAt: dateToIso(user.createdAt) ?? nowIso(),
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
  return {
    ...mapConversation(conversation),
    messages: (conversation.messages ?? []).map(mapMessage),
    takenOverBy: conversation.takenOverBy
      ? {
          id: conversation.takenOverBy.id,
          username: conversation.takenOverBy.username,
          role: conversation.takenOverBy.role as User["role"],
        }
      : undefined,
  };
}

function mapAIConfiguration(config: PrismaAIConfiguration): AIConfiguration {
  return {
    id: config.id,
    provider: config.provider as AIConfiguration["provider"],
    model: config.model,
    temperature: config.temperature,
    maxContextMessages: config.maxContextMessages,
    systemPrompt: config.systemPrompt,
    fallbackMessage: config.fallbackMessage,
    enableKnowledgeBase: config.enableKnowledgeBase,
    enableTools: config.enableTools,
    knowledgeBaseIds: stringArray(config.knowledgeBaseIds),
    autoHandoff: mapAutoHandoff(config.autoHandoff),
    createdAt: dateToIso(config.createdAt) ?? nowIso(),
    updatedAt: dateToIso(config.updatedAt) ?? nowIso(),
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

function mapKnowledgeDocument(item: PrismaKnowledgeDocument): KnowledgeDocument {
  return {
    id: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    title: item.title,
    sourceType: item.sourceType as KnowledgeDocument["sourceType"],
    content: item.content,
    enabled: item.enabled,
    createdAt: dateToIso(item.createdAt) ?? nowIso(),
    updatedAt: dateToIso(item.updatedAt) ?? nowIso(),
  };
}

function mapKnowledgeSearchResult(chunk: PrismaKnowledgeSearchChunk): KnowledgeSearchResult {
  return {
    id: chunk.id,
    knowledgeBaseId: chunk.knowledgeBaseId,
    documentId: chunk.documentId,
    content: chunk.content,
    ordinal: chunk.ordinal,
    tokens: stringArray(chunk.tokens),
    createdAt: dateToIso(chunk.createdAt) ?? nowIso(),
    score: chunk.score ?? 0,
    documentTitle: chunk.document?.title ?? "Untitled",
  };
}

function mapWebhookEndpoint(endpoint: PrismaWebhookEndpoint): WebhookEndpoint {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    secret: endpoint.secret ?? undefined,
    enabled: endpoint.enabled,
    events: stringArray(endpoint.events) as WebhookEndpoint["events"],
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
  const [userCount, aiConfig] = await Promise.all([
    prisma.user.count(),
    prisma.aIConfiguration.findUnique({ where: { id: "global" } }),
  ]);
  if (userCount === 0) {
    await prisma.user.create({
      data: {
        username: defaultAdminUsername,
        passwordHash: hashPassword(defaultAdminPassword),
        role: "admin",
        disabled: false,
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
        enableKnowledgeBase: config.enableKnowledgeBase,
        enableTools: config.enableTools,
        knowledgeBaseIds: config.knowledgeBaseIds,
        autoHandoff: config.autoHandoff,
      },
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

    async createUser(input: { username: string; password: string; role: User["role"]; disabled?: boolean }, actorId?: string) {
      const client = await prisma();
      const user = await client.user.create({
        data: {
          username: input.username,
          passwordHash: hashPassword(input.password),
          role: input.role,
          disabled: input.disabled ?? false,
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
      input: Partial<{ password: string; role: User["role"]; disabled: boolean }>,
      actorId?: string,
    ) {
      const client = await prisma();
      const data: Record<string, unknown> = {};
      if (input.role) data.role = input.role;
      if (typeof input.disabled === "boolean") data.disabled = input.disabled;
      if (input.password) data.passwordHash = hashPassword(input.password);
      const user = await client.user.update({ where: { id }, data });
      await client.auditLog.create({
        data: {
          actorId,
          action: "user.updated",
          targetType: "User",
          targetId: user.id,
          metadata: { role: user.role, disabled: user.disabled, passwordChanged: Boolean(input.password) },
        },
      });
      return mapUser(user);
    },

    async getAIConfiguration() {
      const client = await prisma();
      const config = await client.aIConfiguration.findUnique({ where: { id: "global" } });
      return config ? mapAIConfiguration(config) : defaultAIConfiguration();
    },

    async updateAIConfiguration(input: Partial<AIConfiguration>, actorId?: string) {
      const client = await prisma();
      const current = await this.getAIConfiguration();
      const updated = await client.aIConfiguration.upsert({
        where: { id: "global" },
        create: {
          ...defaultAIConfiguration(),
          ...input,
          id: "global",
          autoHandoff: { ...current.autoHandoff, ...(input.autoHandoff ?? {}) },
        },
        update: {
          ...input,
          id: undefined,
          autoHandoff: { ...current.autoHandoff, ...(input.autoHandoff ?? {}) },
        },
      });
      await client.auditLog.create({
        data: {
          actorId,
          action: "ai_config.updated",
          targetType: "AIConfiguration",
          targetId: "global",
          metadata: { provider: updated.provider, model: updated.model },
        },
      });
      return mapAIConfiguration(updated);
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
          metadata: { status },
        },
      });
      const conversation = await getConversationInclude(client, { id });
      if (!conversation) throw new Error("Conversation not found");
      return conversation;
    },

    async mergeConversationMetadata(id: string, metadata: Record<string, unknown>) {
      const client = await prisma();
      const existing = await client.conversation.findUnique({ where: { id } });
      if (!existing) throw new Error("Conversation not found");
      await client.conversation.update({
        where: { id },
        data: { metadata: toPrismaJson({ ...recordValue(existing.metadata), ...metadata }) },
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
      return mapWebhookDelivery(delivery);
    },

    async listWebhookDeliveries() {
      const client = await prisma();
      const deliveries = await client.webhookDelivery.findMany({ orderBy: { createdAt: "desc" } });
      return deliveries.map(mapWebhookDelivery);
    },

    async addWebhookEndpoint(input: Pick<WebhookEndpoint, "name" | "url" | "events" | "secret">) {
      const client = await prisma();
      const endpoint = await client.webhookEndpoint.create({ data: { ...input, enabled: true } });
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

    async getMetrics() {
      const client = await prisma();
      const [
        totalConversations,
        aiMessages,
        humanMessages,
        humanHandled,
        resolved,
        openConversations,
        aiMessageRows,
      ] = await Promise.all([
        client.conversation.count(),
        client.message.count({ where: { role: "ai" } }),
        client.message.count({ where: { role: "human_agent" } }),
        client.conversation.count({ where: { takenOverById: { not: null } } }),
        client.conversation.count({ where: { status: "resolved" } }),
        client.conversation.count({ where: { status: { in: ["ai_active", "queued_for_human", "human_active"] } } }),
        client.message.findMany({ where: { role: "ai" }, select: { metadata: true } }),
      ]);
      const knowledgeHits = aiMessageRows.filter((message: { metadata: unknown }) => {
        const sources = recordValue(message.metadata).knowledgeSources;
        return Array.isArray(sources) && sources.length > 0;
      }).length;
      return {
        totalConversations,
        aiMessages,
        humanMessages,
        humanHandoffRate: totalConversations ? humanHandled / totalConversations : 0,
        aiResolutionRate: totalConversations ? resolved / totalConversations : 0,
        knowledgeHitRate: aiMessages ? knowledgeHits / aiMessages : 0,
        openConversations,
      };
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

    async listKnowledgeDocuments(knowledgeBaseId?: string) {
      const client = await prisma();
      const documents = await client.knowledgeDocument.findMany({
        where: knowledgeBaseId ? { knowledgeBaseId } : undefined,
        orderBy: { updatedAt: "desc" },
      });
      return documents.map(mapKnowledgeDocument);
    },

    async createKnowledgeDocument(
      input: {
        knowledgeBaseId: string;
        title: string;
        content: string;
        sourceType?: KnowledgeDocument["sourceType"];
        enabled?: boolean;
      },
      actorId?: string,
    ) {
      const client = await prisma();
      const document = await client.knowledgeDocument.create({
        data: {
          knowledgeBaseId: input.knowledgeBaseId,
          title: input.title,
          content: input.content,
          sourceType: input.sourceType ?? "manual",
          enabled: input.enabled ?? true,
        },
      });
      await Promise.all(
        chunkDocument(document.content).map((content, index) =>
          client.knowledgeChunk.create({
            data: {
              knowledgeBaseId: document.knowledgeBaseId,
              documentId: document.id,
              content,
              ordinal: index,
              tokens: tokenize(content),
            },
          }),
        ),
      );
      await client.auditLog.create({
        data: {
          actorId,
          action: "knowledge_document.created",
          targetType: "KnowledgeDocument",
          targetId: document.id,
          metadata: { knowledgeBaseId: document.knowledgeBaseId, title: document.title },
        },
      });
      return mapKnowledgeDocument(document);
    },

    async reindexKnowledgeBase(knowledgeBaseId: string, actorId?: string) {
      const client = await prisma();
      const knowledgeBase = await client.knowledgeBase.findUnique({
        where: { id: knowledgeBaseId },
        include: { documents: true },
      });
      if (!knowledgeBase) throw new Error("Knowledge base not found");
      await client.knowledgeChunk.deleteMany({ where: { knowledgeBaseId } });
      let chunkCount = 0;
      for (const document of knowledgeBase.documents.filter((item) => item.enabled)) {
        for (const [index, content] of chunkDocument(document.content).entries()) {
          await client.knowledgeChunk.create({
            data: {
              knowledgeBaseId,
              documentId: document.id,
              content,
              ordinal: index,
              tokens: tokenize(content),
            },
          });
          chunkCount += 1;
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

    async searchKnowledge(input: { query: string; knowledgeBaseIds?: string[]; topK?: number }) {
      const client = await prisma();
      const queryTokens = tokenize(input.query);
      if (queryTokens.length === 0) return [] as KnowledgeSearchResult[];
      const chunks = await client.knowledgeChunk.findMany({
        where: {
          knowledgeBase: {
            enabled: true,
            id: input.knowledgeBaseIds?.length ? { in: input.knowledgeBaseIds } : undefined,
          },
          document: { enabled: true },
        },
        include: { document: true },
        take: 1000,
      });
      return chunks
        .map((chunk): PrismaKnowledgeSearchChunk => {
          const overlap = queryTokens.filter((token) => (chunk.tokens ?? []).includes(token)).length;
          return { ...chunk, score: overlap / Math.max(queryTokens.length, 1) };
        })
        .filter((chunk) => (chunk.score ?? 0) > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, input.topK ?? 5)
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
          metadata: { conversationId: input.conversationId, error: input.error },
        },
      });
      return {
        id: log.id,
        toolName: log.toolName,
        conversationId: log.conversationId ?? undefined,
        input: log.input,
        output: log.output ?? undefined,
        status: log.status,
        error: log.error ?? undefined,
        createdAt: dateToIso(log.createdAt) ?? nowIso(),
      };
    },
  };
}

export const store = process.env.STORE_DRIVER === "prisma" ? createPrismaStore() : fileStore;
