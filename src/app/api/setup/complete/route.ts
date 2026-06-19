import { NextResponse } from "next/server";
import { setAgentSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { store } from "@/lib/store";

const setupUsername = process.env.ADMIN_USERNAME ?? "admin";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  };
  const username = String(body.username ?? "").trim();
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  if (username !== setupUsername) {
    return NextResponse.json({ error: "setup admin username is incorrect" }, { status: 400 });
  }
  if (newPassword.trim().length < 12) {
    return NextResponse.json({ error: "new password must be at least 12 characters" }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "new password must be different" }, { status: 400 });
  }

  const admin = await store.findUserByUsername(setupUsername);
  if (!admin || admin.role !== "admin" || !admin.forcePasswordChange) {
    return NextResponse.json({ error: "setup is not required" }, { status: 409 });
  }
  if (!verifyPassword(currentPassword, admin.passwordHash)) {
    await store.addAuditLog({
      actorId: admin.id,
      action: "setup.failed",
      targetType: "User",
      targetId: admin.id,
      metadata: { reason: "invalid_current_password" },
    });
    return NextResponse.json({ error: "current password is incorrect" }, { status: 401 });
  }

  const updated = await store.updateUser(
    admin.id,
    {
      password: newPassword,
      forcePasswordChange: false,
      unlock: true,
    },
    admin.id,
  );
  await store.addAuditLog({
    actorId: updated.id,
    action: "setup.completed",
    targetType: "User",
    targetId: updated.id,
    metadata: { username: updated.username },
  });
  await setAgentSession(updated);

  return NextResponse.json({
    user: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      forcePasswordChange: updated.forcePasswordChange,
    },
  });
}
