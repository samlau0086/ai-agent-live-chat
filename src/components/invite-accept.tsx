"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type InvitationStatus = {
  ok: boolean;
  status: "active" | "not_found" | "accepted" | "revoked" | "expired";
  invitation?: {
    username: string;
    role: "admin" | "agent" | "viewer";
    expiresAt: string;
  };
};

export function InviteAccept({ token }: { token: string }) {
  const [status, setStatus] = useState<InvitationStatus>();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then((response) => response.json())
      .then((json: InvitationStatus) => setStatus(json))
      .catch(() => setError("Failed to load invitation."));
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to accept invitation.");
      return;
    }
    setAccepted(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 text-[#1d2433]">
      <section className="w-full max-w-md border border-[#ccd5e4] bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-[#111827]">Accept invitation</h1>
        {accepted ? (
          <div className="mt-5 border border-[#b7d7c8] bg-[#f0faf5] p-4 text-sm text-[#24543f]">
            Account created. Your session is active.
            <div className="mt-4">
              <Link className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white" href="/agent">
                Open agent console
              </Link>
            </div>
          </div>
        ) : status?.ok && status.invitation ? (
          <form onSubmit={accept} className="mt-5 grid gap-4">
            <p className="text-sm text-[#64748b]">
              Create the password for {status.invitation.username} ({status.invitation.role}). This invitation expires{" "}
              {new Date(status.invitation.expiresAt).toLocaleString()}.
            </p>
            <label className="block text-sm font-medium">
              Password
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Confirm password
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
            <button
              className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
              disabled={!password || !confirmPassword}
            >
              Create account
            </button>
          </form>
        ) : (
          <div className="mt-5 border border-[#f1b8b8] bg-[#fff5f5] p-4 text-sm text-[#b42318]">
            {error || `Invitation is ${status?.status ?? "unavailable"}.`}
          </div>
        )}
      </section>
    </main>
  );
}
