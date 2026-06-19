import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { replayWebhookDelivery } from "@/lib/webhooks";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRequest("admin.webhooks.deliveries.replay");
  if (auth.response) return auth.response;

  const { id } = await context.params;
  try {
    const delivery = await replayWebhookDelivery(id);
    return NextResponse.json({ delivery });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook replay failed" },
      { status: 400 },
    );
  }
}
