import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { isMissingTableError, migrationRequiredResponseBody } from "@/lib/prisma-errors";
import { store } from "@/lib/store";
import type { NotificationConfiguration } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.notification_config.read");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ notificationConfig: await store.getNotificationConfiguration() });
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(migrationRequiredResponseBody("NotificationConfiguration"), { status: 503 });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.notification_config.update");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Partial<NotificationConfiguration>;
  try {
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
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(migrationRequiredResponseBody("NotificationConfiguration"), { status: 503 });
    }
    throw error;
  }
}
