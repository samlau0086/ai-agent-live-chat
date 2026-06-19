import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { store } from "@/lib/store";

export async function POST(request: Request) {
  const sessionUser = await getAgent();
  if (!sessionUser) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (newPassword.trim().length < 8) {
    return NextResponse.json({ error: "new password must be at least 8 characters" }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "new password must be different" }, { status: 400 });
  }

  const user = await store.findUserById(sessionUser.id);
  if (!user || user.disabled) return unauthorized();
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    await store.addAuditLog({
      actorId: user.id,
      action: "auth.password_change_failed",
      targetType: "User",
      targetId: user.id,
      metadata: { reason: "invalid_current_password" },
    });
    return NextResponse.json({ error: "current password is incorrect" }, { status: 401 });
  }

  const updated = await store.updateUser(
    user.id,
    {
      password: newPassword,
      forcePasswordChange: false,
      unlock: true,
    },
    user.id,
  );
  await store.addAuditLog({
    actorId: user.id,
    action: "auth.password_changed",
    targetType: "User",
    targetId: user.id,
    metadata: { selfService: true },
  });

  return NextResponse.json({
    user: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      forcePasswordChange: updated.forcePasswordChange,
      passwordChangeReason: undefined,
    },
  });
}
