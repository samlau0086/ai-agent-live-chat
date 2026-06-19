import { NextResponse } from "next/server";
import { store } from "@/lib/store";

const setupUsername = process.env.ADMIN_USERNAME ?? "admin";

export async function GET() {
  const admin = await store.findUserByUsername(setupUsername);
  const health = await store.getSystemHealth();
  const securitySettings = await store.getSecuritySettings();
  const setupRequired = Boolean(admin && admin.role === "admin" && admin.forcePasswordChange);

  return NextResponse.json({
    setupRequired,
    adminUsername: setupUsername,
    storage: health.storage,
    database: health.database,
    secrets: health.secrets,
    securitySettings,
  });
}
