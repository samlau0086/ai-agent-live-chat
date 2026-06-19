import { NextResponse } from "next/server";
import { clearAgentSession, getAgent } from "@/lib/auth";
import { store } from "@/lib/store";

export async function POST() {
  const user = await getAgent();
  await clearAgentSession();
  if (user) {
    await store.addAuditLog({
      actorId: user.id,
      action: "auth.logout",
      targetType: "User",
      targetId: user.id,
      metadata: { username: user.username },
    });
  }
  return NextResponse.json({ ok: true });
}
