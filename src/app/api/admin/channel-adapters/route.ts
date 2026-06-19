import { NextResponse } from "next/server";
import { requireRoleRequest } from "@/lib/auth";
import { channelAdapters } from "@/lib/channel-adapters";

export async function GET() {
  const auth = await requireRoleRequest(["admin", "viewer"], "admin.channel_adapters.read");
  if (auth.response) return auth.response;
  return NextResponse.json({ adapters: channelAdapters });
}
