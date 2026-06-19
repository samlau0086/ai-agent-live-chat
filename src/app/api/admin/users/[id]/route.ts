import { NextResponse } from "next/server";
import { getPasswordChangeState, requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { UserRole } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.users.update");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
    role?: UserRole;
    disabled?: boolean;
    forcePasswordChange?: boolean;
    unlock?: boolean;
  };
  if (body.password !== undefined && String(body.password).trim().length < 6) {
    return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const user = await store.updateUser(
      id,
      {
        password: body.password ? String(body.password) : undefined,
        role: body.role,
        disabled: body.disabled,
        forcePasswordChange: body.forcePasswordChange,
        unlock: body.unlock,
      },
      auth.user.id,
    );
    const securitySettings = await store.getSecuritySettings();
    const passwordChange = getPasswordChangeState(user, securitySettings);
    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        disabled: user.disabled,
        failedLoginCount: user.failedLoginCount,
        lockedUntil: user.lockedUntil,
        passwordChangedAt: user.passwordChangedAt,
        forcePasswordChange: user.forcePasswordChange,
        passwordChangeRequired: passwordChange.required,
        passwordChangeReason: passwordChange.reason,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update user" }, { status: 404 });
  }
}
