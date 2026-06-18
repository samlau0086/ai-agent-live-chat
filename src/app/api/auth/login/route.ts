import { NextResponse } from "next/server";
import { login, setAgentSession } from "@/lib/auth";
import { store } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const user = await login(String(body.username ?? ""), String(body.password ?? ""));
  if (!user) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });

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
