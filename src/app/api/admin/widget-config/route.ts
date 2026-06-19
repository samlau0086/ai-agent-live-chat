import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { store } from "@/lib/store";
import type { WidgetConfiguration } from "@/lib/types";

export async function GET() {
  const auth = await requireAdminRequest("admin.widget_config.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ widgetConfig: await store.getWidgetConfiguration() });
}

export async function PUT(request: Request) {
  const auth = await requireAdminRequest("admin.widget_config.update");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Partial<WidgetConfiguration>;
  const widgetConfig = await store.updateWidgetConfiguration(
    {
      themeColor: body.themeColor,
      welcomeMessage: body.welcomeMessage,
      offlineMessage: body.offlineMessage,
      enableSatisfaction: body.enableSatisfaction,
      enableTranscriptDownload: body.enableTranscriptDownload,
      requireEndConfirmation: body.requireEndConfirmation,
    },
    auth.user.id,
  );
  return NextResponse.json({ widgetConfig });
}
