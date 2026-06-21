import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { NotificationConfiguration } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.notification_config.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ notificationConfig: await store.getNotificationConfiguration() });
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.notification_config.update");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Partial<NotificationConfiguration>;
  const notificationConfig = await store.updateNotificationConfiguration(
    {
      enabled: body.enabled,
      emailEnabled: body.emailEnabled,
      emailRecipients: body.emailRecipients,
      barkEnabled: body.barkEnabled,
      barkServerUrl: body.barkServerUrl,
      barkDeviceKeys: body.barkDeviceKeys,
      newMessage: body.newMessage,
      unreplied: body.unreplied,
    },
    auth.user.id,
  );
  return NextResponse.json({ notificationConfig });
}
