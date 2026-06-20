import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `sha256:${salt}:${hash}`;
}

const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD ?? "admin123";
const aiProvider = process.env.AI_PROVIDER ?? "mock";
const aiModel = process.env.OPENAI_MODEL ?? (aiProvider === "mock" ? "mock-support" : "gpt-4o-mini");
const providerDefaults = {
  mock: { label: "Mock", baseUrl: undefined, apiKeyEnv: undefined },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
};
const primaryProvider = {
  id: "primary",
  provider: aiProvider,
  label: providerDefaults[aiProvider]?.label ?? aiProvider,
  model: aiModel,
  models: [aiModel],
  enabled: true,
  priority: 1,
  timeoutMs: 30000,
};
if (providerDefaults[aiProvider]?.baseUrl) primaryProvider.baseUrl = providerDefaults[aiProvider].baseUrl;
if (providerDefaults[aiProvider]?.apiKeyEnv) primaryProvider.apiKeyEnv = providerDefaults[aiProvider].apiKeyEnv;

await prisma.user.upsert({
  where: { username },
  update: {},
  create: {
    username,
    passwordHash: hashPassword(password),
    role: "admin",
    disabled: false,
    failedLoginCount: 0,
    passwordChangedAt: new Date(),
    forcePasswordChange: password === "admin123",
    locale: "en",
  },
});

await prisma.aIConfiguration.upsert({
  where: { id: "global" },
  update: {},
  create: {
    id: "global",
    provider: aiProvider,
    model: aiModel,
    providerChain: [primaryProvider],
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
  },
});

await prisma.securitySettings.upsert({
  where: { id: "global" },
  update: {},
  create: {
    id: "global",
    failedLoginLockoutThreshold: 5,
    lockoutMinutes: 15,
    passwordRotationDays: 90,
  },
});

await prisma.widgetConfiguration.upsert({
  where: { id: "global" },
  update: {},
  create: {
    id: "global",
    themeColor: "#1f2a44",
    welcomeMessage:
      "Start a conversation. The AI agent will answer first, and a human can take over when needed.",
    offlineMessage: "No human agents are online right now. Leave a message and the AI agent will keep helping.",
    enableSatisfaction: true,
    enableTranscriptDownload: true,
    requireEndConfirmation: true,
  },
});

const toolDefinitions = [
  {
    id: "tool_lookup_customer_profile",
    name: "lookup_customer_profile",
    description: "Returns known metadata for the current visitor session.",
    inputSchema: {
      type: "object",
      properties: { conversationId: { type: "string", description: "Current conversation id" } },
      additionalProperties: true,
    },
    authConfig: {},
    timeoutMs: 5000,
    enabled: true,
    permissionScope: "ai",
  },
  {
    id: "tool_create_support_note",
    name: "create_support_note",
    description: "Records a support note in the conversation timeline.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", description: "Internal support note" } },
      required: ["note"],
      additionalProperties: true,
    },
    authConfig: {},
    timeoutMs: 5000,
    enabled: true,
    permissionScope: "agent",
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
  },
];

for (const tool of toolDefinitions) {
  await prisma.toolDefinition.upsert({
    where: { name: tool.name },
    update: {},
    create: tool,
  });
}

await prisma.$disconnect();
