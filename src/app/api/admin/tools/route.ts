import { NextResponse } from "next/server";
import { getAgent, unauthorized } from "@/lib/auth";
import { tools } from "@/lib/tools";

export async function GET() {
  const user = await getAgent();
  if (!user) return unauthorized();
  return NextResponse.json({
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  });
}
