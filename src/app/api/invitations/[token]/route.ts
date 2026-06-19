import { NextResponse } from "next/server";
import { setAgentSession } from "@/lib/auth";
import { hashInvitationToken } from "@/lib/invitations";
import { store } from "@/lib/store";
import type { UserInvitation } from "@/lib/types";

function invitationStatus(invitation?: UserInvitation) {
  if (!invitation) return { ok: false, status: "not_found" };
  if (invitation.acceptedAt) return { ok: false, status: "accepted" };
  if (invitation.revokedAt) return { ok: false, status: "revoked" };
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) return { ok: false, status: "expired" };
  return { ok: true, status: "active" };
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invitation = await store.findUserInvitationByTokenHash(hashInvitationToken(decodeURIComponent(token)));
  const status = invitationStatus(invitation);
  return NextResponse.json({
    ...status,
    invitation: invitation
      ? {
          username: invitation.username,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        }
      : undefined,
  });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const password = String(body.password ?? "");
  if (password.trim().length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  try {
    const { user } = await store.acceptUserInvitation(hashInvitationToken(decodeURIComponent(token)), password);
    const sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      forcePasswordChange: false,
      passwordChangeReason: undefined,
    };
    await setAgentSession(sessionUser);
    return NextResponse.json({ user: sessionUser });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to accept invitation" },
      { status: 400 },
    );
  }
}
