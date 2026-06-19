import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export async function GET() {
  const auth = await requireAdminRequest("admin.security_settings.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ securitySettings: await store.getSecuritySettings() });
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.security_settings.update");
  if (auth.response) return auth.response;

  const current = await store.getSecuritySettings();
  const body = (await request.json().catch(() => ({}))) as {
    failedLoginLockoutThreshold?: unknown;
    lockoutMinutes?: unknown;
    passwordRotationDays?: unknown;
  };
  const securitySettings = await store.updateSecuritySettings(
    {
      failedLoginLockoutThreshold: positiveInteger(
        body.failedLoginLockoutThreshold,
        current.failedLoginLockoutThreshold,
      ),
      lockoutMinutes: positiveInteger(body.lockoutMinutes, current.lockoutMinutes),
      passwordRotationDays: nonNegativeInteger(body.passwordRotationDays, current.passwordRotationDays),
    },
    auth.user.id,
  );

  return NextResponse.json({ securitySettings });
}
