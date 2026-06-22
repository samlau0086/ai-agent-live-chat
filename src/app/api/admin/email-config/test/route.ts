import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { sendConfiguredEmail } from "@/lib/email";
import { isMissingTableError, migrationRequiredResponseBody } from "@/lib/prisma-errors";
import { store } from "@/lib/store";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.email_config.test");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { to?: string };
  const to = String(body.to ?? "").trim();
  if (!validEmail(to)) return NextResponse.json({ error: "Valid recipient email is required." }, { status: 400 });

  try {
    const result = await sendConfiguredEmail({
      to,
      subject: "Live chat email test",
      text: "This is a test email from AI Agent Live Chat.",
    });
    await store.addAuditLog({
      actorId: auth.user.id,
      action: "email_config.test",
      targetType: "EmailConfiguration",
      targetId: "global",
      metadata: { to, provider: result.provider, ok: true },
    });
    return NextResponse.json({ ok: true, provider: result.provider });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(migrationRequiredResponseBody("EmailConfiguration"), { status: 503 });
    }
    await store.addAuditLog({
      actorId: auth.user.id,
      action: "email_config.test.failed",
      targetType: "EmailConfiguration",
      targetId: "global",
      metadata: { to, error: error instanceof Error ? error.message : "Email test failed" },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email test failed" },
      { status: 400 },
    );
  }
}
