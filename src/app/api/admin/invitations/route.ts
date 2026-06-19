import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth";
import { createInvitationToken, hashInvitationToken, invitationAcceptUrl } from "@/lib/invitations";
import { store } from "@/lib/store";
import type { UserInvitation, UserRole } from "@/lib/types";

const roles: UserRole[] = ["admin", "agent", "viewer"];

function publicInvitation(invitation: UserInvitation) {
  return {
    id: invitation.id,
    username: invitation.username,
    role: invitation.role,
    invitedById: invitation.invitedById,
    acceptedUserId: invitation.acceptedUserId,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

export async function GET() {
  const auth = await requireAdminRequest("admin.invitations.read");
  if (auth.response) return auth.response;
  const invitations = await store.listUserInvitations();
  return NextResponse.json({ invitations: invitations.map(publicInvitation) });
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest("admin.invitations.create");
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    role?: UserRole;
    expiresInDays?: number;
  };
  const username = String(body.username ?? "").trim();
  const role = body.role && roles.includes(body.role) ? body.role : "agent";
  const expiresInDays = Math.min(Math.max(Number(body.expiresInDays ?? 7), 1), 30);
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });

  const token = createInvitationToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const invitation = await store.createUserInvitation(
      {
        username,
        role,
        tokenHash: hashInvitationToken(token),
        expiresAt,
      },
      auth.user.id,
    );
    return NextResponse.json({
      invitation: publicInvitation(invitation),
      token,
      acceptUrl: invitationAcceptUrl(request.url, token),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create invitation" },
      { status: 400 },
    );
  }
}
