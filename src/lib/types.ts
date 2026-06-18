export type UserRole = "admin" | "agent" | "viewer";
export type ConversationStatus = "ai_active" | "queued_for_human" | "human_active" | "resolved" | "closed";
export type MessageRole = "visitor" | "ai" | "human_agent" | "system" | "tool";
export type WebhookEvent =
  | "conversation.created"
  | "message.created"
  | "handoff.started"
  | "handoff.released"
  | "conversation.closed";

export type AIProviderName = "mock" | "openai" | "future_provider";

export type AutoHandoffRules = {
  enabled: boolean;
  userRequestPatterns: string[];
  sensitiveKeywords: string[];
  vipMetadataKeys: string[];
  aiFailureThreshold: number;
};

export type AIConfiguration = {
  id: string;
  provider: AIProviderName;
  model: string;
  temperature: number;
  maxContextMessages: number;
  systemPrompt: string;
  fallbackMessage: string;
  enableKnowledgeBase: boolean;
  enableTools: boolean;
  knowledgeBaseIds: string[];
  autoHandoff: AutoHandoffRules;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeDocument = {
  id: string;
  knowledgeBaseId: string;
  title: string;
  sourceType: "manual" | "markdown" | "text" | "external";
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunk = {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  content: string;
  ordinal: number;
  tokens: string[];
  createdAt: string;
};

export type KnowledgeSearchResult = KnowledgeChunk & {
  score: number;
  documentTitle: string;
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
  createdAt: string;
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

export type StoreData = {
  users: User[];
  conversations: Conversation[];
  messages: Message[];
  webhookEndpoints: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  toolInvocationLogs: ToolInvocationLog[];
  aiConfiguration?: AIConfiguration;
  knowledgeBases: KnowledgeBase[];
  knowledgeDocuments: KnowledgeDocument[];
  knowledgeChunks: KnowledgeChunk[];
  auditLogs: AuditLog[];
  agentStatuses: AgentStatus[];
};

export type ConversationWithMessages = Conversation & {
  messages: Message[];
  takenOverBy?: Pick<User, "id" | "username" | "role">;
};
