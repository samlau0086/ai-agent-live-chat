"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminText } from "@/lib/admin-i18n";
import { webhookEvents } from "@/lib/event-contracts";
import type {
  AIConfiguration,
  AnalyticsMetrics,
  AITrace,
  AuditLog,
  ConversationStatus,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeEmbedding,
  KnowledgeSearchResult,
  KnowledgeSource,
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

      <div className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-5">
          <form onSubmit={saveAIConfig} className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">AI configuration</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                Provider
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
                Model
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
                Temperature
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
                Context messages
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
                  <h3 className="text-sm font-semibold">Provider fallback chain</h3>
                  <p className="text-xs text-[#64748b]">
                    Providers are tried by priority. Failed or empty replies automatically fall back to the next enabled provider.
                  </p>
                </div>
                <button
                  className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium"
                  type="button"
                  onClick={addProviderChainItem}
                >
                  Add provider
                </button>
              </div>
              <label className="mt-3 block text-sm font-medium">
                Fallback strategy
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
                  <option value="priority">priority order</option>
                  <option value="round_robin">round robin start, then fallback</option>
                </select>
              </label>
              <div className="mt-3 space-y-3">
                {providerChain.map((item, index) => {
                  const option = providerOptions.find((provider) => provider.name === item.provider);
                  const modelOptions = option?.chatModels ?? [];
                  return (
                    <div key={item.id} className="grid gap-3 border border-[#e1e7f0] p-3 md:grid-cols-[80px_140px_minmax(0,1fr)_minmax(0,1fr)]">
                      <label className="text-xs font-medium">
                        Enabled
                        <input
                          className="mt-3 block"
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => updateProviderChain(index, { enabled: event.target.checked })}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        Priority
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          type="number"
                          min="1"
                          value={item.priority}
                          onChange={(event) => updateProviderChain(index, { priority: Number(event.target.value) })}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        Provider
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
                        Display name
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          value={item.label ?? item.provider}
                          onChange={(event) => updateProviderChain(index, { label: event.target.value })}
                          placeholder={option?.label ?? item.provider}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        Model
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
                        Models fallback order
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
                        Base URL
                        <input
                          className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-2"
                          placeholder={option?.defaultBaseUrl ?? "https://provider.example.com/v1"}
                          value={item.baseUrl ?? ""}
                          onChange={(event) => updateProviderChain(index, { baseUrl: event.target.value })}
                        />
                      </label>
                      <label className="text-xs font-medium">
                        API key env
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
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <label className="mt-4 block text-sm font-medium">
              System prompt
              <textarea
                className="mt-1 min-h-28 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.systemPrompt}
                onChange={(event) => setAiConfig({ ...aiConfig, systemPrompt: event.target.value })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Fallback message
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.fallbackMessage}
                onChange={(event) => setAiConfig({ ...aiConfig, fallbackMessage: event.target.value })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              No-answer strategy
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
                <option value="continue">continue with caveat</option>
                <option value="fallback">return fallback message</option>
                <option value="handoff">queue for human</option>
                <option value="transfer">transfer immediately</option>
              </select>
            </label>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.enableKnowledgeBase}
                  onChange={(event) => setAiConfig({ ...aiConfig, enableKnowledgeBase: event.target.checked })}
                />
                Enable knowledge base
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.enableTools}
                  onChange={(event) => setAiConfig({ ...aiConfig, enableTools: event.target.checked })}
                />
                Enable tools
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
                Enable auto handoff
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.translationEnabled}
                  onChange={(event) => setAiConfig({ ...aiConfig, translationEnabled: event.target.checked })}
                />
                Enable auto translation
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="text-sm font-medium">
                Translation provider
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
                Translation model
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
                Agent language
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
                Handoff request patterns
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
                Sensitive keywords
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
                AI failure threshold
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
                Low-confidence KB threshold
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
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Save AI config</button>
              {saved ? <span className="text-sm text-[#2e6f57]">{saved}</span> : null}
            </div>
          </form>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Knowledge base</h2>
            <form onSubmit={createKnowledgeBase} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Knowledge base name"
                value={newKbName}
                onChange={(event) => setNewKbName(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Description"
                value={newKbDescription}
                onChange={(event) => setNewKbDescription(event.target.value)}
              />
              <button className="rounded-md bg-[#2e6f57] px-4 py-2 text-sm font-semibold text-white">Create</button>
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
            <section className="border border-[#d9e1ee] bg-white p-5">
              <h2 className="text-lg font-semibold">Operations</h2>
              <div className="mt-3 grid gap-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    From
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-2 py-1"
                      type="date"
                      value={metricDateFrom}
                      onChange={(event) => setMetricDateFrom(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    To
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
                    <option value="">All statuses</option>
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
                    <option value="">All agents</option>
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
                  Apply filters
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Conversations</div>
                  <div className="text-xl font-semibold">{metrics.totalConversations}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Open</div>
                  <div className="text-xl font-semibold">{metrics.openConversations}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Handoff</div>
                  <div className="text-xl font-semibold">{formatPercent(metrics.humanHandoffRate)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">KB hit</div>
                  <div className="text-xl font-semibold">{formatPercent(metrics.knowledgeHitRate)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">AI resolution</div>
                  <div className="text-xl font-semibold">{formatPercent(metrics.aiResolutionRate)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">First response</div>
                  <div className="text-xl font-semibold">{formatDuration(metrics.averageFirstResponseSeconds)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Resolution</div>
                  <div className="text-xl font-semibold">{formatDuration(metrics.averageResolutionSeconds)}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Satisfaction</div>
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
                      <h3 className="font-semibold">Low rating review</h3>
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
                      <h3 className="font-semibold">Unresolved review</h3>
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
                    <h3 className="font-semibold">Missed questions</h3>
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
                    <h3 className="font-semibold">Knowledge gaps</h3>
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

          <form onSubmit={saveWidgetConfig} className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Widget</h2>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="block">
                Theme color
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
                Welcome message
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={widgetConfig.welcomeMessage}
                  onChange={(event) => setWidgetConfig((current) => ({ ...current, welcomeMessage: event.target.value }))}
                />
              </label>
              <label className="block">
                Offline message
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
                Satisfaction rating
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={widgetConfig.enableTranscriptDownload}
                  onChange={(event) =>
                    setWidgetConfig((current) => ({ ...current, enableTranscriptDownload: event.target.checked }))
                  }
                />
                Transcript download
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={widgetConfig.requireEndConfirmation}
                  onChange={(event) =>
                    setWidgetConfig((current) => ({ ...current, requireEndConfirmation: event.target.checked }))
                  }
                />
                End-chat confirmation
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                Save widget settings
              </button>
            </div>
          </form>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Tools</h2>
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
                Input schema
                <textarea
                  className="mt-1 min-h-32 w-full rounded-md border border-[#bbc7d8] px-3 py-2 font-mono text-xs"
                  value={toolInputSchema}
                  onChange={(event) => setToolInputSchema(event.target.value)}
                />
              </label>
              <label className="block">
                Auth config
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2 font-mono text-xs"
                  value={toolAuthConfig}
                  onChange={(event) => setToolAuthConfig(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  Timeout ms
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    min={100}
                    type="number"
                    value={toolTimeoutMs}
                    onChange={(event) => setToolTimeoutMs(Number(event.target.value))}
                  />
                </label>
                <label className="block">
                  Scope
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
                Enabled
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
                Save tool
              </button>
            </form>
          </section>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Webhooks</h2>
            <form onSubmit={createWebhookEndpoint} className="mt-3 grid gap-3 text-sm">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2"
                placeholder="Endpoint name"
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
                placeholder="Optional signing secret"
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
              />
              <div className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">Events</div>
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
                  Max attempts
                  <input
                    className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                    min={1}
                    type="number"
                    value={webhookRetryMaxAttempts}
                    onChange={(event) => setWebhookRetryMaxAttempts(Number(event.target.value))}
                  />
                </label>
                <label className="block">
                  Backoff seconds
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
                Create webhook
              </button>
            </form>

            <div className="mt-5 space-y-2 text-sm">
              <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">Endpoints</div>
              {webhookEndpoints.map((endpoint) => (
                <div key={endpoint.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                  <div className="font-semibold">{endpoint.name}</div>
                  <div className="mt-1 break-all text-xs text-[#64748b]">{endpoint.url}</div>
                  <div className="mt-2 text-xs text-[#64748b]">
                    {endpoint.events.join(", ")} | attempts {endpoint.retryMaxAttempts} | backoff{" "}
                    {endpoint.retryBackoffSeconds}s
                  </div>
                </div>
              ))}
              {!webhookEndpoints.length ? <p className="text-sm text-[#64748b]">No webhook endpoints yet.</p> : null}
            </div>

            <div className="mt-5 space-y-2 text-sm">
              <div className="text-xs font-semibold uppercase tracking-normal text-[#64748b]">Deliveries</div>
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
                          {endpoint?.name ?? delivery.endpointId} | attempts {delivery.attempts} |{" "}
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
                          Replay
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!webhookDeliveries.length ? <p className="text-sm text-[#64748b]">No webhook deliveries yet.</p> : null}
            </div>
          </section>

          <form onSubmit={testAI} className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Test AI</h2>
            <textarea
              className="mt-3 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
              value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)}
            />
            <button className="mt-3 rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Run test</button>
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

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">AI traces</h2>
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

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Knowledge inventory</h2>
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

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Audit logs</h2>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto text-sm">
              {auditLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="border-l-4 border-[#3c6e9f] bg-[#f8fafc] p-3">
                  <div className="font-semibold">{log.action}</div>
                  <div className="text-xs text-[#64748b]">{new Date(log.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Security</h2>
            <form onSubmit={saveSecuritySettings} className="mt-3 grid gap-3 text-sm">
              <label className="block">
                Failed login threshold
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
                Lockout minutes
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
                Password rotation days
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
                Save security settings
              </button>
            </form>
          </section>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Invitations</h2>
            <form onSubmit={createInvitation} className="mt-3 grid gap-2">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Username"
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
                Create invitation
              </button>
            </form>
            {latestInviteUrl ? (
              <div className="mt-3 border border-[#b7d7c8] bg-[#f0faf5] p-3 text-sm text-[#24543f]">
                Invitation link
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

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Users</h2>
            <form onSubmit={createUser} className="mt-3 grid gap-2">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Username"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Password"
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
                Require password change on first sign-in
              </label>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Create user</button>
            </form>
            <div className="mt-4 space-y-2 text-sm">
              {users.map((user) => (
                <div key={user.id} className="border border-[#e1e7f0] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{user.username}</div>
                      <div className="mt-1 text-xs text-[#64748b]">
                        Failed logins: {user.failedLoginCount}
                        {user.lockedUntil ? ` | locked until ${new Date(user.lockedUntil).toLocaleString()}` : ""}
                        {user.passwordChangeRequired
                          ? ` | password change required${user.passwordChangeReason ? ` (${user.passwordChangeReason})` : ""}`
                          : ""}
                      </div>
                      {user.passwordChangedAt ? (
                        <div className="mt-1 text-xs text-[#64748b]">
                          Password changed {new Date(user.passwordChangedAt).toLocaleString()}
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
                      {user.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => updateUser(user, { forcePasswordChange: !user.forcePasswordChange })}
                    >
                      {user.forcePasswordChange ? "Clear change flag" : "Require password change"}
                    </button>
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => updateUser(user, { unlock: true })}
                    >
                      Unlock
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-2 py-1"
                      placeholder="New password"
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
                      Reset
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {error ? <p className="border border-[#f1b8b8] bg-[#fff5f5] p-3 text-sm text-[#b42318]">{error}</p> : null}
        </aside>
      </div>
    </main>
  );
}
