export type UserRole = "admin" | "agent" | "viewer";
export type ConversationStatus = "ai_active" | "queued_for_human" | "human_active" | "resolved" | "closed";
export type MessageRole = "visitor" | "ai" | "human_agent" | "system" | "tool";
export type WebhookEvent =
  | "conversation.created"
  | "message.created"
  | "handoff.started"
  | "handoff.released"
  | "conversation.resolved"
  | "conversation.closed"
  | "ai.fallback"
  | "knowledge.hit"
  | "tool.invocation";

export type AIProviderName = string;
export type NoAnswerStrategy = "continue" | "fallback" | "handoff" | "transfer";
export type AppLocale = "en" | "zh";
export type AgentLanguage = "zh-CN" | "en-US";
export type ProviderFallbackStrategy = "priority" | "round_robin";

export type AutoHandoffRules = {
  enabled: boolean;
  userRequestPatterns: string[];
  sensitiveKeywords: string[];
  vipMetadataKeys: string[];
  aiFailureThreshold: number;
  lowConfidenceKnowledgeScoreThreshold: number;
};

export type AIProviderChainItem = {
  id: string;
  provider: AIProviderName;
  label?: string;
  model: string;
  models?: string[];
  enabled: boolean;
  priority: number;
  baseUrl?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
};

export type AIConfiguration = {
  id: string;
  provider: AIProviderName;
  model: string;
  providerChain: AIProviderChainItem[];
  providerFallbackStrategy: ProviderFallbackStrategy;
  temperature: number;
  maxContextMessages: number;
  systemPrompt: string;
  fallbackMessage: string;
  noAnswerStrategy: NoAnswerStrategy;
  enableKnowledgeBase: boolean;
  enableTools: boolean;
  knowledgeBaseIds: string[];
  translationEnabled: boolean;
  translationProvider: AIProviderName;
  translationModel: string;
  agentLanguage: AgentLanguage;
  autoHandoff: AutoHandoffRules;
  createdAt: string;
  updatedAt: string;
};

export type AITrace = {
  id: string;
  conversationId?: string;
  action: "replied" | "handoff" | "skipped" | "failed" | "test";
  provider: string;
  model: string;
  latencyMs: number;
  configSnapshot: Record<string, unknown>;
  selectedMessages: Array<Pick<Message, "id" | "role" | "content" | "createdAt">>;
  knowledgeSources: Array<{
    chunkId: string;
    knowledgeBaseId: string;
    sourceId?: string;
    sourceName?: string;
    sourceType?: KnowledgeSource["type"];
    documentId: string;
    documentTitle: string;
    chunkOrdinal: number;
    score: number;
  }>;
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
  replyMessageId?: string;
  createdAt: string;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSource = {
  id: string;
  knowledgeBaseId: string;
  type: "manual" | "markdown" | "text" | "pdf" | "docx" | "url" | "external";
  name: string;
  uri?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeDocument = {
  id: string;
  knowledgeBaseId: string;
  sourceId?: string;
  title: string;
  sourceType: KnowledgeSource["type"];
  content: string;
  enabled: boolean;
  contentHash?: string;
  indexingStatus: "pending" | "indexed" | "failed";
  indexedAt?: string;
  lastIndexError?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunk = {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  sourceId?: string;
  content: string;
  ordinal: number;
  tokens: string[];
  tokenCount: number;
  createdAt: string;
};

export type KnowledgeEmbedding = {
  id: string;
  knowledgeBaseId: string;
  sourceId?: string;
  documentId: string;
  chunkId: string;
  provider: string;
  model: string;
  dimensions: number;
  embedding?: number[];
  status: "pending" | "indexed" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSearchResult = KnowledgeChunk & {
  score: number;
  documentTitle: string;
  sourceName?: string;
  sourceType?: KnowledgeSource["type"];
};

export type KnowledgeSearchOptions = {
  query: string;
  knowledgeBaseIds?: string[];
  topK?: number;
  sourceTypes?: KnowledgeSource["type"][];
  keywordWeight?: number;
  vectorWeight?: number;
  minScore?: number;
  candidateMultiplier?: number;
};

export type AuditLog = {
  id: string;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SecuritySettings = {
  id: "global";
  failedLoginLockoutThreshold: number;
  lockoutMinutes: number;
  passwordRotationDays: number;
  updatedAt: string;
};

export type WidgetConfiguration = {
  id: "global";
  themeColor: string;
  welcomeMessage: string;
  offlineMessage: string;
  enableSatisfaction: boolean;
  enableTranscriptDownload: boolean;
  requireEndConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentStatus = {
  userId: string;
  status: "online" | "away" | "offline";
  updatedAt: string;
};

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  disabled: boolean;
  failedLoginCount: number;
  lockedUntil?: string;
  passwordChangedAt?: string;
  forcePasswordChange: boolean;
  locale: AppLocale;
  createdAt: string;
};

export type UserInvitation = {
  id: string;
  username: string;
  role: UserRole;
  tokenHash: string;
  invitedById?: string;
  acceptedUserId?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
};

export type ApiToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: string[];
  disabled: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  visitorSessionId: string;
  externalUserId?: string;
  status: ConversationStatus;
  subject?: string;
  metadata: Record<string, unknown>;
  takenOverById?: string;
  takenOverAt?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};

export type ConversationTag = {
  name: string;
  color?: string;
};

export type CustomerProfile = {
  name?: string;
  email?: string;
  externalId?: string;
  plan?: string;
  notes?: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  agentId?: string;
  createdAt: string;
};

export type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  secret?: string;
  enabled: boolean;
  events: WebhookEvent[];
  retryMaxAttempts: number;
  retryBackoffSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  event: WebhookEvent;
  payload: unknown;
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastError?: string;
  createdAt: string;
};

export type ToolInvocationLog = {
  id: string;
  toolName: string;
  conversationId?: string;
  input: unknown;
  output?: unknown;
  status: "success" | "failed";
  error?: string;
  createdAt: string;
};

export type ToolPermissionScope = "ai" | "agent" | "admin" | "disabled";

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  authConfig: Record<string, unknown>;
  timeoutMs: number;
  enabled: boolean;
  permissionScope: ToolPermissionScope;
  createdAt: string;
  updatedAt: string;
};

export type SystemHealth = {
  ok: boolean;
  time: string;
  storage: "file-store" | "prisma";
  database: {
    ok: boolean;
    provider: "file" | "postgresql";
    migrationStatus: "not_applicable" | "ok" | "missing" | "error";
    appliedMigrations?: number;
    latestMigration?: string;
    error?: string;
  };
  ai: {
    ok: boolean;
    provider?: AIProviderName;
    model?: string;
    openAIKeyConfigured: boolean;
    error?: string;
  };
  secrets: {
    sessionSecretConfigured: boolean;
    webhookSigningSecretConfigured: boolean;
    insecureDefaults: string[];
  };
  security?: {
    failedLoginLockoutThreshold: number;
    lockoutMinutes: number;
    passwordRotationDays: number;
  };
};

export type AnalyticsFilters = {
  dateFrom?: string;
  dateTo?: string;
  agentId?: string;
  channel?: string;
  tag?: string;
  status?: ConversationStatus;
  knowledgeBaseId?: string;
};

export type AnalyticsMetrics = {
  filters: AnalyticsFilters;
  totalConversations: number;
  openConversations: number;
  resolvedConversations: number;
  closedConversations: number;
  aiMessages: number;
  humanMessages: number;
  visitorMessages: number;
  humanHandoffRate: number;
  aiResolutionRate: number;
  knowledgeHitRate: number;
  averageFirstResponseSeconds?: number;
  averageResolutionSeconds?: number;
  averageSatisfactionScore?: number;
  satisfactionResponses: number;
  byStatus: Record<ConversationStatus, number>;
  byChannel: Record<string, number>;
};

export type StoreData = {
  users: User[];
  userInvitations: UserInvitation[];
  conversations: Conversation[];
  messages: Message[];
  webhookEndpoints: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  apiTokens: ApiToken[];
  toolDefinitions: ToolDefinition[];
  toolInvocationLogs: ToolInvocationLog[];
  aiTraces: AITrace[];
  aiConfiguration?: AIConfiguration;
  securitySettings?: SecuritySettings;
  widgetConfiguration?: WidgetConfiguration;
  knowledgeBases: KnowledgeBase[];
  knowledgeSources: KnowledgeSource[];
  knowledgeDocuments: KnowledgeDocument[];
  knowledgeChunks: KnowledgeChunk[];
  knowledgeEmbeddings: KnowledgeEmbedding[];
  auditLogs: AuditLog[];
  agentStatuses: AgentStatus[];
};

export type ConversationWithMessages = Conversation & {
  messages: Message[];
  takenOverBy?: Pick<User, "id" | "username" | "role">;
  tags?: ConversationTag[];
  customerProfile?: CustomerProfile;
  quickReplies?: string[];
};
