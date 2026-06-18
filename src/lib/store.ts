import fs from "node:fs/promises";
import path from "node:path";
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
    users: data.users ?? [],
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

export const store = {
  async findUserByUsername(username: string) {
    const data = await readStore();
    return data.users.find((user) => user.username === username);
  },

  async findUserById(id: string) {
    const data = await readStore();
    return data.users.find((user) => user.id === id);
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
