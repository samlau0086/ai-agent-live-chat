import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hmac, randomId, safeEqual, verifyPassword } from "./crypto";
import { store } from "./store";
import type { SecuritySettings, User, UserRole } from "./types";

const agentCookie = "agent_session";
const visitorCookie = "visitor_session";
const lockMessage = "Account is temporarily locked";

function isLocked(user: Pick<User, "lockedUntil">) {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

export function getPasswordChangeState(
  user: Pick<User, "forcePasswordChange" | "passwordChangedAt">,
  settings: Pick<SecuritySettings, "passwordRotationDays">,
) {
  if (user.forcePasswordChange) {
    return { required: true, reason: "forced" as const };
  }

  if (settings.passwordRotationDays <= 0) {
    return { required: false, reason: undefined };
  }

  if (!user.passwordChangedAt) {
    return { required: true, reason: "rotation" as const };
  }

  const changedAt = new Date(user.passwordChangedAt).getTime();
  if (!Number.isFinite(changedAt)) {
    return { required: true, reason: "rotation" as const };
  }

  const maxAgeMs = settings.passwordRotationDays * 24 * 60 * 60 * 1000;
  return Date.now() - changedAt > maxAgeMs
    ? { required: true, reason: "rotation" as const }
    : { required: false, reason: undefined };
}

async function toSessionUser(user: User) {
  const securitySettings = await store.getSecuritySettings();
  const passwordChange = getPasswordChangeState(user, securitySettings);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    locale: user.locale,
    forcePasswordChange: passwordChange.required,
    passwordChangeReason: passwordChange.reason,
  };
}

function sessionSecret() {
  return process.env.SESSION_SECRET ?? "dev-session-secret-change-me";
}

function sign(value: string) {
  return hmac(value, sessionSecret());
}

function encodeSession(user: Pick<User, "id" | "username" | "role">) {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

async function decodeSession(value?: string) {
  if (!value) return undefined;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Pick<
      User,
      "id" | "username" | "role"
    >;
    const user = await store.findUserById(parsed.id);
    return user && !user.disabled && !isLocked(user) ? toSessionUser(user) : undefined;
  } catch {
    return undefined;
  }
}

export async function login(username: string, password: string) {
  const user = await store.findUserByUsername(username);
  if (!user || user.disabled || isLocked(user)) return undefined;
  if (!verifyPassword(password, user.passwordHash)) {
    await store.recordFailedLogin(user.id);
    return undefined;
  }
  await store.recordSuccessfulLogin(user.id);
  return toSessionUser(user);
}

export async function setAgentSession(user: Pick<User, "id" | "username" | "role">) {
  const cookieStore = await cookies();
  cookieStore.set(agentCookie, encodeSession(user), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearAgentSession() {
  const cookieStore = await cookies();
  cookieStore.delete(agentCookie);
}

export async function requireAgent() {
  const user = await getAgent();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function getAgent() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(agentCookie)?.value);
}

export async function getOrCreateVisitorSession() {
  const cookieStore = await cookies();
  let visitorSessionId = cookieStore.get(visitorCookie)?.value;
  if (!visitorSessionId) {
    visitorSessionId = randomId("vis");
    cookieStore.set(visitorCookie, visitorSessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return visitorSessionId;
}

export async function getVisitorSession() {
  const cookieStore = await cookies();
  return cookieStore.get(visitorCookie)?.value;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function accountLocked() {
  return NextResponse.json({ error: lockMessage }, { status: 423 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

type AuthResult =
  | {
      user: Pick<User, "id" | "username" | "role" | "locale" | "forcePasswordChange"> & {
        passwordChangeReason?: "forced" | "rotation";
      };
      response?: never;
    }
  | { user?: never; response: NextResponse };

export async function requireRoleRequest(allowedRoles: UserRole[], scope: string): Promise<AuthResult> {
  const user = await getAgent();
  if (!user) {
    await store.addAuditLog({
      action: "auth.unauthorized",
      targetType: "Auth",
      metadata: { scope, allowedRoles },
    });
    return { response: unauthorized() };
  }

  if (!allowedRoles.includes(user.role)) {
    await store.addAuditLog({
      actorId: user.id,
      action: "auth.forbidden",
      targetType: "User",
      targetId: user.id,
      metadata: { scope, role: user.role, allowedRoles },
    });
    return { response: forbidden(`${allowedRoles.join(" or ")} role required`) };
  }

  if (user.forcePasswordChange) {
    await store.addAuditLog({
      actorId: user.id,
      action: "auth.password_change_required",
      targetType: "User",
      targetId: user.id,
      metadata: { scope, reason: user.passwordChangeReason },
    });
    return {
      response: forbidden(
        user.passwordChangeReason === "rotation" ? "Password rotation required" : "Password change required",
      ),
    };
  }

  return { user };
}

export function requireAdminRequest(scope: string) {
  return requireRoleRequest(["admin"], scope);
}

export async function requireActiveAgentRequest(scope: string): Promise<AuthResult> {
  return requireRoleRequest(["admin", "agent", "viewer"], scope);
}
