import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { processUnrepliedReminders } from "@/lib/notifications";
import { isMissingTableError, migrationRequiredResponseBody } from "@/lib/prisma-errors";

export async function POST() {
  const auth = await requireAdminRequest("admin.notifications.process");
  if (auth.response) return auth.response;
  try {
    await processUnrepliedReminders();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(migrationRequiredResponseBody("NotificationConfiguration"), { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process notifications." },
      { status: 400 },
    );
  }
}
