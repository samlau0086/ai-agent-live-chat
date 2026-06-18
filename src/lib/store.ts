import fs from "node:fs/promises";
import path from "node:path";
import { hashPassword, nowIso, randomId } from "./crypto";
import type {
  Conversation,
  ConversationStatus,
  ConversationWithMessages,
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

async function readStore(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(dataFile, "utf8");
    return JSON.parse(raw) as StoreData;
  } catch {
    const createdAt = nowIso();
    const initial: StoreData = {
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
    };
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

export const store = {
  async findUserByUsername(username: string) {
    const data = await readStore();
    return data.users.find((user) => user.username === username);
  },

  async findUserById(id: string) {
    const data = await readStore();
    return data.users.find((user) => user.id === id);
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
      return log;
    });
  },
};
