import type { ConversationWithMessages } from "./types";

export function hasRequiredVisitorProfile(conversation: ConversationWithMessages) {
  return Boolean(conversation.customerProfile?.name?.trim() && conversation.customerProfile?.email?.trim());
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
