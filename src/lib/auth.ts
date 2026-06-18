import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hmac, randomId, safeEqual, verifyPassword } from "./crypto";
import { store } from "./store";
import type { User } from "./types";

const agentCookie = "agent_session";
const visitorCookie = "visitor_session";

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
    return user ? { id: user.id, username: user.username, role: user.role } : undefined;
  } catch {
    return undefined;
  }
}

export async function login(username: string, password: string) {
  const user = await store.findUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) return undefined;
  return { id: user.id, username: user.username, role: user.role };
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
