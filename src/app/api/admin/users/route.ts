import { NextResponse } from "next/server";
import { getPasswordChangeState, requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { SecuritySettings, User, UserRole } from "@/lib/types";

function publicUser(user: User, securitySettings: SecuritySettings) {
  const passwordChange = getPasswordChangeState(user, securitySettings);
  return {
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
  };
}

export async function GET() {
  const auth = await requireAdminRequest("admin.users.read");
  if (auth.response) return auth.response;
  const securitySettings = await store.getSecuritySettings();
  return NextResponse.json({ users: (await store.listUsers()).map((user) => publicUser(user, securitySettings)) });
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.users.create");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    role?: UserRole;
    disabled?: boolean;
    forcePasswordChange?: boolean;
  };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "").trim();
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const securitySettings = await store.getSecuritySettings();
    const user = await store.createUser(
      {
        username,
        password,
        role: body.role ?? "agent",
        disabled: body.disabled,
        forcePasswordChange: body.forcePasswordChange,
      },
      auth.user.id,
    );
    return NextResponse.json({ user: publicUser(user, securitySettings) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create user" }, { status: 400 });
  }
}
