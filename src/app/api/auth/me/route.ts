import { NextResponse } from "next/server";
import { getAgent } from "@/lib/auth";

export async function GET() {
  const user = await getAgent();
  return NextResponse.json({ user });
}
