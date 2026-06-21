"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminText } from "@/lib/admin-i18n";
import { webhookEvents } from "@/lib/event-contracts";
import type {
  AIConfiguration,
  AnalyticsMetrics,
  AITrace,
  AuditLog,
  AppLocale,
  ConversationStatus,
  EmailConfiguration,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeEmbedding,
  KnowledgeSearchResult,
  KnowledgeSource,
  NotificationChannel,
  NotificationConfiguration,
  ToolDefinition,
  ToolPermissionScope,
  User,
  UserRole,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
  WidgetConfiguration,
} from "@/lib/types";

type SettingsPayload = {
  aiConfig: AIConfiguration;
};

type AIProviderOption = {
  name: AIConfiguration["provider"];
  label: string;
  description: string;
  capabilities: Array<"chat" | "translation">;
  chatModels: string[];
  translationModels: string[];
  defaultBaseUrl?: string;
  defaultApiKeyEnv?: string;
  supportsCustomBaseUrl: boolean;
  supportsCustomModels: boolean;
  defaults: { chatModel: string; translationModel: string };
};

type SecuritySettings = {
  id: "global";
  failedLoginLockoutThreshold: number;
  lockoutMinutes: number;
  passwordRotationDays: number;
  updatedAt: string;
};

type WidgetSettingsPayload = {
  widgetConfig: WidgetConfiguration;
};

type EmailSettingsPayload = {
  emailConfig: EmailConfiguration;
};

type NotificationSettingsPayload = {
  notificationConfig: NotificationConfiguration;
};

type AdminTool = ToolDefinition & {
  parameters?: Record<string, string>;
  runtimeImplemented?: boolean;
};

type ToolsPayload = {
  tools: AdminTool[];
};

type WebhooksPayload = {
  endpoints: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
};

type KnowledgePayload = {
  knowledgeBases: KnowledgeBase[];
  sources: KnowledgeSource[];
  documents: KnowledgeDocument[];
  embeddings: KnowledgeEmbedding[];
};

type AdminUser = {
  id: string;
  username: string;
  role: UserRole;
  locale: User["locale"];
  disabled: boolean;
  failedLoginCount: number;
  lockedUntil?: string;
  passwordChangedAt?: string;
  forcePasswordChange: boolean;
  passwordChangeRequired: boolean;
  passwordChangeReason?: "forced" | "rotation";
  createdAt: string;
};

type AdminInvitation = {
  id: string;
  username: string;
  role: UserRole;
  invitedById?: string;
  acceptedUserId?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
};

type ReviewItem = {
  id: string;
  status: ConversationStatus;
  subject?: string;
  channel: string;
  rating?: number;
  satisfactionComment?: string;
  tags?: Array<{ name: string; color?: string }>;
  updatedAt: string;
  latestMessageAt?: string;
  latestMessageRole?: string;
  lastVisitorMessage?: string;
  aiMessages: number;
  humanMessages: number;
  waitingSeconds?: number;
};

type ReviewsPayload = {
  reviews: {
    lowRatingThreshold: number;
    lowRating: ReviewItem[];
    unresolved: ReviewItem[];
  };
};

type MissedQuestionCluster = {
  key: string;
  count: number;
  reasons: Record<string, number>;
  channels: Record<string, number>;
  examples: Array<{
    conversationId: string;
    messageId: string;
    content: string;
    reason: string;
    channel: string;
    createdAt: string;
  }>;
  suggestedKnowledgeEntry: {
    title: string;
    question: string;
    answerDraft: string;
    sourceType: "manual";
  };
};

type MissedQuestionsPayload = {
  missedQuestions: {
    totalClusters: number;
    clusters: MissedQuestionCluster[];
  };
};

type KnowledgeGapsPayload = {
  knowledgeGaps: {
    frequentNoReliableHits: Array<{
      key: string;
      count: number;
      reasons: Record<string, number>;
      examples: Array<{ content: string; reason: string }>;
      suggestedAction: string;
    }>;
    staleDocuments: Array<{
      id: string;
      knowledgeBaseId: string;
      title: string;
      sourceType: string;
      indexedAt?: string;
      updatedAt: string;
    }>;
    failedDocuments: Array<{
      id: string;
      knowledgeBaseId: string;
      title: string;
      lastIndexError?: string;
      updatedAt: string;
    }>;
    lowPerformingChunks: Array<{
      chunkId: string;
      documentId: string;
      knowledgeBaseId: string;
      documentTitle: string;
      hitCount: number;
      averageScore: number;
      reason: string;
    }>;
    fallbackTrends: Array<{ reason: string; count: number; examples: string[] }>;
    thresholds: { staleDays: number; lowScoreThreshold: number };
  };
};

type AITestResult = {
  reply?: string;
  action: "replied" | "handoff" | "skipped";
  reason?: string;
  promptSummary: {
    systemPromptLength: number;
    selectedMessageCount: number;
    knowledgeSourceCount: number;
    toolCount: number;
    maxContextMessages: number;
    knowledgeEnabled: boolean;
    toolsEnabled: boolean;
  };
  knowledgeContext: KnowledgeSearchResult[];
  trace?: {
    id: string;
    provider: string;
    model: string;
    latencyMs: number;
    selectedMessageCount: number;
    knowledgeSourceCount: number;
    toolNames: string[];
    toolCallPlaceholders: Array<{
      id?: string;
      name: string;
      arguments: Record<string, unknown>;
      rawArguments?: string;
    }>;
    handoffReason?: string;
    fallbackReason?: string;
    error?: string;
  };
};

type SettingsTab = "ai" | "knowledge" | "channels" | "integrations" | "operations" | "security";

const settingsTabs: Array<{ id: SettingsTab; label: string; description: string }> = [
  { id: "ai", label: "AI", description: "Providers, runtime, tests" },
  { id: "knowledge", label: "Knowledge", description: "RAG sources and search" },
  { id: "channels", label: "Channels", description: "Widget, email, alerts" },
  { id: "integrations", label: "Integrations", description: "Tools and webhooks" },
  { id: "operations", label: "Operations", description: "Metrics and reviews" },
  { id: "security", label: "Security", description: "Users, auth, audit" },
];

const zhSettingsTabs: Record<SettingsTab, { label: string; description: string }> = {
  ai: { label: "AI", description: "模型、运行时、测试" },
  knowledge: { label: "知识库", description: "RAG 来源与搜索" },
  channels: { label: "渠道", description: "组件、邮件、提醒" },
  integrations: { label: "集成", description: "工具与 Webhook" },
  operations: { label: "运营", description: "指标与复盘" },
  security: { label: "安全", description: "用户、认证、审计" },
};

const enSettingsCopy = {
  aiConfiguration: "AI configuration",
  provider: "Provider",
  model: "Model",
  temperature: "Temperature",
  contextMessages: "Context messages",
  providerFallbackChain: "Provider fallback chain",
  providerFallbackHelp: "Providers are tried by priority. Failed or empty replies automatically fall back to the next enabled provider.",
  addProvider: "Add provider",
  fallbackStrategy: "Fallback strategy",
  priority: "Priority",
  displayName: "Display name",
  modelsFallbackOrder: "Models fallback order",
  baseUrl: "Base URL",
  apiKeyEnv: "API key env",
  remove: "Remove",
  systemPrompt: "System prompt",
  fallbackMessage: "Fallback message",
  noAnswerStrategy: "No-answer strategy",
  enableKnowledgeBase: "Enable knowledge base",
  enableTools: "Enable tools",
  enableAutoHandoff: "Enable auto handoff",
  enableAutoTranslation: "Enable auto translation",
  translationProvider: "Translation provider",
  translationModel: "Translation model",
  agentLanguage: "Agent language",
  handoffRequestPatterns: "Handoff request patterns",
  sensitiveKeywords: "Sensitive keywords",
  aiFailureThreshold: "AI failure threshold",
  lowConfidenceKbThreshold: "Low-confidence KB threshold",
  saveAiConfig: "Save AI config",
  knowledgeBase: "Knowledge base",
  knowledgeBaseName: "Knowledge base name",
  create: "Create",
  widget: "Widget",
  themeColor: "Theme color",
  welcomeMessage: "Welcome message",
  offlineMessage: "Offline message",
  satisfactionRating: "Satisfaction rating",
  transcriptDownload: "Transcript download",
  endChatConfirmation: "End-chat confirmation",
  saveWidgetSettings: "Save widget settings",
  emailDelivery: "Email delivery",
  emailDeliveryHelp: "Used by the agent console to email chat transcripts. Secrets are read from environment variables.",
  enableEmailSending: "Enable email sending",
  fromEmail: "From email",
  fromName: "From name",
  replyToEmail: "Reply-to email",
  smtpHost: "SMTP host",
  smtpPort: "SMTP port",
  smtpUsername: "SMTP username",
  smtpPasswordEnv: "SMTP password env var",
  smtpTlsHelp: "Use implicit TLS (port 465). When disabled, STARTTLS is used after connect.",
  resendApiKeyEnv: "Resend API key env var",
  saveEmailSettings: "Save email settings",
  testEmail: "Send test email",
  testEmailRecipient: "Test recipient",
  notifications: "Notifications",
  notificationsHelp: "Send Bark and/or email alerts for new visitor messages and unreplied conversations.",
  enableNotifications: "Enable notifications",
  emailChannel: "Email channel",
  alertRecipients: "Alert recipients, one per line",
  barkChannel: "Bark channel",
  barkServerUrl: "Bark server URL",
  barkDeviceKeys: "Bark device keys, one per line",
  newMessageAlert: "New message alert",
  unrepliedReminder: "Unreplied reminder",
  thresholdsMinutes: "Thresholds in minutes",
  titleTemplate: "Title template",
  bodyTemplate: "Body template",
  templateVariables: "Template variables:",
  saveNotificationSettings: "Save notification settings",
  processRemindersNow: "Process reminders now",
  testNotifications: "Send test notification",
  tools: "Tools",
  description: "Description",
  inputSchema: "Input schema",
  authConfig: "Auth config",
  timeoutMs: "Timeout ms",
  scope: "Scope",
  enabled: "Enabled",
  saveTool: "Save tool",
  webhooks: "Webhooks",
  events: "Events",
  createEndpoint: "Create endpoint",
  recentDeliveries: "Recent deliveries",
  replay: "Replay",
  operations: "Operations",
  from: "From",
  to: "To",
  allStatuses: "All statuses",
  allAgents: "All agents",
  applyFilters: "Apply filters",
  conversations: "Conversations",
  handoff: "Handoff",
  kbHit: "KB hit",
  aiResolution: "AI resolution",
  firstResponse: "First response",
  resolution: "Resolution",
  satisfaction: "Satisfaction",
  security: "Security",
  failedLoginThreshold: "Failed login threshold",
  lockoutMinutes: "Lockout minutes",
  passwordRotationDays: "Password rotation days",
  saveSecuritySettings: "Save security settings",
  invitations: "Invitations",
  username: "Username",
  password: "Password",
  expiresInDays: "Expires in days",
  createInvitation: "Create invitation",
  invitationLink: "Invitation link",
  users: "Users",
  createUser: "Create user",
  requirePasswordChange: "Require password change on first sign-in",
  enable: "Enable",
  disable: "Disable",
  unlock: "Unlock",
  reset: "Reset",
  newPassword: "New password",
  aiTraces: "AI traces",
  testAI: "Test AI",
  runTest: "Run test",
  knowledgeInventory: "Knowledge inventory",
  auditLogs: "Audit logs",
  deleteAuditLog: "Delete",
  clearAuditLogs: "Clear all",
  noAuditLogs: "No audit logs yet.",
  confirmDeleteAuditLog: "Delete this audit log?",
  confirmClearAuditLogs: "Clear all audit logs? This cannot be undone.",
};

const settingsCopy = {
  en: enSettingsCopy,
  zh: {
    ...enSettingsCopy,
    aiConfiguration: "AI \u914d\u7f6e",
    provider: "\u670d\u52a1\u5546",
    model: "\u6a21\u578b",
    temperature: "\u6e29\u5ea6",
    contextMessages: "\u4e0a\u4e0b\u6587\u6d88\u606f\u6570",
    providerFallbackChain: "\u670d\u52a1\u5546 fallback \u94fe",
    providerFallbackHelp: "\u6309\u4f18\u5148\u7ea7\u4f9d\u6b21\u5c1d\u8bd5\u670d\u52a1\u5546\uff1b\u5931\u8d25\u6216\u7a7a\u56de\u590d\u4f1a\u81ea\u52a8\u5207\u6362\u5230\u4e0b\u4e00\u4e2a\u542f\u7528\u9879\u3002",
    addProvider: "\u6dfb\u52a0\u670d\u52a1\u5546",
    fallbackStrategy: "Fallback \u7b56\u7565",
    priority: "\u4f18\u5148\u7ea7",
    displayName: "\u663e\u793a\u540d\u79f0",
    modelsFallbackOrder: "\u6a21\u578b fallback \u987a\u5e8f",
    apiKeyEnv: "API Key \u73af\u5883\u53d8\u91cf",
    remove: "\u5220\u9664",
    fallbackMessage: "Fallback \u6d88\u606f",
    noAnswerStrategy: "\u65e0\u7b54\u6848\u7b56\u7565",
    enableKnowledgeBase: "\u542f\u7528\u77e5\u8bc6\u5e93",
    enableTools: "\u542f\u7528\u5de5\u5177",
    enableAutoHandoff: "\u542f\u7528\u81ea\u52a8\u8f6c\u4eba\u5de5",
    enableAutoTranslation: "\u542f\u7528\u81ea\u52a8\u7ffb\u8bd1",
    translationProvider: "\u7ffb\u8bd1\u670d\u52a1\u5546",
    translationModel: "\u7ffb\u8bd1\u6a21\u578b",
    agentLanguage: "\u5ba2\u670d\u8bed\u8a00",
    handoffRequestPatterns: "\u8f6c\u4eba\u5de5\u89e6\u53d1\u89c4\u5219",
    sensitiveKeywords: "\u654f\u611f\u5173\u952e\u8bcd",
    aiFailureThreshold: "AI \u5931\u8d25\u9608\u503c",
    lowConfidenceKbThreshold: "\u4f4e\u7f6e\u4fe1\u77e5\u8bc6\u5e93\u9608\u503c",
    saveAiConfig: "\u4fdd\u5b58 AI \u914d\u7f6e",
    knowledgeBase: "\u77e5\u8bc6\u5e93",
    knowledgeBaseName: "\u77e5\u8bc6\u5e93\u540d\u79f0",
    create: "\u521b\u5efa",
    widget: "\u804a\u5929\u7ec4\u4ef6",
    themeColor: "\u4e3b\u9898\u989c\u8272",
    welcomeMessage: "\u6b22\u8fce\u8bed",
    offlineMessage: "\u79bb\u7ebf\u63d0\u793a",
    satisfactionRating: "\u6ee1\u610f\u5ea6\u8bc4\u4ef7",
    transcriptDownload: "\u4f1a\u8bdd\u8bb0\u5f55\u4e0b\u8f7d",
    endChatConfirmation: "\u7ed3\u675f\u4f1a\u8bdd\u786e\u8ba4",
    saveWidgetSettings: "\u4fdd\u5b58\u7ec4\u4ef6\u8bbe\u7f6e",
    emailDelivery: "\u90ae\u4ef6\u53d1\u9001",
    emailDeliveryHelp: "\u7528\u4e8e\u5ba2\u670d\u5de5\u4f5c\u53f0\u53d1\u9001\u804a\u5929\u8bb0\u5f55\u90ae\u4ef6\u3002\u5bc6\u94a5\u4ece\u73af\u5883\u53d8\u91cf\u8bfb\u53d6\u3002",
    enableEmailSending: "\u542f\u7528\u90ae\u4ef6\u53d1\u9001",
    fromEmail: "\u53d1\u4ef6\u90ae\u7bb1",
    fromName: "\u53d1\u4ef6\u540d\u79f0",
    replyToEmail: "\u56de\u590d\u90ae\u7bb1",
    smtpHost: "SMTP \u4e3b\u673a",
    smtpPort: "SMTP \u7aef\u53e3",
    smtpUsername: "SMTP \u7528\u6237\u540d",
    smtpPasswordEnv: "SMTP \u5bc6\u7801\u73af\u5883\u53d8\u91cf",
    smtpTlsHelp: "\u4f7f\u7528\u9690\u5f0f TLS\uff08465 \u7aef\u53e3\uff09\u3002\u5173\u95ed\u65f6\u8fde\u63a5\u540e\u4f7f\u7528 STARTTLS\u3002",
    resendApiKeyEnv: "Resend API Key \u73af\u5883\u53d8\u91cf",
    saveEmailSettings: "\u4fdd\u5b58\u90ae\u4ef6\u8bbe\u7f6e",
    testEmail: "\u53d1\u9001\u6d4b\u8bd5\u90ae\u4ef6",
    testEmailRecipient: "\u6d4b\u8bd5\u6536\u4ef6\u4eba",
    notifications: "\u6d88\u606f\u63d0\u9192",
    notificationsHelp: "\u901a\u8fc7 Bark \u548c/\u6216\u90ae\u4ef6\u63d0\u9192\u65b0\u8bbf\u5ba2\u6d88\u606f\u4ee5\u53ca\u672a\u56de\u590d\u4f1a\u8bdd\u3002",
    enableNotifications: "\u542f\u7528\u63d0\u9192",
    emailChannel: "\u90ae\u4ef6\u6e20\u9053",
    alertRecipients: "\u63d0\u9192\u6536\u4ef6\u4eba\uff0c\u6bcf\u884c\u4e00\u4e2a",
    barkChannel: "Bark \u6e20\u9053",
    barkServerUrl: "Bark \u670d\u52a1\u5730\u5740",
    barkDeviceKeys: "Bark Device Key\uff0c\u6bcf\u884c\u4e00\u4e2a",
    newMessageAlert: "\u65b0\u6d88\u606f\u63d0\u9192",
    unrepliedReminder: "\u672a\u56de\u590d\u63d0\u9192",
    thresholdsMinutes: "\u63d0\u9192\u9608\u503c\uff08\u5206\u949f\uff09",
    titleTemplate: "\u6807\u9898\u6a21\u677f",
    bodyTemplate: "\u6b63\u6587\u6a21\u677f",
    templateVariables: "\u6a21\u677f\u53d8\u91cf\uff1a",
    saveNotificationSettings: "\u4fdd\u5b58\u63d0\u9192\u8bbe\u7f6e",
    processRemindersNow: "\u7acb\u5373\u5904\u7406\u63d0\u9192",
    testNotifications: "\u53d1\u9001\u6d4b\u8bd5\u63d0\u9192",
    tools: "\u5de5\u5177",
    description: "\u63cf\u8ff0",
    inputSchema: "\u8f93\u5165 Schema",
    authConfig: "\u8ba4\u8bc1\u914d\u7f6e",
    timeoutMs: "\u8d85\u65f6\u65f6\u95f4 ms",
    scope: "\u6743\u9650\u8303\u56f4",
    enabled: "\u542f\u7528",
    saveTool: "\u4fdd\u5b58\u5de5\u5177",
    webhooks: "Webhook",
    events: "\u4e8b\u4ef6",
    createEndpoint: "\u521b\u5efa Endpoint",
    recentDeliveries: "\u6700\u8fd1\u6295\u9012",
    replay: "\u91cd\u653e",
    operations: "\u8fd0\u8425",
    from: "\u5f00\u59cb",
    to: "\u7ed3\u675f",
    allStatuses: "\u5168\u90e8\u72b6\u6001",
    allAgents: "\u5168\u90e8\u5ba2\u670d",
    applyFilters: "\u5e94\u7528\u7b5b\u9009",
    conversations: "\u4f1a\u8bdd\u6570",
    handoff: "\u8f6c\u4eba\u5de5",
    kbHit: "\u77e5\u8bc6\u5e93\u547d\u4e2d",
    aiResolution: "AI \u89e3\u51b3\u7387",
    firstResponse: "\u9996\u54cd",
    resolution: "\u89e3\u51b3\u65f6\u957f",
    satisfaction: "\u6ee1\u610f\u5ea6",
    security: "\u5b89\u5168",
    failedLoginThreshold: "\u767b\u5f55\u5931\u8d25\u9608\u503c",
    lockoutMinutes: "\u9501\u5b9a\u5206\u949f\u6570",
    passwordRotationDays: "\u5bc6\u7801\u8f6e\u6362\u5929\u6570",
    saveSecuritySettings: "\u4fdd\u5b58\u5b89\u5168\u8bbe\u7f6e",
    invitations: "\u9080\u8bf7",
    username: "\u7528\u6237\u540d",
    password: "\u5bc6\u7801",
    expiresInDays: "\u8fc7\u671f\u5929\u6570",
    createInvitation: "\u521b\u5efa\u9080\u8bf7",
    invitationLink: "\u9080\u8bf7\u94fe\u63a5",
    users: "\u7528\u6237",
    createUser: "\u521b\u5efa\u7528\u6237",
    requirePasswordChange: "\u9996\u6b21\u767b\u5f55\u8981\u6c42\u4fee\u6539\u5bc6\u7801",
    enable: "\u542f\u7528",
    disable: "\u7981\u7528",
    unlock: "\u89e3\u9501",
    reset: "\u91cd\u7f6e",
    newPassword: "\u65b0\u5bc6\u7801",
    aiTraces: "AI Trace",
    testAI: "\u6d4b\u8bd5 AI",
    runTest: "\u8fd0\u884c\u6d4b\u8bd5",
    knowledgeInventory: "\u77e5\u8bc6\u5e93\u6982\u89c8",
    auditLogs: "\u5ba1\u8ba1\u65e5\u5fd7",
    deleteAuditLog: "\u5220\u9664",
    clearAuditLogs: "\u6e05\u7a7a\u5168\u90e8",
    noAuditLogs: "\u6682\u65e0\u5ba1\u8ba1\u65e5\u5fd7\u3002",
    confirmDeleteAuditLog: "\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u5ba1\u8ba1\u65e5\u5fd7\uff1f",
    confirmClearAuditLogs: "\u786e\u5b9a\u6e05\u7a7a\u5168\u90e8\u5ba1\u8ba1\u65e5\u5fd7\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002",
  },
} satisfies Record<AppLocale, Record<string, string>>;

const emptyAiConfig: AIConfiguration = {
  id: "global",
  provider: "mock",
  model: "gpt-4o-mini",
  providerChain: [
    {
      id: "primary",
      provider: "mock",
      label: "Mock",
      model: "mock-support",
      models: ["mock-support"],
      enabled: true,
      priority: 1,
      timeoutMs: 30000,
    },
  ],
  providerFallbackStrategy: "priority",
  temperature: 0.2,
  maxContextMessages: 12,
  systemPrompt: "",
  fallbackMessage: "",
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
    userRequestPatterns: [],
    sensitiveKeywords: [],
    vipMetadataKeys: [],
    aiFailureThreshold: 2,
    lowConfidenceKnowledgeScoreThreshold: 0,
  },
  createdAt: "",
  updatedAt: "",
};

const emptyWidgetConfig: WidgetConfiguration = {
  id: "global",
  themeColor: "#1f2a44",
  welcomeMessage: "Start a conversation. The AI agent will answer first, and a human can take over when needed.",
  offlineMessage: "No human agents are online right now. Leave a message and the AI agent will keep helping.",
  enableSatisfaction: true,
  enableTranscriptDownload: true,
  requireEndConfirmation: true,
  createdAt: "",
  updatedAt: "",
};

const emptyEmailConfig: EmailConfiguration = {
  id: "global",
  provider: "smtp",
  enabled: false,
  fromEmail: "",
  fromName: "AI Agent Live Chat",
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: "",
  smtpPasswordEnv: "SMTP_PASSWORD",
  resendApiKeyEnv: "RESEND_API_KEY",
  replyToEmail: "",
  createdAt: "",
  updatedAt: "",
};

const emptyNotificationConfig: NotificationConfiguration = {
  id: "global",
  enabled: false,
  emailEnabled: true,
  emailRecipients: [],
  barkEnabled: false,
  barkServerUrl: "https://api.day.app",
  barkDeviceKeys: [],
  newMessage: {
    enabled: true,
    channels: ["bark", "email"],
    title: "New live chat message",
    body: "{{customerName}} sent: {{message}}\nConversation: {{conversationId}}\nStatus: {{status}}",
  },
  unreplied: {
    enabled: true,
    channels: ["bark", "email"],
    thresholdsMinutes: [1, 5, 30],
    title: "Live chat waiting {{thresholdMinutes}}m",
    body:
      "{{customerName}} has waited {{thresholdMinutes}} minute(s) without a reply.\nMessage: {{message}}\nConversation: {{conversationId}}\nStatus: {{status}}",
  },
  createdAt: "",
  updatedAt: "",
};

const defaultToolInputSchema = JSON.stringify(
  {
    type: "object",
    properties: {},
    additionalProperties: true,
  },
  null,
  2,
);

function parseJsonObject(value: string, fallback: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : fallback;
  } catch {
    return fallback;
  }
}

function linesToArray(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToLines(value: string[]) {
  return value.join("\n");
}

function fallbackProviderOptions(aiProviders: AIProviderOption[]) {
  return aiProviders.length
    ? aiProviders
    : [
        {
          name: "mock",
          label: "Mock",
          description: "Local mock provider.",
          capabilities: ["chat", "translation"] as Array<"chat" | "translation">,
          chatModels: ["mock-support"],
          translationModels: ["mock-translate"],
          supportsCustomBaseUrl: false,
          supportsCustomModels: false,
          defaults: { chatModel: "mock-support", translationModel: "mock-translate" },
        },
        {
          name: "openai",
          label: "OpenAI",
          description: "OpenAI-compatible provider.",
          capabilities: ["chat", "translation"] as Array<"chat" | "translation">,
          chatModels: ["gpt-4o-mini", "gpt-4o"],
          translationModels: ["gpt-4o-mini"],
          defaultBaseUrl: "https://api.openai.com/v1",
          defaultApiKeyEnv: "OPENAI_API_KEY",
          supportsCustomBaseUrl: false,
          supportsCustomModels: true,
          defaults: { chatModel: "gpt-4o-mini", translationModel: "gpt-4o-mini" },
        },
      ];
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds?: number) {
  if (seconds === undefined) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatScore(value?: number) {
  return value === undefined ? "-" : value.toFixed(1);
}

export function AdminSettings() {
  const [currentUser, setCurrentUser] = useState<Pick<User, "id" | "username" | "role" | "locale"> | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfiguration>(emptyAiConfig);
  const [aiProviders, setAIProviders] = useState<AIProviderOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeEmbeddings, setKnowledgeEmbeddings] = useState<KnowledgeEmbedding[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [aiTraces, setAITraces] = useState<AITrace[]>([]);
  const [tools, setTools] = useState<AdminTool[]>([]);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpoint[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [metrics, setMetrics] = useState<AnalyticsMetrics>();
  const [reviews, setReviews] = useState<ReviewsPayload["reviews"]>();
  const [missedQuestions, setMissedQuestions] = useState<MissedQuestionsPayload["missedQuestions"]>();
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGapsPayload["knowledgeGaps"]>();
  const [metricDateFrom, setMetricDateFrom] = useState("");
  const [metricDateTo, setMetricDateTo] = useState("");
  const [metricAgentId, setMetricAgentId] = useState("");
  const [metricChannel, setMetricChannel] = useState("");
  const [metricTag, setMetricTag] = useState("");
  const [metricStatus, setMetricStatus] = useState<"" | ConversationStatus>("");
  const [metricKnowledgeBaseId, setMetricKnowledgeBaseId] = useState("");
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>({
    id: "global",
    failedLoginLockoutThreshold: 5,
    lockoutMinutes: 15,
    passwordRotationDays: 90,
    updatedAt: "",
  });
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfiguration>(emptyWidgetConfig);
  const [emailConfig, setEmailConfig] = useState<EmailConfiguration>(emptyEmailConfig);
  const [testEmailRecipient, setTestEmailRecipient] = useState("");
  const [notificationConfig, setNotificationConfig] =
    useState<NotificationConfiguration>(emptyNotificationConfig);
  const [notificationActionMessage, setNotificationActionMessage] = useState("");
  const [notificationActionError, setNotificationActionError] = useState("");
  const [notificationBusy, setNotificationBusy] = useState<"" | "save" | "process" | "test">("");
  const [toolName, setToolName] = useState("lookup_customer_profile");
  const [toolDescription, setToolDescription] = useState("");
  const [toolInputSchema, setToolInputSchema] = useState(defaultToolInputSchema);
  const [toolAuthConfig, setToolAuthConfig] = useState("{}");
  const [toolTimeoutMs, setToolTimeoutMs] = useState(5000);
  const [toolEnabled, setToolEnabled] = useState(true);
  const [toolPermissionScope, setToolPermissionScope] = useState<ToolPermissionScope>("ai");
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSelectedEvents, setWebhookSelectedEvents] = useState<WebhookEvent[]>(["message.created"]);
  const [webhookRetryMaxAttempts, setWebhookRetryMaxAttempts] = useState(3);
  const [webhookRetryBackoffSeconds, setWebhookRetryBackoffSeconds] = useState(30);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("agent");
  const [newUserForcePasswordChange, setNewUserForcePasswordChange] = useState(true);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("agent");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [latestInviteUrl, setLatestInviteUrl] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");
  const [selectedKbId, setSelectedKbId] = useState("");
  const [documentSourceType, setDocumentSourceType] = useState<KnowledgeDocument["sourceType"]>("manual");
  const [documentSourceUri, setDocumentSourceUri] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [testMessage, setTestMessage] = useState("How do I get support?");
  const [aiTestResult, setAITestResult] = useState<AITestResult>();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTopK, setSearchTopK] = useState(5);
  const [searchSourceType, setSearchSourceType] = useState<"" | KnowledgeSource["type"]>("");
  const [searchKeywordWeight, setSearchKeywordWeight] = useState(0.65);
  const [searchVectorWeight, setSearchVectorWeight] = useState(0.35);
  const [searchMinScore, setSearchMinScore] = useState(0.05);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const metricsQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (metricDateFrom) params.set("dateFrom", new Date(`${metricDateFrom}T00:00:00`).toISOString());
    if (metricDateTo) params.set("dateTo", new Date(`${metricDateTo}T23:59:59`).toISOString());
    if (metricAgentId) params.set("agentId", metricAgentId);
    if (metricChannel) params.set("channel", metricChannel);
    if (metricTag) params.set("tag", metricTag);
    if (metricStatus) params.set("status", metricStatus);
    if (metricKnowledgeBaseId) params.set("knowledgeBaseId", metricKnowledgeBaseId);
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [metricAgentId, metricChannel, metricDateFrom, metricDateTo, metricKnowledgeBaseId, metricStatus, metricTag]);

  const providerOptions = fallbackProviderOptions(aiProviders);
  const chatProvider = providerOptions.find((provider) => provider.name === aiConfig.provider);
  const translationProvider = providerOptions.find((provider) => provider.name === aiConfig.translationProvider);
  const text = adminText(currentUser?.locale);
  const settingsLocale = currentUser?.locale === "zh" ? "zh" : "en";
  const copy = settingsCopy[settingsLocale];
  const localizedTabs = settingsTabs.map((tab) => ({
    ...tab,
    ...(settingsLocale === "zh" ? zhSettingsTabs[tab.id] : {}),
  }));
  const providerChain = aiConfig.providerChain?.length
    ? aiConfig.providerChain
    : [
        {
          id: "primary",
          provider: aiConfig.provider,
          label: chatProvider?.label ?? aiConfig.provider,
          model: aiConfig.model,
          models: [aiConfig.model],
          enabled: true,
          priority: 1,
          baseUrl: chatProvider?.defaultBaseUrl,
          apiKeyEnv: chatProvider?.defaultApiKeyEnv,
          timeoutMs: 30000,
        },
      ];

  function updateProviderChain(
    index: number,
    patch: Partial<AIConfiguration["providerChain"][number]>,
  ) {
    const next = providerChain.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    const primary = next.find((item) => item.enabled) ?? next[0];
    setAiConfig({
      ...aiConfig,
      providerChain: next,
      provider: primary?.provider ?? aiConfig.provider,
      model: primary?.model ?? aiConfig.model,
    });
  }

  function addProviderChainItem() {
    const option = providerOptions.find((provider) => provider.name === "openrouter") ?? providerOptions[0];
    const next = [
      ...providerChain,
      {
        id: `provider_${providerChain.length + 1}`,
        provider: option.name,
        label: option.label,
        model: option.defaults.chatModel,
        models: [option.defaults.chatModel],
        enabled: true,
        priority: providerChain.length + 1,
        baseUrl: option.defaultBaseUrl,
        apiKeyEnv: option.defaultApiKeyEnv,
        timeoutMs: 30000,
      },
    ];
    setAiConfig({ ...aiConfig, providerChain: next });
  }

  function removeProviderChainItem(index: number) {
    const next = providerChain.filter((_, itemIndex) => itemIndex !== index);
    const primary = next.find((item) => item.enabled) ?? next[0];
    setAiConfig({
      ...aiConfig,
      providerChain: next,
      provider: primary?.provider ?? aiConfig.provider,
      model: primary?.model ?? aiConfig.model,
    });
  }

  const load = useCallback(async () => {
    setCurrentTimeMs(Date.now());
    const [
      aiResponse,
      aiProvidersResponse,
      kbResponse,
      auditResponse,
      tracesResponse,
      metricsResponse,
      reviewsResponse,
      missedQuestionsResponse,
      knowledgeGapsResponse,
      securityResponse,
      widgetResponse,
      emailResponse,
      notificationResponse,
      toolsResponse,
      webhooksResponse,
      invitationsResponse,
      meResponse,
    ] =
      await Promise.all([
        fetch("/api/admin/ai-config"),
        fetch("/api/admin/ai-providers"),
        fetch("/api/admin/knowledge-bases"),
        fetch("/api/admin/audit-logs"),
        fetch("/api/admin/ai-traces?limit=10"),
        fetch(`/api/admin/metrics${metricsQuery()}`),
        fetch("/api/admin/reviews"),
        fetch("/api/admin/missed-questions?limit=8"),
        fetch("/api/admin/knowledge-gaps?limit=8"),
        fetch("/api/admin/security-settings"),
        fetch("/api/admin/widget-config"),
        fetch("/api/admin/email-config"),
        fetch("/api/admin/notification-config"),
        fetch("/api/admin/tools"),
        fetch("/api/admin/webhooks"),
        fetch("/api/admin/invitations"),
        fetch("/api/auth/me"),
      ]);
    const usersResponse = await fetch("/api/admin/users");
    if (aiResponse.status === 401 || kbResponse.status === 401) {
      setError("Please sign in as an admin first.");
      return;
    }
    if (!aiResponse.ok || !kbResponse.ok) {
      setError("Admin role is required to manage settings.");
      return;
    }
    const aiJson = (await aiResponse.json()) as SettingsPayload;
    const kbJson = (await kbResponse.json()) as KnowledgePayload;
    setAiConfig(aiJson.aiConfig);
    if (aiProvidersResponse.ok) {
      const providersJson = (await aiProvidersResponse.json()) as { providers: AIProviderOption[] };
      setAIProviders(providersJson.providers);
    }
    setKnowledgeBases(kbJson.knowledgeBases);
    setKnowledgeSources(kbJson.sources ?? []);
    setDocuments(kbJson.documents);
    setKnowledgeEmbeddings(kbJson.embeddings ?? []);
    setSelectedKbId((current) => current || kbJson.knowledgeBases[0]?.id || "");
    if (auditResponse.ok) {
      const auditJson = (await auditResponse.json()) as { auditLogs: AuditLog[] };
      setAuditLogs(auditJson.auditLogs);
    }
    if (tracesResponse.ok) {
      const tracesJson = (await tracesResponse.json()) as { traces: AITrace[] };
      setAITraces(tracesJson.traces);
    }
    if (usersResponse.ok) {
      const usersJson = (await usersResponse.json()) as { users: AdminUser[] };
      setUsers(usersJson.users);
    }
    if (metricsResponse.ok) {
      const metricsJson = (await metricsResponse.json()) as { metrics: AnalyticsMetrics };
      setMetrics(metricsJson.metrics);
    }
    if (reviewsResponse.ok) {
      const reviewsJson = (await reviewsResponse.json()) as ReviewsPayload;
      setReviews(reviewsJson.reviews);
    }
    if (missedQuestionsResponse.ok) {
      const missedJson = (await missedQuestionsResponse.json()) as MissedQuestionsPayload;
      setMissedQuestions(missedJson.missedQuestions);
    }
    if (knowledgeGapsResponse.ok) {
      const gapsJson = (await knowledgeGapsResponse.json()) as KnowledgeGapsPayload;
      setKnowledgeGaps(gapsJson.knowledgeGaps);
    }
    if (securityResponse.ok) {
      const securityJson = (await securityResponse.json()) as { securitySettings: SecuritySettings };
      setSecuritySettings(securityJson.securitySettings);
    }
    if (widgetResponse.ok) {
      const widgetJson = (await widgetResponse.json()) as WidgetSettingsPayload;
      setWidgetConfig(widgetJson.widgetConfig);
    }
    if (emailResponse.ok) {
      const emailJson = (await emailResponse.json()) as EmailSettingsPayload;
      setEmailConfig(emailJson.emailConfig);
    }
    if (notificationResponse.ok) {
      const notificationJson = (await notificationResponse.json()) as NotificationSettingsPayload;
      setNotificationConfig(notificationJson.notificationConfig);
    }
    if (toolsResponse.ok) {
      const toolsJson = (await toolsResponse.json()) as ToolsPayload;
      setTools(toolsJson.tools);
      const firstTool = toolsJson.tools[0];
      if (firstTool) {
        setToolName((current) => current || firstTool.name);
        setToolDescription(firstTool.description);
        setToolInputSchema(JSON.stringify(firstTool.inputSchema ?? {}, null, 2));
        setToolAuthConfig(JSON.stringify(firstTool.authConfig ?? {}, null, 2));
        setToolTimeoutMs(firstTool.timeoutMs);
        setToolEnabled(firstTool.enabled);
        setToolPermissionScope(firstTool.permissionScope);
      }
    }
    if (webhooksResponse.ok) {
      const webhooksJson = (await webhooksResponse.json()) as WebhooksPayload;
      setWebhookEndpoints(webhooksJson.endpoints);
      setWebhookDeliveries(webhooksJson.deliveries);
    }
    if (invitationsResponse.ok) {
      const invitationsJson = (await invitationsResponse.json()) as { invitations: AdminInvitation[] };
      setInvitations(invitationsJson.invitations);
    }
    if (meResponse.ok) {
      const meJson = (await meResponse.json()) as { user?: Pick<User, "id" | "username" | "role" | "locale"> };
      setCurrentUser(meJson.user ?? null);
    }
  }, [metricsQuery]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function saveAIConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/ai-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aiConfig),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save AI configuration.");
      return;
    }
    setAiConfig(json.aiConfig);
    setSaved("AI configuration saved.");
  }

  async function updateLocale(locale: User["locale"]) {
    const response = await fetch("/api/auth/me/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const json = await response.json();
    if (response.ok && json.user) setCurrentUser(json.user);
  }

  async function saveSecuritySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/security-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(securitySettings),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save security settings.");
      return;
    }
    setSecuritySettings(json.securitySettings);
    setSaved("Security settings saved.");
  }

  async function saveWidgetConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/widget-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(widgetConfig),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save widget configuration.");
      return;
    }
    setWidgetConfig(json.widgetConfig);
    setSaved("Widget configuration saved.");
  }

  async function saveEmailConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/email-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailConfig),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save email configuration.");
      return;
    }
    setEmailConfig(json.emailConfig);
    setSaved("Email configuration saved.");
  }

  async function testEmailConfig() {
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/email-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testEmailRecipient }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Failed to send test email.");
      return;
    }
    setSaved(settingsLocale === "zh" ? "测试邮件已发送。" : "Test email sent.");
  }

  async function saveNotificationConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    setNotificationActionMessage("");
    setNotificationActionError("");
    setNotificationBusy("save");
    try {
      const response = await fetch("/api/admin/notification-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationConfig),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = json.error ?? "Failed to save notification configuration.";
        setError(message);
        setNotificationActionError(message);
        return;
      }
      setNotificationConfig(json.notificationConfig);
      const message = settingsLocale === "zh" ? "\u63d0\u9192\u8bbe\u7f6e\u5df2\u4fdd\u5b58\u3002" : "Notification configuration saved.";
      setSaved(message);
      setNotificationActionMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save notification configuration.";
      setError(message);
      setNotificationActionError(message);
    } finally {
      setNotificationBusy("");
    }
  }

  async function testNotificationConfig() {
    setError("");
    setSaved("");
    setNotificationActionMessage("");
    setNotificationActionError("");
    setNotificationBusy("test");
    try {
      const response = await fetch("/api/admin/notification-config/test", { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = json.error ?? "Failed to send test notification.";
        setError(message);
        setNotificationActionError(message);
        return;
      }
      const channels = Array.isArray(json.channels) ? json.channels.join(", ") : "";
      const message =
        settingsLocale === "zh"
          ? `\u6d4b\u8bd5\u63d0\u9192\u5df2\u53d1\u9001${channels ? `\uff1a${channels}` : ""}\u3002`
          : `Test notification sent${channels ? `: ${channels}` : ""}.`;
      setSaved(message);
      setNotificationActionMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send test notification.";
      setError(message);
      setNotificationActionError(message);
    } finally {
      setNotificationBusy("");
    }
  }

  async function processNotificationsNow() {
    setError("");
    setSaved("");
    setNotificationActionMessage("");
    setNotificationActionError("");
    setNotificationBusy("process");
    try {
      const response = await fetch("/api/admin/notifications/process", { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = json.error ?? "Failed to process notifications.";
        setError(message);
        setNotificationActionError(message);
        return;
      }
      const message =
        settingsLocale === "zh"
          ? "\u5df2\u6267\u884c\u672a\u56de\u590d\u63d0\u9192\u68c0\u67e5\u3002"
          : "Notification reminders processed.";
      setSaved(message);
      setNotificationActionMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process notifications.";
      setError(message);
      setNotificationActionError(message);
    } finally {
      setNotificationBusy("");
    }
  }

  function loadToolDraft(tool: AdminTool) {
    setToolName(tool.name);
    setToolDescription(tool.description);
    setToolInputSchema(JSON.stringify(tool.inputSchema ?? {}, null, 2));
    setToolAuthConfig(JSON.stringify(tool.authConfig ?? {}, null, 2));
    setToolTimeoutMs(tool.timeoutMs);
    setToolEnabled(tool.enabled);
    setToolPermissionScope(tool.permissionScope);
  }

  async function saveToolDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: toolName,
        description: toolDescription,
        inputSchema: parseJsonObject(toolInputSchema, {}),
        authConfig: parseJsonObject(toolAuthConfig, {}),
        timeoutMs: toolTimeoutMs,
        enabled: toolEnabled,
        permissionScope: toolPermissionScope,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save tool definition.");
      return;
    }
    setSaved("Tool definition saved.");
    const toolsResponse = await fetch("/api/admin/tools");
    if (toolsResponse.ok) {
      const toolsJson = (await toolsResponse.json()) as ToolsPayload;
      setTools(toolsJson.tools);
    }
  }

  function toggleWebhookEvent(eventName: WebhookEvent) {
    setWebhookSelectedEvents((current) =>
      current.includes(eventName) ? current.filter((item) => item !== eventName) : [...current, eventName],
    );
  }

  async function createWebhookEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: webhookName,
        url: webhookUrl,
        secret: webhookSecret || undefined,
        events: webhookSelectedEvents,
        retryMaxAttempts: webhookRetryMaxAttempts,
        retryBackoffSeconds: webhookRetryBackoffSeconds,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to create webhook endpoint.");
      return;
    }
    setWebhookName("");
    setWebhookUrl("");
    setWebhookSecret("");
    setWebhookSelectedEvents(["message.created"]);
    setSaved("Webhook endpoint created.");
    await load();
  }

  async function replayWebhookDelivery(delivery: WebhookDelivery) {
    setError("");
    setSaved("");
    const response = await fetch(`/api/admin/webhooks/deliveries/${delivery.id}/replay`, { method: "POST" });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Webhook replay failed.");
      return;
    }
    setSaved("Webhook delivery replayed.");
    await load();
  }

  async function deleteAuditLog(log: AuditLog) {
    if (!window.confirm(copy.confirmDeleteAuditLog)) return;
    setError("");
    setSaved("");
    const response = await fetch(`/api/admin/audit-logs/${log.id}`, { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Failed to delete audit log.");
      return;
    }
    setAuditLogs((current) => current.filter((item) => item.id !== log.id));
    setSaved(settingsLocale === "zh" ? "审计日志已删除。" : "Audit log deleted.");
  }

  async function clearAuditLogs() {
    if (!window.confirm(copy.confirmClearAuditLogs)) return;
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/audit-logs", { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Failed to clear audit logs.");
      return;
    }
    setAuditLogs([]);
    setSaved(settingsLocale === "zh" ? "审计日志已清空。" : "Audit logs cleared.");
  }

  async function testAI(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAITestResult(undefined);
    const response = await fetch("/api/admin/ai-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: testMessage }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "AI test failed.");
      return;
    }
    setAITestResult(json as AITestResult);
    if (response.ok) await load();
  }

  async function createKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/knowledge-bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKbName, description: newKbDescription }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to create knowledge base.");
      return;
    }
    setNewKbName("");
    setNewKbDescription("");
    await load();
    setSelectedKbId(json.knowledgeBase.id);
  }

  async function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbId) return;
    const isUpload = documentSourceType === "pdf" || documentSourceType === "docx";
    const body = isUpload
      ? (() => {
          const form = new FormData();
          form.set("title", documentTitle);
          form.set("sourceType", documentSourceType);
          if (documentFile) form.set("file", documentFile);
          return form;
        })()
      : JSON.stringify({
          title: documentTitle,
          content: documentSourceType === "url" ? undefined : documentContent,
          sourceType: documentSourceType,
          sourceUri: documentSourceType === "url" ? documentSourceUri : undefined,
        });
    const response = await fetch(`/api/admin/knowledge-bases/${selectedKbId}/documents`, {
      method: "POST",
      headers: isUpload ? undefined : { "Content-Type": "application/json" },
      body,
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to add document.");
      return;
    }
    setDocumentTitle("");
    setDocumentContent("");
    setDocumentSourceUri("");
    setDocumentFile(null);
    await load();
  }

  async function searchKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbId) return;
    const response = await fetch(`/api/admin/knowledge-bases/${selectedKbId}/search-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: searchQuery,
        topK: searchTopK,
        sourceTypes: searchSourceType ? [searchSourceType] : undefined,
        keywordWeight: searchKeywordWeight,
        vectorWeight: searchVectorWeight,
        minScore: searchMinScore,
      }),
    });
    const json = await response.json();
    setSearchResults(response.ok ? json.results : []);
    if (!response.ok) setError(json.error ?? "Search failed.");
  }

  async function reindexKnowledgeBase() {
    if (!selectedKbId) return;
    setError("");
    setSaved("");
    const response = await fetch(`/api/admin/knowledge-bases/${selectedKbId}/reindex`, { method: "POST" });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to reindex knowledge base.");
      return;
    }
    setSaved("Knowledge base reindexed.");
    await load();
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsername,
        password: newUserPassword,
        role: newUserRole,
        forcePasswordChange: newUserForcePasswordChange,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to create user.");
      return;
    }
    setNewUsername("");
    setNewUserPassword("");
    setNewUserRole("agent");
    setNewUserForcePasswordChange(true);
    await load();
  }

  async function updateUser(
    user: AdminUser,
    input: Partial<Pick<AdminUser, "role" | "disabled" | "forcePasswordChange">> & {
      password?: string;
      unlock?: boolean;
    },
  ) {
    setError("");
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to update user.");
      return;
    }
    await load();
  }

  async function resetUserPassword(user: AdminUser) {
    const password = resetPasswords[user.id]?.trim() ?? "";
    if (password.length < 6) {
      setError("password must be at least 6 characters");
      return;
    }
    await updateUser(user, { password, forcePasswordChange: true });
    setResetPasswords((current) => ({ ...current, [user.id]: "" }));
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    setLatestInviteUrl("");
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: inviteUsername,
        role: inviteRole,
        expiresInDays: inviteExpiresInDays,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to create invitation.");
      return;
    }
    setInviteUsername("");
    setInviteRole("agent");
    setInviteExpiresInDays(7);
    setLatestInviteUrl(json.acceptUrl);
    setSaved("Invitation created.");
    await load();
  }

  async function revokeInvitation(invitation: AdminInvitation) {
    setError("");
    const response = await fetch(`/api/admin/invitations/${invitation.id}/revoke`, { method: "POST" });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to revoke invitation.");
      return;
    }
    await load();
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#1d2433]">
      <header className="flex items-center justify-between border-b border-[#d9e1ee] bg-white px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">
            {text.adminSettings}
          </h1>
          <p className="text-sm text-[#64748b]">
            {text.adminSubtitle}
          </p>
        </div>
        <div className="flex gap-2">
          {currentUser ? (
            <select
              className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm"
              value={currentUser.locale}
              onChange={(event) => void updateLocale(event.target.value as User["locale"])}
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          ) : null}
          <a className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium" href="/agent">
            {text.agentConsole}
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 pt-5">
        <div className="overflow-x-auto border border-[#d9e1ee] bg-white p-2">
          <div className="flex min-w-max gap-1">
            {localizedTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`rounded-md px-4 py-2 text-left text-sm transition ${
                  activeTab === tab.id
                    ? "bg-[#1f2a44] text-white"
                    : "text-[#475569] hover:bg-[#eef2f7] hover:text-[#111827]"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="block font-semibold">{tab.label}</span>
                <span className={`block text-xs ${activeTab === tab.id ? "text-[#dbe4f0]" : "text-[#64748b]"}`}>
                  {tab.description}
                </span>
              </button>
            ))}
          </div>
        </div>
        {saved || error ? (
          <div className="mt-3 grid gap-2">
            {saved ? <p className="border border-[#b7d7c8] bg-[#f0faf5] p-3 text-sm text-[#24543f]">{saved}</p> : null}
            {error ? <p className="border border-[#f1b8b8] bg-[#fff5f5] p-3 text-sm text-[#b42318]">{error}</p> : null}
          </div>
        ) : null}
      </div>

      <div
        className={`mx-auto grid max-w-7xl gap-5 p-5 ${
          activeTab === "ai" || activeTab === "knowledge" ? "lg:grid-cols-[minmax(0,1fr)_420px]" : "lg:grid-cols-1"
        }`}
      >
        <section className={`${activeTab === "operations" || activeTab === "security" ? "hidden" : "space-y-5"}`}>
          <form
            onSubmit={saveAIConfig}
            className={`${activeTab === "ai" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}
          >
            <h2 className="text-lg font-semibold">{copy.aiConfiguration}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                {copy.provider}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.provider}
                  onChange={(event) => {
                    const provider = providerOptions.find((item) => item.name === event.target.value);
                    const nextChain = providerChain.map((item, index) =>
                      index === 0
                        ? {
                            ...item,
                            provider: event.target.value,
                            label: provider?.label ?? event.target.value,
                            model: provider?.defaults.chatModel ?? aiConfig.model,
                            models: [provider?.defaults.chatModel ?? aiConfig.model],
                            baseUrl: provider?.defaultBaseUrl,
                            apiKeyEnv: provider?.defaultApiKeyEnv,
                          }
                        : item,
                    );
                    setAiConfig({
                      ...aiConfig,
                      provider: event.target.value as AIConfiguration["provider"],
                      model: provider?.defaults.chatModel ?? aiConfig.model,
                      providerChain: nextChain,
                    });
                  }}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.name} value={provider.name}>
                      {provider.label ?? provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                {copy.model}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.model}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      model: event.target.value,
                      providerChain: providerChain.map((item, index) =>
                        index === 0
                          ? {
                              ...item,
                              model: event.target.value,
                              models: [...new Set([event.target.value, ...(item.models ?? [])])],
                            }
                          : item,
                      ),
                    })
                  }
                >
                  {(chatProvider?.chatModels.length ? chatProvider.chatModels : [aiConfig.model]).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                {copy.temperature}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={aiConfig.temperature}
                  onChange={(event) => setAiConfig({ ...aiConfig, temperature: Number(event.target.value) })}
                />
              </label>
              <label className="text-sm font-medium">
                {copy.contextMessages}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  type="number"
                  min="1"
                  max="50"
                  value={aiConfig.maxContextMessages}
                  onChange={(event) => setAiConfig({ ...aiConfig, maxContextMessages: Number(event.target.value) })}
                />
              </label>
            </div>
            <div className="mt-5 border border-[#d9e1ee] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{copy.providerFallbackChain}</h3>
                  <p className="text-xs text-[#64748b]">
                    {copy.providerFallbackHelp}
                  </p>
                </div>
                <button
                  className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium"
                  type="button"
                  onClick={addProviderChainItem}
                >
                  {copy.addProvider}
                </button>
              </div>
              <label className="mt-3 block text-sm font-medium">
                {copy.fallbackStrategy}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.providerFallbackStrategy}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      providerFallbackStrategy: event.target.value as AIConfiguration["providerFallbackStrategy"],
                    })
                  }
                >
                  <option value="priority">{settingsLocale === "zh" ? "按优先级" : "priority order"}</option>
                  <option value="round_robin">
                    {settingsLocale === "zh" ? "轮询起始，然后 fallback" : "round robin start, then fallback"}
                  </option>
                </select>
              </label>
              <div className="mt-3 space-y-3">
                {providerChain.map((item, index) => {
                  const option = providerOptions.find((provider) => provider.name === item.provider);
                  const modelOptions = option?.chatModels ?? [];
                  return (
                    <div key={item.id} className="grid gap-3 border border-[#e1e7f0] p-3 md:grid-cols-[80px_140px_minmax(0,1fr)_minmax(0,1fr)]">
                      <label className="text-xs font-medium">
                        {copy.enabled}
                        <input
                          className="mt-3 block"
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => updateProviderChain(index, { enabled: event.target.checked })}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        {copy.priority}
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          type="number"
                          min="1"
                          value={item.priority}
                          onChange={(event) => updateProviderChain(index, { priority: Number(event.target.value) })}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        {copy.provider}
                        <select
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          value={item.provider}
                          onChange={(event) => {
                            const selected = providerOptions.find((provider) => provider.name === event.target.value);
                            updateProviderChain(index, {
                              provider: event.target.value,
                              label: selected?.label ?? event.target.value,
                              model: selected?.defaults.chatModel ?? item.model,
                              models: [selected?.defaults.chatModel ?? item.model],
                              baseUrl: selected?.defaultBaseUrl,
                              apiKeyEnv: selected?.defaultApiKeyEnv,
                            });
                          }}
                        >
                          {providerOptions.map((provider) => (
                            <option key={provider.name} value={provider.name}>
                              {provider.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-medium">
                        {copy.displayName}
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          value={item.label ?? item.provider}
                          onChange={(event) => updateProviderChain(index, { label: event.target.value })}
                          placeholder={option?.label ?? item.provider}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        {copy.model}
                        {modelOptions.length ? (
                          <select
                            className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                            value={item.model}
                            onChange={(event) =>
                              updateProviderChain(index, {
                                model: event.target.value,
                                models: [...new Set([event.target.value, ...(item.models ?? [])])],
                              })
                            }
                          >
                            {[...new Set([...modelOptions, item.model])].map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                            value={item.model}
                            onChange={(event) =>
                              updateProviderChain(index, {
                                model: event.target.value,
                                models: [...new Set([event.target.value, ...(item.models ?? [])])],
                              })
                            }
                          />
                        )}
                      </label>
                      <label className="text-xs font-medium md:col-span-2">
                        {copy.modelsFallbackOrder}
                        <textarea
                          className="mt-1 min-h-20 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          value={(item.models?.length ? item.models : [item.model]).join("\n")}
                          onChange={(event) => {
                            const models = linesToArray(event.target.value);
                            updateProviderChain(index, {
                              model: models[0] ?? item.model,
                              models: models.length ? models : [item.model],
                            });
                          }}
                        />
                      </label>
                      <label className="text-xs font-medium md:col-span-2">
                        {copy.baseUrl}
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          placeholder={option?.defaultBaseUrl ?? "https://provider.example.com/v1"}
                          value={item.baseUrl ?? ""}
                          onChange={(event) => updateProviderChain(index, { baseUrl: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        {copy.apiKeyEnv}
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          placeholder={option?.defaultApiKeyEnv ?? "CUSTOM_AI_API_KEY"}
                          value={item.apiKeyEnv ?? ""}
                          onChange={(event) => updateProviderChain(index, { apiKeyEnv: event.target.value })}
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          className="rounded-md border border-[#d17a7a] px-3 py-2 text-sm font-medium text-[#9f1d1d]"
                          type="button"
                          onClick={() => removeProviderChainItem(index)}
                          disabled={providerChain.length <= 1}
                        >
                          {copy.remove}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <label className="mt-4 block text-sm font-medium">
              {copy.systemPrompt}
              <textarea
                className="mt-1 min-h-28 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.systemPrompt}
                onChange={(event) => setAiConfig({ ...aiConfig, systemPrompt: event.target.value })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              {copy.fallbackMessage}
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.fallbackMessage}
                onChange={(event) => setAiConfig({ ...aiConfig, fallbackMessage: event.target.value })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              {copy.noAnswerStrategy}
              <select
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.noAnswerStrategy}
                onChange={(event) =>
                  setAiConfig({
                    ...aiConfig,
                    noAnswerStrategy: event.target.value as AIConfiguration["noAnswerStrategy"],
                  })
                }
              >
                <option value="continue">{settingsLocale === "zh" ? "继续回答并提示不确定" : "continue with caveat"}</option>
                <option value="fallback">{settingsLocale === "zh" ? "返回 fallback 消息" : "return fallback message"}</option>
                <option value="handoff">{settingsLocale === "zh" ? "进入人工队列" : "queue for human"}</option>
                <option value="transfer">{settingsLocale === "zh" ? "立即转人工" : "transfer immediately"}</option>
              </select>
            </label>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.enableKnowledgeBase}
                  onChange={(event) => setAiConfig({ ...aiConfig, enableKnowledgeBase: event.target.checked })}
                />
                {copy.enableKnowledgeBase}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.enableTools}
                  onChange={(event) => setAiConfig({ ...aiConfig, enableTools: event.target.checked })}
                />
                {copy.enableTools}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.autoHandoff.enabled}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: { ...aiConfig.autoHandoff, enabled: event.target.checked },
                    })
                  }
                />
                {copy.enableAutoHandoff}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.translationEnabled}
                  onChange={(event) => setAiConfig({ ...aiConfig, translationEnabled: event.target.checked })}
                />
                {copy.enableAutoTranslation}
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="text-sm font-medium">
                {copy.translationProvider}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.translationProvider}
                  onChange={(event) => {
                    const provider = providerOptions.find((item) => item.name === event.target.value);
                    setAiConfig({
                      ...aiConfig,
                      translationProvider: event.target.value as AIConfiguration["translationProvider"],
                      translationModel: provider?.defaults.translationModel ?? aiConfig.translationModel,
                    });
                  }}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.name} value={provider.name}>
                      {provider.label ?? provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                {copy.translationModel}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.translationModel}
                  onChange={(event) => setAiConfig({ ...aiConfig, translationModel: event.target.value })}
                >
                  {(translationProvider?.translationModels.length
                    ? translationProvider.translationModels
                    : [aiConfig.translationModel]
                  ).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                {copy.agentLanguage}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.agentLanguage}
                  onChange={(event) =>
                    setAiConfig({ ...aiConfig, agentLanguage: event.target.value as AIConfiguration["agentLanguage"] })
                  }
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                {copy.handoffRequestPatterns}
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.autoHandoff.userRequestPatterns.join("\n")}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: { ...aiConfig.autoHandoff, userRequestPatterns: linesToArray(event.target.value) },
                    })
                  }
                />
              </label>
              <label className="text-sm font-medium">
                {copy.sensitiveKeywords}
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.autoHandoff.sensitiveKeywords.join("\n")}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: { ...aiConfig.autoHandoff, sensitiveKeywords: linesToArray(event.target.value) },
                    })
                  }
                />
              </label>
              <label className="text-sm font-medium">
                {copy.aiFailureThreshold}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  min="0"
                  type="number"
                  value={aiConfig.autoHandoff.aiFailureThreshold}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: {
                        ...aiConfig.autoHandoff,
                        aiFailureThreshold: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="text-sm font-medium">
                {copy.lowConfidenceKbThreshold}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  min="0"
                  max="1"
                  step="0.05"
                  type="number"
                  value={aiConfig.autoHandoff.lowConfidenceKnowledgeScoreThreshold}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: {
                        ...aiConfig.autoHandoff,
                        lowConfidenceKnowledgeScoreThreshold: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.saveAiConfig}
              </button>
              {saved ? <span className="text-sm text-[#2e6f57]">{saved}</span> : null}
            </div>
          </form>

          <section className={`${activeTab === "knowledge" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.knowledgeBase}</h2>
            <form onSubmit={createKnowledgeBase} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder={copy.knowledgeBaseName}
                value={newKbName}
                onChange={(event) => setNewKbName(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder={copy.description}
                value={newKbDescription}
                onChange={(event) => setNewKbDescription(event.target.value)}
              />
              <button className="rounded-md bg-[#2e6f57] px-4 py-2 text-sm font-semibold text-white">{copy.create}</button>
            </form>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <form onSubmit={addDocument} className="space-y-3">
                <select
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={selectedKbId}
                  onChange={(event) => setSelectedKbId(event.target.value)}
                >
                  <option value="">Select knowledge base</option>
                  {knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name}
                    </option>
                  ))}
                </select>
                <input
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  placeholder="Document title"
                  value={documentTitle}
                  onChange={(event) => setDocumentTitle(event.target.value)}
                />
                <select
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={documentSourceType}
                  onChange={(event) => setDocumentSourceType(event.target.value as KnowledgeDocument["sourceType"])}
                >
                  <option value="manual">Manual FAQ</option>
                  <option value="text">Plain text</option>
                  <option value="markdown">Markdown</option>
                  <option value="url">URL crawl</option>
                  <option value="pdf">PDF upload</option>
                  <option value="docx">Docx upload</option>
                </select>
                {documentSourceType === "url" ? (
                  <input
                    className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    placeholder="https://example.com/help/refunds"
                    value={documentSourceUri}
                    onChange={(event) => setDocumentSourceUri(event.target.value)}
                  />
                ) : documentSourceType === "pdf" || documentSourceType === "docx" ? (
                  <input
                    accept={documentSourceType === "pdf" ? "application/pdf,.pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"}
                    className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    type="file"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                  />
                ) : (
                  <textarea
                    className="min-h-40 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    placeholder="Paste FAQ, Markdown, or plain text"
                    value={documentContent}
                    onChange={(event) => setDocumentContent(event.target.value)}
                  />
                )}
                <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Add document</button>
              </form>
              <form onSubmit={searchKnowledge} className="space-y-3">
                <input
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  placeholder="Search test query"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    min="1"
                    max="25"
                    type="number"
                    value={searchTopK}
                    onChange={(event) => setSearchTopK(Number(event.target.value))}
                  />
                  <select
                    className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    value={searchSourceType}
                    onChange={(event) => setSearchSourceType(event.target.value as "" | KnowledgeSource["type"])}
                  >
                    <option value="">All sources</option>
                    <option value="manual">Manual</option>
                    <option value="text">Text</option>
                    <option value="markdown">Markdown</option>
                    <option value="url">URL</option>
                    <option value="external">External</option>
                  </select>
                  <input
                    className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    max="1"
                    min="0"
                    step="0.05"
                    type="number"
                    value={searchKeywordWeight}
                    onChange={(event) => setSearchKeywordWeight(Number(event.target.value))}
                  />
                  <input
                    className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    max="1"
                    min="0"
                    step="0.05"
                    type="number"
                    value={searchVectorWeight}
                    onChange={(event) => setSearchVectorWeight(Number(event.target.value))}
                  />
                  <input
                    className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                    max="1"
                    min="0"
                    step="0.01"
                    type="number"
                    value={searchMinScore}
                    onChange={(event) => setSearchMinScore(Number(event.target.value))}
                  />
                </div>
                <button className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold">
                  Search knowledge
                </button>
                <button
                  className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold"
                  disabled={!selectedKbId}
                  type="button"
                  onClick={() => void reindexKnowledgeBase()}
                >
                  Reindex
                </button>
                <div className="space-y-2">
                  {searchResults.map((result) => (
                      <div key={result.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3 text-sm">
                        <div className="font-semibold">{result.documentTitle}</div>
                        <div className="text-xs text-[#64748b]">
                          score {result.score.toFixed(2)}
                          {result.sourceName ? ` | ${result.sourceType ?? "source"}: ${result.sourceName}` : ""}
                        </div>
                        <p className="mt-2 max-h-24 overflow-hidden">{result.content}</p>
                      </div>
                  ))}
                </div>
              </form>
            </div>
            {selectedKbId ? (
              <div className="mt-5 space-y-2 text-sm">
                {documents
                  .filter((document) => document.knowledgeBaseId === selectedKbId)
                  .map((document) => {
                    const source = document.sourceId
                      ? knowledgeSources.find((item) => item.id === document.sourceId)
                      : undefined;
                    return (
                      <div key={document.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{document.title}</div>
                            <div className="mt-1 text-xs text-[#64748b]">
                              {source ? `${source.type}: ${source.name}` : document.sourceType}
                              {document.indexedAt ? ` | indexed ${new Date(document.indexedAt).toLocaleString()}` : ""}
                            </div>
                            {document.lastIndexError ? (
                              <div className="mt-1 text-xs text-[#b42318]">{document.lastIndexError}</div>
                            ) : null}
                          </div>
                          <span className="rounded-md bg-[#edf2f7] px-2 py-1 text-xs text-[#51607a]">
                            {document.indexingStatus}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : null}
          </section>
        </section>

        <aside className="space-y-5">
          {metrics ? (
            <section className={`${activeTab === "operations" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
              <h2 className="text-lg font-semibold">{copy.operations}</h2>
              <div className="mt-3 grid gap-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    {copy.from}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-1"
                      type="date"
                      value={metricDateFrom}
                      onChange={(event) => setMetricDateFrom(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    {copy.to}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-1"
                      type="date"
                      value={metricDateTo}
                      onChange={(event) => setMetricDateTo(event.target.value)}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="rounded-md border border-[#bbc7d8] px-2 py-1"
                    value={metricStatus}
                    onChange={(event) => setMetricStatus(event.target.value as "" | ConversationStatus)}
                  >
                    <option value="">{copy.allStatuses}</option>
                    <option value="ai_active">AI active</option>
                    <option value="queued_for_human">Queued</option>
                    <option value="human_active">Human active</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                  <select
                    className="rounded-md border border-[#bbc7d8] px-2 py-1"
                    value={metricAgentId}
                    onChange={(event) => setMetricAgentId(event.target.value)}
                  >
                    <option value="">{copy.allAgents}</option>
                    {users
                      .filter((user) => user.role === "admin" || user.role === "agent")
                      .map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.username}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="rounded-md border border-[#bbc7d8] px-2 py-1"
                    placeholder="channel"
                    value={metricChannel}
                    onChange={(event) => setMetricChannel(event.target.value)}
                  />
                  <input
                    className="rounded-md border border-[#bbc7d8] px-2 py-1"
                    placeholder="tag"
                    value={metricTag}
                    onChange={(event) => setMetricTag(event.target.value)}
                  />
                </div>
                <select
                  className="rounded-md border border-[#bbc7d8] px-2 py-1"
                  value={metricKnowledgeBaseId}
                  onChange={(event) => setMetricKnowledgeBaseId(event.target.value)}
                >
                  <option value="">All knowledge bases</option>
                  {knowledgeBases.map((base) => (
                    <option key={base.id} value={base.id}>
                      {base.name}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-md bg-[#1f2a44] px-3 py-2 text-white"
                  type="button"
                  onClick={() => void load()}
                >
                  {copy.applyFilters}
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.conversations}</div>
                  <div className="text-xl font-semibold">{metrics.totalConversations}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{settingsLocale === "zh" ? "打开中" : "Open"}</div>
                  <div className="text-xl font-semibold">{metrics.openConversations}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.handoff}</div>
                  <div className="text-xl font-semibold">{formatPercent(metrics.humanHandoffRate)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.kbHit}</div>
                  <div className="text-xl font-semibold">{formatPercent(metrics.knowledgeHitRate)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.aiResolution}</div>
                  <div className="text-xl font-semibold">{formatPercent(metrics.aiResolutionRate)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.firstResponse}</div>
                  <div className="text-xl font-semibold">{formatDuration(metrics.averageFirstResponseSeconds)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.resolution}</div>
                  <div className="text-xl font-semibold">{formatDuration(metrics.averageResolutionSeconds)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">{copy.satisfaction}</div>
                  <div className="text-xl font-semibold">{formatScore(metrics.averageSatisfactionScore)}</div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-[#334155]">
                <div>
                  AI {metrics.aiMessages} · Human {metrics.humanMessages} · Visitor {metrics.visitorMessages}
                </div>
                <div>
                  Resolved {metrics.resolvedConversations} · Closed {metrics.closedConversations} · Ratings{" "}
                  {metrics.satisfactionResponses}
                </div>
                <div>
                  Channels:{" "}
                  {Object.entries(metrics.byChannel)
                    .map(([channel, count]) => `${channel} ${count}`)
                    .join(", ") || "-"}
                </div>
              </div>
              {reviews ? (
                <div className="mt-5 grid gap-4 text-sm">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-semibold">{settingsLocale === "zh" ? "低评分复盘" : "Low rating review"}</h3>
                      <span className="text-xs text-[#64748b]">≤ {reviews.lowRatingThreshold}/5</span>
                    </div>
                    <div className="grid gap-2">
                      {reviews.lowRating.length ? (
                        reviews.lowRating.map((item) => (
                          <div key={item.id} className="border border-[#e1e7f0] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">{item.subject || item.id}</span>
                              <span className="text-xs text-[#9f2d20]">{item.rating}/5</span>
                            </div>
                            <div className="mt-1 text-xs text-[#64748b]">
                              {item.channel} · {item.status} · AI {item.aiMessages} · Human {item.humanMessages}
                            </div>
                            {item.satisfactionComment ? (
                              <div className="mt-2 text-xs text-[#334155]">{item.satisfactionComment}</div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="border border-dashed border-[#d9e1ee] p-3 text-xs text-[#64748b]">
                          No low-rating conversations.
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-semibold">{settingsLocale === "zh" ? "未解决复盘" : "Unresolved review"}</h3>
                      <span className="text-xs text-[#64748b]">{reviews.unresolved.length} open</span>
                    </div>
                    <div className="grid gap-2">
                      {reviews.unresolved.length ? (
                        reviews.unresolved.map((item) => (
                          <div key={item.id} className="border border-[#e1e7f0] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">{item.subject || item.id}</span>
                              <span className="text-xs text-[#64748b]">{formatDuration(item.waitingSeconds)}</span>
                            </div>
                            <div className="mt-1 text-xs text-[#64748b]">
                              {item.channel} · {item.status} · latest {item.latestMessageRole ?? "-"}
                            </div>
                            {item.lastVisitorMessage ? (
                              <div className="mt-2 text-xs text-[#334155]">{item.lastVisitorMessage}</div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="border border-dashed border-[#d9e1ee] p-3 text-xs text-[#64748b]">
                          No unresolved conversations.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {missedQuestions ? (
                <div className="mt-5 text-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">{settingsLocale === "zh" ? "未解决问题" : "Missed questions"}</h3>
                    <span className="text-xs text-[#64748b]">{missedQuestions.totalClusters} clusters</span>
                  </div>
                  <div className="grid gap-2">
                    {missedQuestions.clusters.length ? (
                      missedQuestions.clusters.map((cluster) => (
                        <div key={cluster.key} className="border border-[#e1e7f0] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{cluster.suggestedKnowledgeEntry.title}</span>
                            <span className="text-xs text-[#64748b]">{cluster.count} hits</span>
                          </div>
                          <div className="mt-1 text-xs text-[#64748b]">
                            Reasons:{" "}
                            {Object.entries(cluster.reasons)
                              .map(([reason, count]) => `${reason} ${count}`)
                              .join(", ")}
                          </div>
                          <div className="mt-2 text-xs text-[#334155]">
                            Suggestion: {cluster.suggestedKnowledgeEntry.answerDraft}
                          </div>
                          <div className="mt-2 text-xs text-[#64748b]">
                            Example: {cluster.examples[0]?.content ?? "-"}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="border border-dashed border-[#d9e1ee] p-3 text-xs text-[#64748b]">
                        No missed-question clusters.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
              {knowledgeGaps ? (
                <div className="mt-5 text-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">{settingsLocale === "zh" ? "知识缺口" : "Knowledge gaps"}</h3>
                    <span className="text-xs text-[#64748b]">
                      stale {knowledgeGaps.thresholds.staleDays}d · score &lt; {knowledgeGaps.thresholds.lowScoreThreshold}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {knowledgeGaps.frequentNoReliableHits.slice(0, 3).map((gap) => (
                      <div key={gap.key} className="border border-[#e1e7f0] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{gap.examples[0]?.content ?? gap.key}</span>
                          <span className="text-xs text-[#64748b]">{gap.count} misses</span>
                        </div>
                        <div className="mt-1 text-xs text-[#64748b]">
                          {Object.entries(gap.reasons)
                            .map(([reason, count]) => `${reason} ${count}`)
                            .join(", ")}
                        </div>
                        <div className="mt-2 text-xs text-[#334155]">{gap.suggestedAction}</div>
                      </div>
                    ))}
                    {knowledgeGaps.failedDocuments.slice(0, 3).map((document) => (
                      <div key={document.id} className="border border-[#e1e7f0] p-3">
                        <div className="font-medium">{document.title}</div>
                        <div className="mt-1 text-xs text-[#9f2d20]">
                          Index failed: {document.lastIndexError ?? "unknown error"}
                        </div>
                      </div>
                    ))}
                    {knowledgeGaps.lowPerformingChunks.slice(0, 3).map((chunk) => (
                      <div key={chunk.chunkId} className="border border-[#e1e7f0] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{chunk.documentTitle}</span>
                          <span className="text-xs text-[#64748b]">{chunk.reason}</span>
                        </div>
                        <div className="mt-1 text-xs text-[#64748b]">
                          hits {chunk.hitCount} · avg score {chunk.averageScore.toFixed(2)}
                        </div>
                      </div>
                    ))}
                    {knowledgeGaps.fallbackTrends.slice(0, 3).map((trend) => (
                      <div key={trend.reason} className="border border-[#e1e7f0] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{trend.reason}</span>
                          <span className="text-xs text-[#64748b]">{trend.count}</span>
                        </div>
                        <div className="mt-1 text-xs text-[#64748b]">{trend.examples[0] ?? "No example"}</div>
                      </div>
                    ))}
                    {!knowledgeGaps.frequentNoReliableHits.length &&
                    !knowledgeGaps.failedDocuments.length &&
                    !knowledgeGaps.lowPerformingChunks.length &&
                    !knowledgeGaps.fallbackTrends.length ? (
                      <div className="border border-dashed border-[#d9e1ee] p-3 text-xs text-[#64748b]">
                        No knowledge gaps detected.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <form
            onSubmit={saveWidgetConfig}
            className={`${activeTab === "channels" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}
          >
            <h2 className="text-lg font-semibold">{copy.widget}</h2>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="block">
                {copy.themeColor}
                <div className="mt-1 flex gap-2">
                  <input
                    className="h-10 w-12 rounded-md border border-[#bbc7d8] bg-white"
                    type="color"
                    value={widgetConfig.themeColor}
                    onChange={(event) => setWidgetConfig((current) => ({ ...current, themeColor: event.target.value }))}
                  />
                  <input
                    className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-3 py-2"
                    value={widgetConfig.themeColor}
                    onChange={(event) => setWidgetConfig((current) => ({ ...current, themeColor: event.target.value }))}
                  />
                </div>
              </label>
              <label className="block">
                {copy.welcomeMessage}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={widgetConfig.welcomeMessage}
                  onChange={(event) => setWidgetConfig((current) => ({ ...current, welcomeMessage: event.target.value }))}
                />
              </label>
              <label className="block">
                {copy.offlineMessage}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={widgetConfig.offlineMessage}
                  onChange={(event) => setWidgetConfig((current) => ({ ...current, offlineMessage: event.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={widgetConfig.enableSatisfaction}
                  onChange={(event) =>
                    setWidgetConfig((current) => ({ ...current, enableSatisfaction: event.target.checked }))
                  }
                />
                {copy.satisfactionRating}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={widgetConfig.enableTranscriptDownload}
                  onChange={(event) =>
                    setWidgetConfig((current) => ({ ...current, enableTranscriptDownload: event.target.checked }))
                  }
                />
                {copy.transcriptDownload}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={widgetConfig.requireEndConfirmation}
                  onChange={(event) =>
                    setWidgetConfig((current) => ({ ...current, requireEndConfirmation: event.target.checked }))
                  }
                />
                {copy.endChatConfirmation}
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.saveWidgetSettings}
              </button>
            </div>
          </form>

          <form
            onSubmit={saveEmailConfig}
            className={`${activeTab === "channels" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}
          >
            <h2 className="text-lg font-semibold">{copy.emailDelivery}</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              {copy.emailDeliveryHelp}
            </p>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={emailConfig.enabled}
                  onChange={(event) => setEmailConfig((current) => ({ ...current, enabled: event.target.checked }))}
                />
                {copy.enableEmailSending}
              </label>
              <label className="block">
                {copy.provider}
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={emailConfig.provider}
                  onChange={(event) =>
                    setEmailConfig((current) => ({
                      ...current,
                      provider: event.target.value === "resend" ? "resend" : "smtp",
                    }))
                  }
                >
                  <option value="smtp">SMTP</option>
                  <option value="resend">Resend</option>
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  {copy.fromEmail}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    value={emailConfig.fromEmail}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, fromEmail: event.target.value }))}
                    placeholder="support@example.com"
                  />
                </label>
                <label className="block">
                  {copy.fromName}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    value={emailConfig.fromName ?? ""}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, fromName: event.target.value }))}
                    placeholder="Support"
                  />
                </label>
              </div>
              <label className="block">
                {copy.replyToEmail}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={emailConfig.replyToEmail ?? ""}
                  onChange={(event) => setEmailConfig((current) => ({ ...current, replyToEmail: event.target.value }))}
                  placeholder="optional"
                />
              </label>
              {emailConfig.provider === "smtp" ? (
                <div className="grid gap-3 rounded-md border border-[#e1e7f0] bg-[#f8fafc] p-3 md:grid-cols-2">
                  <label className="block">
                    {copy.smtpHost}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={emailConfig.smtpHost ?? ""}
                      onChange={(event) => setEmailConfig((current) => ({ ...current, smtpHost: event.target.value }))}
                      placeholder="smtp.example.com"
                    />
                  </label>
                  <label className="block">
                    {copy.smtpPort}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      type="number"
                      min={1}
                      value={emailConfig.smtpPort}
                      onChange={(event) =>
                        setEmailConfig((current) => ({ ...current, smtpPort: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <label className="block">
                    {copy.smtpUsername}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={emailConfig.smtpUsername ?? ""}
                      onChange={(event) =>
                        setEmailConfig((current) => ({ ...current, smtpUsername: event.target.value }))
                      }
                      placeholder="optional"
                    />
                  </label>
                  <label className="block">
                    {copy.smtpPasswordEnv}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={emailConfig.smtpPasswordEnv ?? ""}
                      onChange={(event) =>
                        setEmailConfig((current) => ({ ...current, smtpPasswordEnv: event.target.value }))
                      }
                      placeholder="SMTP_PASSWORD"
                    />
                  </label>
                  <label className="flex items-center gap-2 md:col-span-2">
                    <input
                      type="checkbox"
                      checked={emailConfig.smtpSecure}
                      onChange={(event) =>
                        setEmailConfig((current) => ({ ...current, smtpSecure: event.target.checked }))
                      }
                    />
                    {copy.smtpTlsHelp}
                  </label>
                </div>
              ) : (
                <label className="block rounded-md border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  {copy.resendApiKeyEnv}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    value={emailConfig.resendApiKeyEnv ?? ""}
                    onChange={(event) =>
                      setEmailConfig((current) => ({ ...current, resendApiKeyEnv: event.target.value }))
                    }
                    placeholder="RESEND_API_KEY"
                  />
                </label>
              )}
              <div className="grid gap-3 rounded-md border border-[#e1e7f0] bg-[#f8fafc] p-3 md:grid-cols-[1fr_auto]">
                <label className="block">
                  {copy.testEmailRecipient}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    value={testEmailRecipient}
                    onChange={(event) => setTestEmailRecipient(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    className="w-full rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold"
                    type="button"
                    onClick={() => void testEmailConfig()}
                  >
                    {copy.testEmail}
                  </button>
                </div>
              </div>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.saveEmailSettings}
              </button>
            </div>
          </form>

          <section className={`${activeTab === "channels" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.notifications}</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              {copy.notificationsHelp}
            </p>
            <form onSubmit={saveNotificationConfig} className="mt-3 grid gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notificationConfig.enabled}
                  onChange={(event) =>
                    setNotificationConfig((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                {copy.enableNotifications}
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={notificationConfig.emailEnabled}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({ ...current, emailEnabled: event.target.checked }))
                      }
                    />
                    {copy.emailChannel}
                  </label>
                  <label className="mt-3 block">
                    {copy.alertRecipients}
                    <textarea
                      className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={arrayToLines(notificationConfig.emailRecipients)}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          emailRecipients: linesToArray(event.target.value),
                        }))
                      }
                      placeholder="agent@example.com"
                    />
                  </label>
                </div>
                <div className="rounded-md border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={notificationConfig.barkEnabled}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({ ...current, barkEnabled: event.target.checked }))
                      }
                    />
                    {copy.barkChannel}
                  </label>
                  <label className="mt-3 block">
                    {copy.barkServerUrl}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={notificationConfig.barkServerUrl}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({ ...current, barkServerUrl: event.target.value }))
                      }
                      placeholder="https://api.day.app"
                    />
                  </label>
                  <label className="mt-3 block">
                    {copy.barkDeviceKeys}
                    <textarea
                      className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={arrayToLines(notificationConfig.barkDeviceKeys)}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          barkDeviceKeys: linesToArray(event.target.value),
                        }))
                      }
                      placeholder="your-bark-device-key"
                    />
                  </label>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-[#e1e7f0] p-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={notificationConfig.newMessage.enabled}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          newMessage: { ...current.newMessage, enabled: event.target.checked },
                        }))
                      }
                    />
                    {copy.newMessageAlert}
                  </label>
                  <div className="mt-3 flex gap-4">
                    {(["bark", "email"] as NotificationChannel[]).map((channel) => (
                      <label key={channel} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={notificationConfig.newMessage.channels.includes(channel)}
                          onChange={(event) =>
                            setNotificationConfig((current) => ({
                              ...current,
                              newMessage: {
                                ...current.newMessage,
                                channels: event.target.checked
                                  ? [...new Set([...current.newMessage.channels, channel])]
                                  : current.newMessage.channels.filter((item) => item !== channel),
                              },
                            }))
                          }
                        />
                        {channel}
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 block">
                    {copy.titleTemplate}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={notificationConfig.newMessage.title}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          newMessage: { ...current.newMessage, title: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="mt-3 block">
                    {copy.bodyTemplate}
                    <textarea
                      className="mt-1 min-h-28 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={notificationConfig.newMessage.body}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          newMessage: { ...current.newMessage, body: event.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="rounded-md border border-[#e1e7f0] p-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={notificationConfig.unreplied.enabled}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          unreplied: { ...current.unreplied, enabled: event.target.checked },
                        }))
                      }
                    />
                    {copy.unrepliedReminder}
                  </label>
                  <label className="mt-3 block">
                    {copy.thresholdsMinutes}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={notificationConfig.unreplied.thresholdsMinutes.join(", ")}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          unreplied: {
                            ...current.unreplied,
                            thresholdsMinutes: event.target.value
                              .split(",")
                              .map((item) => Number(item.trim()))
                              .filter((item) => Number.isFinite(item) && item > 0),
                          },
                        }))
                      }
                      placeholder="1, 5, 30"
                    />
                  </label>
                  <div className="mt-3 flex gap-4">
                    {(["bark", "email"] as NotificationChannel[]).map((channel) => (
                      <label key={channel} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={notificationConfig.unreplied.channels.includes(channel)}
                          onChange={(event) =>
                            setNotificationConfig((current) => ({
                              ...current,
                              unreplied: {
                                ...current.unreplied,
                                channels: event.target.checked
                                  ? [...new Set([...current.unreplied.channels, channel])]
                                  : current.unreplied.channels.filter((item) => item !== channel),
                              },
                            }))
                          }
                        />
                        {channel}
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 block">
                    {copy.titleTemplate}
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={notificationConfig.unreplied.title}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          unreplied: { ...current.unreplied, title: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="mt-3 block">
                    {copy.bodyTemplate}
                    <textarea
                      className="mt-1 min-h-28 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                      value={notificationConfig.unreplied.body}
                      onChange={(event) =>
                        setNotificationConfig((current) => ({
                          ...current,
                          unreplied: { ...current.unreplied, body: event.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
              <p className="text-xs leading-5 text-[#64748b]">
                {copy.templateVariables} {"{{conversationId}}"}, {"{{status}}"}, {"{{subject}}"}, {"{{customerName}}"},{" "}
                {"{{customerEmail}}"}, {"{{channel}}"}, {"{{message}}"}, {"{{messageId}}"}, {"{{createdAt}}"},{" "}
                {"{{thresholdMinutes}}"}.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={notificationBusy !== ""}
                  className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {notificationBusy === "save"
                    ? settingsLocale === "zh"
                      ? "\u4fdd\u5b58\u4e2d..."
                      : "Saving..."
                    : copy.saveNotificationSettings}
                </button>
                <button
                  type="button"
                  disabled={notificationBusy !== ""}
                  className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void processNotificationsNow()}
                >
                  {notificationBusy === "process"
                    ? settingsLocale === "zh"
                      ? "\u5904\u7406\u4e2d..."
                      : "Processing..."
                    : copy.processRemindersNow}
                </button>
                <button
                  type="button"
                  disabled={notificationBusy !== ""}
                  className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void testNotificationConfig()}
                >
                  {notificationBusy === "test"
                    ? settingsLocale === "zh"
                      ? "\u53d1\u9001\u4e2d..."
                      : "Sending..."
                    : copy.testNotifications}
                </button>
              </div>
              {notificationActionMessage || notificationActionError ? (
                <div className="text-sm">
                  {notificationActionMessage ? (
                    <p className="rounded-md border border-[#b7d7c8] bg-[#f0faf5] p-3 text-[#24543f]">
                      {notificationActionMessage}
                    </p>
                  ) : null}
                  {notificationActionError ? (
                    <p className="rounded-md border border-[#f1b8b8] bg-[#fff5f5] p-3 text-[#b42318]">
                      {notificationActionError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </form>
          </section>

          <section className={`${activeTab === "integrations" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.tools}</h2>
            <div className="mt-3 space-y-2 text-sm">
              {tools.map((tool) => (
                <button
                  key={tool.name}
                  className={`block w-full border p-3 text-left ${
                    tool.name === toolName ? "border-[#3c6e9f] bg-[#edf3f8]" : "border-[#e1e7f0] bg-[#f8fafc]"
                  }`}
                  type="button"
                  onClick={() => loadToolDraft(tool)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{tool.name}</div>
                      <div className="mt-1 text-xs text-[#64748b]">
                        {tool.permissionScope} | {tool.enabled ? "enabled" : "disabled"} |{" "}
                        {tool.runtimeImplemented ? "implemented" : "definition only"}
                      </div>
                    </div>
                    <span className="rounded-md bg-white px-2 py-1 text-xs text-[#475569]">{tool.timeoutMs}ms</span>
                  </div>
                </button>
              ))}
            </div>
            <form onSubmit={saveToolDefinition} className="mt-4 grid gap-3 text-sm">
              <label className="block">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={toolName}
                  onChange={(event) => setToolName(event.target.value)}
                />
              </label>
              <label className="block">
                Description
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={toolDescription}
                  onChange={(event) => setToolDescription(event.target.value)}
                />
              </label>
              <label className="block">
                {copy.inputSchema}
                <textarea
                  className="mt-1 min-h-32 w-full rounded-md border border-[#bbc7d8] px-3 py-2 font-mono text-xs"
                  value={toolInputSchema}
                  onChange={(event) => setToolInputSchema(event.target.value)}
                />
              </label>
              <label className="block">
                {copy.authConfig}
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2 font-mono text-xs"
                  value={toolAuthConfig}
                  onChange={(event) => setToolAuthConfig(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  {copy.timeoutMs}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    min={100}
                    type="number"
                    value={toolTimeoutMs}
                    onChange={(event) => setToolTimeoutMs(Number(event.target.value))}
                  />
                </label>
                <label className="block">
                  {copy.scope}
                  <select
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    value={toolPermissionScope}
                    onChange={(event) => setToolPermissionScope(event.target.value as ToolPermissionScope)}
                  >
                    <option value="ai">ai</option>
                    <option value="agent">agent</option>
                    <option value="admin">admin</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={toolEnabled}
                  onChange={(event) => setToolEnabled(event.target.checked)}
                />
                {copy.enabled}
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.saveTool}
              </button>
            </form>
          </section>

          <section className={`${activeTab === "integrations" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.webhooks}</h2>
            <form onSubmit={createWebhookEndpoint} className="mt-3 grid gap-3 text-sm">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2"
                placeholder={settingsLocale === "zh" ? "Endpoint 名称" : "Endpoint name"}
                value={webhookName}
                onChange={(event) => setWebhookName(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2"
                placeholder="https://example.com/live-chat/webhook"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2"
                placeholder={settingsLocale === "zh" ? "可选签名密钥" : "Optional signing secret"}
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
              />
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">{copy.events}</div>
                {webhookEvents.map((eventName) => (
                  <label key={eventName} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={webhookSelectedEvents.includes(eventName)}
                      onChange={() => toggleWebhookEvent(eventName)}
                    />
                    {eventName}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  {settingsLocale === "zh" ? "最大尝试次数" : "Max attempts"}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    min={1}
                    type="number"
                    value={webhookRetryMaxAttempts}
                    onChange={(event) => setWebhookRetryMaxAttempts(Number(event.target.value))}
                  />
                </label>
                <label className="block">
                  {settingsLocale === "zh" ? "退避秒数" : "Backoff seconds"}
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    min={0}
                    type="number"
                    value={webhookRetryBackoffSeconds}
                    onChange={(event) => setWebhookRetryBackoffSeconds(Number(event.target.value))}
                  />
                </label>
              </div>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.createEndpoint}
              </button>
            </form>

            <div className="mt-5 space-y-2 text-sm">
              <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">Endpoints</div>
              {webhookEndpoints.map((endpoint) => (
                <div key={endpoint.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  <div className="font-semibold">{endpoint.name}</div>
                  <div className="mt-1 break-all text-xs text-[#64748b]">{endpoint.url}</div>
                  <div className="mt-2 text-xs text-[#64748b]">
                    {endpoint.events.join(", ")} | {settingsLocale === "zh" ? "尝试" : "attempts"} {endpoint.retryMaxAttempts} | {settingsLocale === "zh" ? "退避" : "backoff"}{" "}
                    {endpoint.retryBackoffSeconds}s
                  </div>
                </div>
              ))}
              {!webhookEndpoints.length ? (
                <p className="text-sm text-[#64748b]">
                  {settingsLocale === "zh" ? "暂无 Webhook Endpoint。" : "No webhook endpoints yet."}
                </p>
              ) : null}
            </div>

            <div className="mt-5 space-y-2 text-sm">
              <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">{copy.recentDeliveries}</div>
              {webhookDeliveries.slice(0, 12).map((delivery) => {
                const endpoint = webhookEndpoints.find((item) => item.id === delivery.endpointId);
                return (
                  <div key={delivery.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          {delivery.event} / {delivery.status}
                        </div>
                        <div className="mt-1 text-xs text-[#64748b]">
                          {endpoint?.name ?? delivery.endpointId} | {settingsLocale === "zh" ? "尝试" : "attempts"} {delivery.attempts} |{" "}
                          {new Date(delivery.createdAt).toLocaleString()}
                        </div>
                        {delivery.lastError ? <div className="mt-1 text-xs text-[#b42318]">{delivery.lastError}</div> : null}
                      </div>
                      {delivery.status === "failed" ? (
                        <button
                          className="rounded-md border border-[#b9c2d4] bg-white px-3 py-1 text-xs font-semibold"
                          type="button"
                          onClick={() => void replayWebhookDelivery(delivery)}
                        >
                          {copy.replay}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!webhookDeliveries.length ? (
                <p className="text-sm text-[#64748b]">
                  {settingsLocale === "zh" ? "暂无 Webhook 投递记录。" : "No webhook deliveries yet."}
                </p>
              ) : null}
            </div>
          </section>

          <form
            onSubmit={testAI}
            className={`${activeTab === "ai" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}
          >
            <h2 className="text-lg font-semibold">{copy.testAI}</h2>
            <textarea
              className="mt-3 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
              value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)}
            />
            <button className="mt-3 rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">{copy.runTest}</button>
            {aiTestResult ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-normal text-[#64748b]">Reply</div>
                  <p>{aiTestResult.reply || "No reply generated."}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="border border-[#e1e7f0] p-2">
                    <div className="text-[#64748b]">Action</div>
                    <div className="font-semibold">{aiTestResult.action}</div>
                  </div>
                  <div className="border border-[#e1e7f0] p-2">
                    <div className="text-[#64748b]">Provider</div>
                    <div className="font-semibold">
                      {aiTestResult.trace?.provider ?? aiConfig.provider} / {aiTestResult.trace?.model ?? aiConfig.model}
                    </div>
                  </div>
                  <div className="border border-[#e1e7f0] p-2">
                    <div className="text-[#64748b]">Latency</div>
                    <div className="font-semibold">{aiTestResult.trace?.latencyMs ?? 0}ms</div>
                  </div>
                  <div className="border border-[#e1e7f0] p-2">
                    <div className="text-[#64748b]">Fallback / handoff</div>
                    <div className="font-semibold">
                      {aiTestResult.trace?.fallbackReason ||
                        aiTestResult.trace?.handoffReason ||
                        aiTestResult.reason ||
                        "none"}
                    </div>
                  </div>
                  <div className="border border-[#e1e7f0] p-2">
                    <div className="text-[#64748b]">Tool calls</div>
                    <div className="font-semibold">{aiTestResult.trace?.toolCallPlaceholders.length ?? 0} placeholders</div>
                  </div>
                </div>
                <div className="border border-[#e1e7f0] p-3 text-xs">
                  <div className="font-semibold">Prompt structure</div>
                  <div className="mt-1 text-[#64748b]">
                    system {aiTestResult.promptSummary.systemPromptLength} chars | messages{" "}
                    {aiTestResult.promptSummary.selectedMessageCount}/{aiTestResult.promptSummary.maxContextMessages} |
                    knowledge {aiTestResult.promptSummary.knowledgeSourceCount} | tools{" "}
                    {aiTestResult.promptSummary.toolCount}
                  </div>
                </div>
                {aiTestResult.knowledgeContext.length ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">Knowledge hits</div>
                    {aiTestResult.knowledgeContext.slice(0, 3).map((result) => (
                      <div key={result.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                        <div className="font-semibold">{result.documentTitle}</div>
                        <div className="text-xs text-[#64748b]">
                          score {result.score.toFixed(2)}
                          {result.sourceName ? ` | ${result.sourceType ?? "source"}: ${result.sourceName}` : ""}
                        </div>
                        <p className="mt-1 max-h-20 overflow-hidden text-xs">{result.content}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {aiTestResult.trace?.toolCallPlaceholders.length ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">
                      Tool-call placeholders
                    </div>
                    {aiTestResult.trace.toolCallPlaceholders.map((toolCall, index) => (
                      <div key={`${toolCall.id ?? toolCall.name}-${index}`} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                        <div className="font-semibold">{toolCall.name}</div>
                        <div className="mt-1 max-h-20 overflow-hidden text-xs text-[#64748b]">
                          {JSON.stringify(toolCall.arguments)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </form>

          <section className={`${activeTab === "ai" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.aiTraces}</h2>
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">
              {aiTraces.map((trace) => (
                <div key={trace.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">
                      {trace.action} / {trace.provider} / {trace.model}
                    </div>
                    <span className="text-xs text-[#64748b]">{trace.latencyMs}ms</span>
                  </div>
                  <div className="mt-1 text-xs text-[#64748b]">
                    messages {trace.selectedMessages.length} | knowledge {trace.knowledgeSources.length} | tools{" "}
                    {trace.toolNames.length} | tool calls {trace.toolCallPlaceholders.length}
                  </div>
                  {trace.handoffReason || trace.fallbackReason || trace.error ? (
                    <div className="mt-1 text-xs text-[#8a4b17]">
                      {trace.handoffReason ? `handoff: ${trace.handoffReason}` : ""}
                      {trace.fallbackReason ? ` fallback: ${trace.fallbackReason}` : ""}
                      {trace.error ? ` error: ${trace.error}` : ""}
                    </div>
                  ) : null}
                </div>
              ))}
              {!aiTraces.length ? <p className="text-sm text-[#64748b]">No AI traces yet.</p> : null}
            </div>
          </section>

          <section className={`${activeTab === "knowledge" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.knowledgeInventory}</h2>
            <div className="mt-3 space-y-3 text-sm">
              {knowledgeBases.map((kb) => (
                <div key={kb.id} className="border border-[#e1e7f0] p-3">
                  <div className="font-semibold">{kb.name}</div>
                  <div className="text-[#64748b]">
                    {documents.filter((document) => document.knowledgeBaseId === kb.id).length} documents /{" "}
                    {knowledgeSources.filter((source) => source.knowledgeBaseId === kb.id).length} sources /{" "}
                    {knowledgeEmbeddings.filter((embedding) => embedding.knowledgeBaseId === kb.id).length} embeddings
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={`${activeTab === "security" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{copy.auditLogs}</h2>
              <button
                className="rounded-md border border-[#d17a7a] px-3 py-1 text-sm font-medium text-[#9f1d1d] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!auditLogs.length}
                onClick={() => void clearAuditLogs()}
              >
                {copy.clearAuditLogs}
              </button>
            </div>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto text-sm">
              {auditLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="border-l-4 border-[#3c6e9f] bg-[#f8fafc] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{log.action}</div>
                      <div className="text-xs text-[#64748b]">{new Date(log.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      className="rounded-md border border-[#d17a7a] px-3 py-1 text-xs font-medium text-[#9f1d1d]"
                      type="button"
                      onClick={() => void deleteAuditLog(log)}
                    >
                      {copy.deleteAuditLog}
                    </button>
                  </div>
                </div>
              ))}
              {!auditLogs.length ? <p className="text-sm text-[#64748b]">{copy.noAuditLogs}</p> : null}
            </div>
          </section>

          <section className={`${activeTab === "security" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.security}</h2>
            <form onSubmit={saveSecuritySettings} className="mt-3 grid gap-3 text-sm">
              <label className="block">
                {copy.failedLoginThreshold}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  min={1}
                  type="number"
                  value={securitySettings.failedLoginLockoutThreshold}
                  onChange={(event) =>
                    setSecuritySettings((current) => ({
                      ...current,
                      failedLoginLockoutThreshold: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="block">
                {copy.lockoutMinutes}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  min={1}
                  type="number"
                  value={securitySettings.lockoutMinutes}
                  onChange={(event) =>
                    setSecuritySettings((current) => ({ ...current, lockoutMinutes: Number(event.target.value) }))
                  }
                />
              </label>
              <label className="block">
                {copy.passwordRotationDays}
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  min={0}
                  type="number"
                  value={securitySettings.passwordRotationDays}
                  onChange={(event) =>
                    setSecuritySettings((current) => ({
                      ...current,
                      passwordRotationDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.saveSecuritySettings}
              </button>
            </form>
          </section>

          <section className={`${activeTab === "security" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.invitations}</h2>
            <form onSubmit={createInvitation} className="mt-3 grid gap-2">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder={copy.username}
                value={inviteUsername}
                onChange={(event) => setInviteUsername(event.target.value)}
              />
              <select
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as UserRole)}
              >
                <option value="agent">agent</option>
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
              <label className="block text-xs text-[#51607a]">
                Expires in days
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  min={1}
                  max={30}
                  type="number"
                  value={inviteExpiresInDays}
                  onChange={(event) => setInviteExpiresInDays(Number(event.target.value))}
                />
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                {copy.createInvitation}
              </button>
            </form>
            {latestInviteUrl ? (
              <div className="mt-3 border border-[#b7d7c8] bg-[#f0faf5] p-3 text-sm text-[#24543f]">
                {copy.invitationLink}
                <input className="mt-2 w-full rounded-md border border-[#b7d7c8] px-2 py-1" readOnly value={latestInviteUrl} />
              </div>
            ) : null}
            <div className="mt-4 space-y-2 text-sm">
              {invitations.slice(0, 10).map((invitation) => {
                const expired = currentTimeMs > 0 && new Date(invitation.expiresAt).getTime() <= currentTimeMs;
                const status = invitation.acceptedAt
                  ? "accepted"
                  : invitation.revokedAt
                    ? "revoked"
                    : expired
                      ? "expired"
                      : "active";
                return (
                  <div key={invitation.id} className="border border-[#e1e7f0] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{invitation.username}</div>
                        <div className="mt-1 text-xs text-[#64748b]">
                          {invitation.role} | expires {new Date(invitation.expiresAt).toLocaleString()}
                        </div>
                      </div>
                      <span className="rounded-md bg-[#edf2f7] px-2 py-1 text-xs text-[#51607a]">{status}</span>
                    </div>
                    {status === "active" ? (
                      <button
                        className="mt-2 rounded-md border border-[#b9c2d4] px-3 py-1"
                        type="button"
                        onClick={() => revokeInvitation(invitation)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`${activeTab === "security" ? "" : "hidden"} border border-[#d9e1ee] bg-white p-5`}>
            <h2 className="text-lg font-semibold">{copy.users}</h2>
            <form onSubmit={createUser} className="mt-3 grid gap-2">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder={copy.username}
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder={copy.password}
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
              />
              <select
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                value={newUserRole}
                onChange={(event) => setNewUserRole(event.target.value as UserRole)}
              >
                <option value="agent">agent</option>
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-[#51607a]">
                <input
                  type="checkbox"
                  checked={newUserForcePasswordChange}
                  onChange={(event) => setNewUserForcePasswordChange(event.target.checked)}
                />
                {copy.requirePasswordChange}
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">{copy.createUser}</button>
            </form>
            <div className="mt-4 space-y-2 text-sm">
              {users.map((user) => (
                <div key={user.id} className="border border-[#e1e7f0] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{user.username}</div>
                      <div className="mt-1 text-xs text-[#64748b]">
                        {settingsLocale === "zh" ? "登录失败次数" : "Failed logins"}: {user.failedLoginCount}
                        {user.lockedUntil ? ` | locked until ${new Date(user.lockedUntil).toLocaleString()}` : ""}
                        {user.passwordChangeRequired
                          ? ` | password change required${user.passwordChangeReason ? ` (${user.passwordChangeReason})` : ""}`
                          : ""}
                      </div>
                      {user.passwordChangedAt ? (
                        <div className="mt-1 text-xs text-[#64748b]">
                          {settingsLocale === "zh" ? "密码修改时间" : "Password changed"} {new Date(user.passwordChangedAt).toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                    <span className="rounded-md bg-[#edf2f7] px-2 py-1 text-xs text-[#51607a]">
                      {user.disabled ? "disabled" : user.lockedUntil ? "locked" : "active"}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-2 py-1"
                      value={user.role}
                      onChange={(event) => updateUser(user, { role: event.target.value as UserRole })}
                    >
                      <option value="agent">agent</option>
                      <option value="admin">admin</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => updateUser(user, { disabled: !user.disabled })}
                    >
                      {user.disabled ? copy.enable : copy.disable}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => updateUser(user, { forcePasswordChange: !user.forcePasswordChange })}
                    >
                      {user.forcePasswordChange
                        ? settingsLocale === "zh"
                          ? "清除改密标记"
                          : "Clear change flag"
                        : settingsLocale === "zh"
                          ? "要求修改密码"
                          : "Require password change"}
                    </button>
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => updateUser(user, { unlock: true })}
                    >
                      {copy.unlock}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-2 py-1"
                      placeholder={copy.newPassword}
                      type="password"
                      value={resetPasswords[user.id] ?? ""}
                      onChange={(event) =>
                        setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))
                      }
                    />
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => resetUserPassword(user)}
                    >
                      {copy.reset}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
