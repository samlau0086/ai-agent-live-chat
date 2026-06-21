import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { sendTestNotification } from "@/lib/notifications";

export async function POST() {
  const auth = await requireAdminRequest("admin.notification_config.test");
  if (auth.response) return auth.response;

  try {
    const result = await sendTestNotification();
    if (!result.ok) return NextResponse.json({ error: result.error || "Notification test failed" }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Notification test failed" },
      { status: 400 },
    );
  }
}
