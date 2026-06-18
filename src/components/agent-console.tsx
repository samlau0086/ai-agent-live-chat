"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ConversationWithMessages } from "@/lib/types";

type User = { id: string; username: string; role: "admin" | "agent" | "viewer" };

export function AgentConsole() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [conversations, setConversations] = useState<ConversationWithMessages[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [conversationQuery, setConversationQuery] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0],
    [conversations, selectedId],
  );
  const visibleConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const statusMatches = statusFilter === "all" || conversation.status === statusFilter;
      const text = `${conversation.subject ?? ""} ${conversation.messages.at(-1)?.content ?? ""}`.toLowerCase();
      return statusMatches && (!query || text.includes(query));
    });
  }, [conversationQuery, conversations, statusFilter]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((json) => setUser(json.user ?? null));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/agent/conversations")
      .then((response) => response.json())
      .then((json) => {
        setConversations(json.conversations ?? []);
        setSelectedId((current) => current ?? json.conversations?.[0]?.id);
      });

    const source = new EventSource("/api/agent/conversations?stream=1");
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.conversations) {
        setConversations(payload.conversations);
        setSelectedId((current) => current ?? payload.conversations?.[0]?.id);
        return;
      }
      setConversations((items) => {
        const next = items.filter((item) => item.id !== payload.id);
        return [payload, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    };
    return () => source.close();
  }, [user]);

  useEffect(() => {
    if (!selected?.id || !user) return;
    const source = new EventSource(`/api/agent/conversations/${selected.id}/stream`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ConversationWithMessages;
      setConversations((items) => {
        const next = items.filter((item) => item.id !== payload.id);
        return [payload, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    };
    return () => source.close();
  }, [selected?.id, user]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Login failed");
      return;
    }
    setUser(json.user);
  }

  async function action(path: string, body?: unknown) {
    if (!selected) return;
    setError("");
    const response = await fetch(`/api/agent/conversations/${selected.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Action failed");
      return;
    }
    if (json.conversation) {
      setConversations((items) => {
        const next = items.filter((item) => item.id !== json.conversation.id);
        return [json.conversation, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = reply.trim();
    if (!content) return;
    setReply("");
    await action("messages", { content });
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 text-[#1d2433]">
        <form onSubmit={submitLogin} className="w-full max-w-sm border border-[#ccd5e4] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-[#111827]">Agent sign in</h1>
          <p className="mt-1 text-sm text-[#64748b]">Default local account: admin / admin123</p>
          <label className="mt-5 block text-sm font-medium">
            Username
            <input
              className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Password
            <input
              className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="mt-3 text-sm text-[#b42318]">{error}</p> : null}
          <button className="mt-5 w-full rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#1d2433]">
      <header className="flex items-center justify-between border-b border-[#d9e1ee] bg-white px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Agent console</h1>
          <p className="text-sm text-[#64748b]">
            Signed in as {user.username} ({user.role})
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium" href="/agent/settings">
            Settings
          </Link>
          <Link className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium" href="/">
            Visitor view
          </Link>
        </div>
      </header>

      <div className="grid h-[calc(100vh-73px)] grid-cols-[340px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[#d9e1ee] bg-white">
          <div className="border-b border-[#e1e7f0] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Conversations</h2>
            <input
              className="mt-3 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
              placeholder="Search conversations"
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.target.value)}
            />
            <select
              className="mt-2 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="ai_active">AI active</option>
              <option value="queued_for_human">Queued</option>
              <option value="human_active">Human active</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          {visibleConversations.length === 0 ? (
            <p className="p-4 text-sm leading-6 text-[#64748b]">No conversations yet. Open the visitor page and send a message.</p>
          ) : (
            visibleConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`block w-full border-b border-[#eef2f7] p-4 text-left transition hover:bg-[#f4f7fb] ${
                  selected?.id === conversation.id ? "bg-[#edf3f8]" : "bg-white"
                }`}
                onClick={() => setSelectedId(conversation.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="truncate text-sm text-[#111827]">{conversation.subject ?? "New conversation"}</strong>
                  <span className="shrink-0 rounded-md bg-[#eef2f7] px-2 py-1 text-xs text-[#475569]">
                    {conversation.status}
                  </span>
                </div>
                <p className="mt-2 truncate text-sm text-[#64748b]">
                  {conversation.messages.at(-1)?.content ?? "No messages"}
                </p>
              </button>
            ))
          )}
        </aside>

        <section className="flex min-w-0 flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-[#d9e1ee] bg-white px-5 py-4">
                <div>
                  <h2 className="font-semibold text-[#111827]">{selected.subject ?? selected.id}</h2>
                  <p className="text-sm text-[#64748b]">
                    {selected.status}
                    {selected.takenOverBy ? ` by ${selected.takenOverBy.username}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-md bg-[#2e6f57] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
                    disabled={
                      selected.status === "human_active" ||
                      selected.status === "closed" ||
                      selected.status === "resolved"
                    }
                    onClick={() => action("takeover")}
                  >
                    Take over
                  </button>
                  <button
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                    disabled={selected.status !== "human_active"}
                    onClick={() => action("release")}
                  >
                    Release
                  </button>
                  <button
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                    disabled={selected.status === "closed" || selected.status === "resolved"}
                    onClick={() => action("resolve")}
                  >
                    Resolve
                  </button>
                  <button
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                    disabled={selected.status === "closed"}
                    onClick={() => action("close")}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {selected.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-3xl border px-3 py-2 text-sm leading-6 ${
                      message.role === "visitor"
                        ? "border-[#2f6f95] bg-[#e9f3f8]"
                        : message.role === "human_agent"
                          ? "ml-auto border-[#2e6f57] bg-[#edf7f3]"
                          : message.role === "system"
                            ? "mx-auto border-[#d6dae3] bg-white text-[#64748b]"
                            : "border-[#d9c6a3] bg-[#fff8e8]"
                    }`}
                  >
                    <div className="mb-1 text-xs font-semibold uppercase tracking-normal text-[#475569]">
                      {message.role}
                    </div>
                    {message.content}
                  </div>
                ))}
              </div>

              <form onSubmit={submitReply} className="border-t border-[#d9e1ee] bg-white p-4">
                {error ? <p className="mb-2 text-sm text-[#b42318]">{error}</p> : null}
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-3 py-2 text-sm outline-none focus:border-[#3c6e9f]"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder={
                      selected.status === "human_active"
                        ? "Reply as human agent"
                        : "Take over before replying"
                    }
                    disabled={selected.status !== "human_active"}
                  />
                  <button
                    className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
                    disabled={selected.status !== "human_active" || !reply.trim()}
                  >
                    Reply
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[#64748b]">
              Select or create a conversation.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
