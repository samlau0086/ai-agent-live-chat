import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { EmailConfiguration } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.email_config.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ emailConfig: await store.getEmailConfiguration() });
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.email_config.update");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Partial<EmailConfiguration>;
  const emailConfig = await store.updateEmailConfiguration(
    {
      provider: body.provider,
      enabled: body.enabled,
      fromEmail: body.fromEmail,
      fromName: body.fromName,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpSecure: body.smtpSecure,
      smtpUsername: body.smtpUsername,
      smtpPasswordEnv: body.smtpPasswordEnv,
      resendApiKeyEnv: body.resendApiKeyEnv,
      replyToEmail: body.replyToEmail,
    },
    auth.user.id,
  );
  return NextResponse.json({ emailConfig });
}
