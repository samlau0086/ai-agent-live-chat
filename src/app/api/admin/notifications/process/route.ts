import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { processUnrepliedReminders } from "@/lib/notifications";

export async function POST() {
  const auth = await requireAdminRequest("admin.notifications.process");
  if (auth.response) return auth.response;
  await processUnrepliedReminders();
  return NextResponse.json({ ok: true });
}
