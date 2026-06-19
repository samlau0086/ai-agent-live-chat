import { hmac, randomToken } from "./crypto";

const defaultSessionSecret = "dev-session-secret-change-me";

function invitationSecret() {
  return process.env.SESSION_SECRET ?? defaultSessionSecret;
}

export function createInvitationToken() {
  return randomToken(32);
}

export function hashInvitationToken(token: string) {
  return hmac(token, invitationSecret());
}

export function invitationAcceptUrl(requestUrl: string, token: string) {
  const url = new URL(requestUrl);
  return `${url.origin}/invite/${encodeURIComponent(token)}`;
}
