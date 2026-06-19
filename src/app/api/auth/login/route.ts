import { NextResponse } from "next/server";
import { accountLocked, login, setAgentSession } from "@/lib/auth";
import { store } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? "");
  const existingBeforeLogin = username ? await store.findUserByUsername(username) : undefined;
  const user = await login(username, String(body.password ?? ""));
  if (!user) {
    const existingUser = existingBeforeLogin?.id ? await store.findUserById(existingBeforeLogin.id) : undefined;
    const locked = Boolean(existingUser?.lockedUntil && new Date(existingUser.lockedUntil).getTime() > Date.now());
    await store.addAuditLog({
      actorId: existingUser?.id,
      action: "auth.login_failed",
      targetType: existingUser ? "User" : "Auth",
      targetId: existingUser?.id,
      metadata: {
        username,
        reason: locked ? "account_locked" : existingUser?.disabled ? "disabled_user" : "invalid_credentials",
        failedLoginCount: existingUser?.failedLoginCount,
        lockedUntil: existingUser?.lockedUntil,
      },
    });
    if (locked) return accountLocked();
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  await setAgentSession(user);
  await store.addAuditLog({
    actorId: user.id,
    action: "auth.login",
    targetType: "User",
    targetId: user.id,
    metadata: { username: user.username },
  });
  return NextResponse.json({ user });
}
