"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type SetupStatus = {
  setupRequired: boolean;
  adminUsername: string;
  storage: string;
  database: {
    ok: boolean;
    provider: string;
    migrationStatus: string;
  };
  secrets: {
    sessionSecretConfigured: boolean;
    webhookSigningSecretConfigured: boolean;
    insecureDefaults: string[];
  };
};

export function SetupWizard() {
  const [status, setStatus] = useState<SetupStatus>();
  const [username, setUsername] = useState("admin");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((response) => response.json())
      .then((json: SetupStatus) => {
        setStatus(json);
        setUsername(json.adminUsername);
      })
      .catch(() => setError("Failed to load setup status."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    const response = await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, currentPassword, newPassword }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Setup failed.");
      return;
    }
    setCompleted(true);
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-8 text-[#1d2433]">
      <section className="mx-auto max-w-2xl border border-[#ccd5e4] bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#2e6f57]">First-run setup</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#111827]">Secure the admin account</h1>

        {status ? (
          <div className="mt-5 grid gap-2 text-sm text-[#51607a] sm:grid-cols-2">
            <div className="border border-[#e1e7f0] p-3">Storage: {status.storage}</div>
            <div className="border border-[#e1e7f0] p-3">
              Database: {status.database.provider} / {status.database.migrationStatus}
            </div>
            <div className="border border-[#e1e7f0] p-3">
              Session secret: {status.secrets.sessionSecretConfigured ? "configured" : "needs attention"}
            </div>
            <div className="border border-[#e1e7f0] p-3">
              Webhook secret: {status.secrets.webhookSigningSecretConfigured ? "configured" : "needs attention"}
            </div>
          </div>
        ) : null}

        {completed ? (
          <div className="mt-6 border border-[#b7d7c8] bg-[#f0faf5] p-4 text-sm text-[#24543f]">
            Setup completed. The admin session is active.
            <div className="mt-4">
              <Link className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white" href="/agent">
                Open agent console
              </Link>
            </div>
          </div>
        ) : status && !status.setupRequired ? (
          <div className="mt-6 border border-[#d9e1ee] bg-[#f8fafc] p-4 text-sm text-[#51607a]">
            Setup is not required for this deployment.
            <div className="mt-4">
              <Link className="rounded-md border border-[#b9c2d4] px-4 py-2 text-sm font-semibold" href="/agent">
                Open agent console
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <label className="block text-sm font-medium">
              Admin username
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Current admin password
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              New admin password
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Confirm new password
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
              disabled={!username || !currentPassword || !newPassword || !confirmPassword}
            >
              Complete setup
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
