import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { isMissingTableError, migrationRequiredResponseBody } from "@/lib/prisma-errors";
import { store } from "@/lib/store";
import type { EmailConfiguration } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.email_config.read");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ emailConfig: await store.getEmailConfiguration() });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(migrationRequiredResponseBody("EmailConfiguration"), { status: 503 });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.email_config.update");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Partial<EmailConfiguration>;
  try {
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
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(migrationRequiredResponseBody("EmailConfiguration"), { status: 503 });
    }
    throw error;
  }
}
