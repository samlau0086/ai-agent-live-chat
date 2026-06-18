export type UserRole = "admin" | "agent";
export type ConversationStatus = "ai_active" | "human_active" | "closed";
export type MessageRole = "visitor" | "ai" | "human_agent" | "system" | "tool";
export type WebhookEvent =
  | "conversation.created"
  | "message.created"
  | "handoff.started"
  | "handoff.released"
  | "conversation.closed";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
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
};

export type ConversationWithMessages = Conversation & {
  messages: Message[];
  takenOverBy?: Pick<User, "id" | "username" | "role">;
};
