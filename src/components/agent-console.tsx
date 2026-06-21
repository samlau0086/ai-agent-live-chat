"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminText } from "@/lib/admin-i18n";
import type {
  AppLocale,
  ConversationStatus,
  ConversationWithMessages,
  CustomerProfile,
  Message,
  MessageAttachment,
} from "@/lib/types";

type User = {
  id: string;
  username: string;
  role: "admin" | "agent" | "viewer";
  locale: AppLocale;
  forcePasswordChange?: boolean;
  passwordChangeReason?: "forced" | "rotation";
};

type AgentOption = Pick<User, "id" | "username" | "role"> & {
  status: "online" | "away" | "offline";
  statusUpdatedAt?: string;
};

type StreamState = "connecting" | "live" | "reconnecting";

type CustomerProfileForm = Required<CustomerProfile>;

const slaWarningMs = 5 * 60 * 1000;
const slaBreachMs = 10 * 60 * 1000;

function toCustomerProfileForm(profile?: CustomerProfile): CustomerProfileForm {
  return {
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    externalId: profile?.externalId ?? "",
    plan: profile?.plan ?? "",
    notes: profile?.notes ?? "",
  };
}

function timeMs(value?: string) {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "-";
  if (ms < 0) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusDotClass(status: AgentOption["status"]) {
  if (status === "online") return "bg-[#2e6f57]";
  if (status === "away") return "bg-[#d97706]";
  return "bg-[#94a3b8]";
}

function statusPriority(status: ConversationWithMessages["status"]) {
  const priority: Record<ConversationWithMessages["status"], number> = {
    queued_for_human: 0,
    human_active: 1,
    ai_active: 2,
    resolved: 3,
    closed: 4,
  };
  return priority[status];
}

function conversationSla(conversation: ConversationWithMessages, now: number) {
  const firstVisitor = conversation.messages.find((message) => message.role === "visitor");
  const firstVisitorAt = timeMs(firstVisitor?.createdAt);
  const firstResponse = firstVisitorAt
    ? conversation.messages.find((message) => {
        const createdAt = timeMs(message.createdAt);
        return (
          createdAt !== undefined &&
          createdAt > firstVisitorAt &&
          (message.role === "ai" || message.role === "human_agent")
        );
      })
    : undefined;
  const firstResponseAt = timeMs(firstResponse?.createdAt);
  const visitorMessages = conversation.messages.filter((message) => message.role === "visitor");
  const lastVisitor = visitorMessages.at(-1);
  const lastVisitorAt = timeMs(lastVisitor?.createdAt);
  const lastHumanAfterVisitor =
    lastVisitorAt === undefined
      ? undefined
      : conversation.messages.find((message) => {
          const createdAt = timeMs(message.createdAt);
          return createdAt !== undefined && createdAt > lastVisitorAt && message.role === "human_agent";
        });
  const needsHumanResponse =
    (conversation.status === "queued_for_human" || conversation.status === "human_active") &&
    Boolean(lastVisitorAt) &&
    !lastHumanAfterVisitor;
  const waitMs = needsHumanResponse && lastVisitorAt !== undefined ? now - lastVisitorAt : undefined;
  const level = waitMs === undefined ? "normal" : waitMs >= slaBreachMs ? "breach" : waitMs >= slaWarningMs ? "warning" : "normal";
  return {
    firstResponseMs:
      firstVisitorAt !== undefined && firstResponseAt !== undefined ? Math.max(0, firstResponseAt - firstVisitorAt) : undefined,
    waitMs,
    level,
    lastVisitorAt,
  };
}

function slaRank(level: ReturnType<typeof conversationSla>["level"]) {
  return level === "breach" ? 0 : level === "warning" ? 1 : 2;
}

export function AgentConsole() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [conversations, setConversations] = useState<ConversationWithMessages[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentOption["status"]>("online");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [reply, setReply] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<ConversationStatus>("closed");
  const [conversationQuery, setConversationQuery] = useState("");
  const [readMessageCounts, setReadMessageCounts] = useState<Record<string, number>>({});
  const [tagInput, setTagInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [quickReplyInput, setQuickReplyInput] = useState("");
  const [profile, setProfile] = useState<CustomerProfileForm>(() => toCustomerProfileForm());
  const [translationEnabled, setTranslationEnabled] = useState<boolean | undefined>(undefined);
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  const [clock, setClock] = useState(() => Date.now());
  const [listStreamState, setListStreamState] = useState<StreamState>("connecting");
  const [conversationStreamState, setConversationStreamState] = useState<StreamState>("connecting");
  const [lastStreamEventAt, setLastStreamEventAt] = useState<number>();

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0],
    [conversations, selectedId],
  );
  const selectedConversationIdSet = useMemo(() => new Set(selectedConversationIds), [selectedConversationIds]);
  const bulkSelectedConversations = useMemo(
    () => conversations.filter((conversation) => selectedConversationIdSet.has(conversation.id)),
    [conversations, selectedConversationIdSet],
  );
  const selectedSla = selected ? conversationSla(selected, clock) : undefined;
  const visibleConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    return conversations
      .filter((conversation) => {
        const statusMatches = statusFilter === "all" || conversation.status === statusFilter;
        const assigneeMatches =
          assigneeFilter === "all" ||
          (assigneeFilter === "unassigned" ? !conversation.takenOverById : conversation.takenOverById === assigneeFilter);
        const text = `${conversation.subject ?? ""} ${conversation.messages.at(-1)?.content ?? ""}`.toLowerCase();
        return statusMatches && assigneeMatches && (!query || text.includes(query));
      })
      .sort((left, right) => {
        const leftSla = conversationSla(left, clock);
        const rightSla = conversationSla(right, clock);
        return (
          slaRank(leftSla.level) - slaRank(rightSla.level) ||
          statusPriority(left.status) - statusPriority(right.status) ||
          (rightSla.waitMs ?? 0) - (leftSla.waitMs ?? 0) ||
          right.updatedAt.localeCompare(left.updatedAt)
        );
      });
  }, [assigneeFilter, clock, conversationQuery, conversations, statusFilter]);
  const canMutate = user?.role === "admin" || user?.role === "agent";
  const text = adminText(user?.locale);

  function translationMetadata(message: Message) {
    const translation = message.metadata.translation;
    return translation && typeof translation === "object" && !Array.isArray(translation)
      ? (translation as Record<string, unknown>)
      : {};
  }

  function displayMessageContent(message: Message) {
    if (showOriginal[message.id]) return message.content;
    const translation = translationMetadata(message);
    if (message.role === "visitor" && typeof translation.agentText === "string") return translation.agentText;
    return message.content;
  }

  function messageAttachments(message: Message) {
    const value = message.metadata.attachments;
    return Array.isArray(value) ? (value.filter(Boolean) as MessageAttachment[]) : [];
  }

  function renderAttachment(attachment: MessageAttachment) {
    if (attachment.kind === "image") {
      return (
        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mt-2 max-h-56 max-w-full border border-[#cbd5e1] object-contain" src={attachment.url} alt={attachment.fileName} />
        </a>
      );
    }
    if (attachment.kind === "video") {
      return (
        <video key={attachment.id} className="mt-2 max-h-56 max-w-full border border-[#cbd5e1]" controls src={attachment.url}>
          <a href={attachment.url}>{attachment.fileName}</a>
        </video>
      );
    }
    return (
      <a
        key={attachment.id}
        className="mt-2 block rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-xs font-medium underline"
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
      >
        {attachment.fileName}
      </a>
    );
  }

  function syncOperationForm(conversation: ConversationWithMessages) {
    setTagInput((conversation.tags ?? []).map((tag) => tag.name).join(", "));
    setQuickReplyInput((conversation.quickReplies ?? []).join("\n"));
    setProfile(toCustomerProfileForm(conversation.customerProfile));
    const translation = conversation.metadata.translation;
    setTranslationEnabled(
      translation && typeof translation === "object" && !Array.isArray(translation)
        ? (translation as { enabled?: boolean }).enabled
        : undefined,
    );
  }

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((json) => {
        if (!active) return;
        setUser(json.user ?? null);
        if (json.user && json.user.role !== "viewer") {
          void updateAgentStatus("online");
        }
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user || user.forcePasswordChange) return;
    const loadSnapshot = async () => {
      const [conversationsResponse, agentsResponse] = await Promise.all([
        fetch("/api/agent/conversations"),
        fetch("/api/agent/agents"),
      ]);
      if (conversationsResponse.ok) {
        const json = await conversationsResponse.json();
        const incoming = (json.conversations ?? []) as ConversationWithMessages[];
        setConversations(incoming);
        setSelectedId((current) => current ?? incoming[0]?.id);
        if (incoming[0]) {
          syncOperationForm(incoming[0]);
          setNoteInput("");
        }
        setReadMessageCounts((current) => ({
          ...Object.fromEntries(incoming.map((conversation) => [conversation.id, conversation.messages.length])),
          ...current,
        }));
      }
      if (agentsResponse.ok) {
        const json = await agentsResponse.json();
        setAgents(json.agents ?? []);
        const current = json.agents?.find((agent: AgentOption) => agent.id === user.id);
        if (current?.status) setAgentStatus(current.status);
      }
    };
    const initialLoad = window.setTimeout(() => void loadSnapshot(), 0);

    const source = new EventSource("/api/agent/conversations?stream=1");
    source.onopen = () => setListStreamState("live");
    source.onmessage = (event) => {
      setListStreamState("live");
      setLastStreamEventAt(Date.now());
      const payload = JSON.parse(event.data);
      if (payload.conversations) {
        setConversations(payload.conversations);
        setSelectedId((current) => current ?? payload.conversations?.[0]?.id);
        return;
      }
      if (payload.deletedId) {
        setConversations((items) => items.filter((item) => item.id !== payload.deletedId));
        setSelectedId((current) => (current === payload.deletedId ? undefined : current));
        setSelectedConversationIds((current) => current.filter((id) => id !== payload.deletedId));
        return;
      }
      setConversations((items) => {
        const next = items.filter((item) => item.id !== payload.id);
        return [payload, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    };
    source.onerror = () => {
      setListStreamState("reconnecting");
      void loadSnapshot();
    };
    return () => {
      window.clearTimeout(initialLoad);
      source.close();
    };
  }, [user]);

  useEffect(() => {
    if (!selected?.id || !user || user.forcePasswordChange) return;
    const markConnecting = window.setTimeout(() => setConversationStreamState("connecting"), 0);
    const refreshSelectedConversation = async () => {
      const response = await fetch("/api/agent/conversations");
      if (!response.ok) return;
      const json = await response.json();
      const incoming = (json.conversations ?? []) as ConversationWithMessages[];
      setConversations(incoming);
    };
    const source = new EventSource(`/api/agent/conversations/${selected.id}/stream`);
    source.onopen = () => setConversationStreamState("live");
    source.onmessage = (event) => {
      setConversationStreamState("live");
      setLastStreamEventAt(Date.now());
      const payload = JSON.parse(event.data) as ConversationWithMessages | { deletedId: string };
      if ("deletedId" in payload) {
        setConversations((items) => items.filter((item) => item.id !== payload.deletedId));
        setSelectedId(undefined);
        setSelectedConversationIds((current) => current.filter((id) => id !== payload.deletedId));
        return;
      }
      setConversations((items) => {
        const next = items.filter((item) => item.id !== payload.id);
        return [payload, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    };
    source.onerror = () => {
      setConversationStreamState("reconnecting");
      void refreshSelectedConversation();
    };
    return () => {
      window.clearTimeout(markConnecting);
      source.close();
    };
  }, [selected?.id, user]);

  useEffect(() => {
    if (!user || user.forcePasswordChange || user.role === "viewer") return;
    const timer = window.setInterval(() => {
      void updateAgentStatus(agentStatus);
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [agentStatus, user]);

  function upsertConversation(conversation: ConversationWithMessages) {
    setConversations((items) => {
      const next = items.filter((item) => item.id !== conversation.id);
      return [conversation, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  function loadConversationDraft(conversation: ConversationWithMessages) {
    syncOperationForm(conversation);
    setNoteInput("");
    setReadMessageCounts((current) => ({ ...current, [conversation.id]: conversation.messages.length }));
  }

  function selectConversation(conversation: ConversationWithMessages) {
    setSelectedId(conversation.id);
    loadConversationDraft(conversation);
  }

  function unreadCount(conversation: ConversationWithMessages) {
    if (conversation.id === selected?.id) return 0;
    const readUntil = readMessageCounts[conversation.id] ?? 0;
    return conversation.messages.slice(readUntil).filter((message) => message.role === "visitor").length;
  }

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
    setAuthChecked(true);
    setUser(json.user);
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to change password");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPassword("");
    setAuthChecked(true);
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
      upsertConversation(json.conversation);
    }
  }

  async function deleteSelectedConversation() {
    if (!selected) return;
    if (!window.confirm("Delete this conversation and all related messages, traces, and tool logs?")) return;
    setError("");
    setNotice("");
    const id = selected.id;
    const response = await fetch(`/api/agent/conversations/${id}`, { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Failed to delete conversation");
      return;
    }
    setConversations((items) => items.filter((item) => item.id !== id));
    setSelectedConversationIds((current) => current.filter((item) => item !== id));
    setSelectedId(undefined);
  }

  function toggleConversationSelection(id: string, checked: boolean) {
    setSelectedConversationIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );
  }

  function toggleVisibleSelection(checked: boolean) {
    const visibleIds = visibleConversations.map((conversation) => conversation.id);
    setSelectedConversationIds((current) =>
      checked
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((id) => !visibleIds.includes(id)),
    );
  }

  async function bulkUpdateStatus() {
    if (!selectedConversationIds.length) return;
    setError("");
    setNotice("");
    const response = await fetch("/api/agent/conversations/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_status", ids: selectedConversationIds, status: bulkStatus }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Bulk update failed");
      return;
    }
    const failed = (json.results ?? []).filter((item: { ok?: boolean }) => !item.ok);
    setNotice(
      failed.length
        ? `Bulk status updated with ${failed.length} failed item${failed.length === 1 ? "" : "s"}.`
        : "Bulk status updated.",
    );
  }

  async function bulkDeleteSelected() {
    if (!selectedConversationIds.length) return;
    if (!window.confirm(`Delete ${selectedConversationIds.length} selected conversation(s) and related records?`)) return;
    setError("");
    setNotice("");
    const ids = selectedConversationIds;
    const response = await fetch("/api/agent/conversations/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Bulk delete failed");
      return;
    }
    const deletedIds = new Set(
      (json.results ?? [])
        .filter((item: { ok?: boolean; id?: string }) => item.ok && item.id)
        .map((item: { id: string }) => item.id),
    );
    const failed = (json.results ?? []).filter((item: { ok?: boolean }) => !item.ok);
    setConversations((items) => items.filter((item) => !deletedIds.has(item.id)));
    setSelectedConversationIds((current) => current.filter((id) => !deletedIds.has(id)));
    setSelectedId((current) => (current && deletedIds.has(current) ? undefined : current));
    setNotice(
      failed.length
        ? `Bulk delete completed with ${failed.length} failed item${failed.length === 1 ? "" : "s"}.`
        : "Selected conversations deleted.",
    );
  }

  async function emailTranscript() {
    if (!selected) return;
    setError("");
    setNotice("");
    const response = await fetch(`/api/agent/conversations/${selected.id}/transcript-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error ?? "Failed to email transcript");
      return;
    }
    setNotice(`Transcript emailed to ${json.email}.`);
  }

  async function updateAgentStatus(status: AgentOption["status"]) {
    setAgentStatus(status);
    const response = await fetch("/api/agent/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      setError(json.error ?? "Failed to update status");
      return;
    }
    const agentsResponse = await fetch("/api/agent/agents");
    if (agentsResponse.ok) {
      const json = await agentsResponse.json();
      setAgents(json.agents ?? []);
    }
  }

  async function updateLocale(locale: User["locale"]) {
    const response = await fetch("/api/auth/me/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const json = await response.json();
    if (response.ok && json.user) {
      setUser((current) => (current ? { ...current, locale: json.user.locale } : current));
    }
  }

  async function assignConversation(agentId: string) {
    if (!agentId) return;
    await action("assign", { agentId });
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = reply.trim();
    if (!content && !replyAttachments.length) return;
    setReply("");
    const files = replyAttachments;
    setReplyAttachments([]);
    if (!selected) return;
    setError("");
    const form = new FormData();
    form.set("content", content);
    files.forEach((file) => form.append("attachments", file));
    const response = await fetch(`/api/agent/conversations/${selected.id}/messages`, {
      method: "POST",
      body: form,
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Reply failed");
      return;
    }
    if (json.conversation) upsertConversation(json.conversation);
  }

  async function saveOperations() {
    if (!selected) return;
    setError("");
    const response = await fetch(`/api/agent/conversations/${selected.id}/operations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tags: tagInput
          .split(",")
          .map((name) => ({ name: name.trim() }))
          .filter((tag) => tag.name),
        customerProfile: profile,
        translation: {
          ...(typeof translationEnabled === "boolean" ? { enabled: translationEnabled } : {}),
        },
        quickReplies: quickReplyInput
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save operations data");
      return;
    }
    if (json.conversation) upsertConversation(json.conversation);
  }

  async function addInternalNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const content = noteInput.trim();
    if (!content) return;
    setError("");
    const response = await fetch(`/api/agent/conversations/${selected.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to add internal note");
      return;
    }
    setNoteInput("");
    if (json.conversation) upsertConversation(json.conversation);
  }

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 text-[#1d2433]">
        <div className="w-full max-w-sm border border-[#ccd5e4] bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-[#111827]">Opening agent console</h1>
          <p className="mt-2 text-sm text-[#64748b]">Checking your session...</p>
        </div>
      </main>
    );
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

  if (user.forcePasswordChange) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4 text-[#1d2433]">
        <form onSubmit={submitPasswordChange} className="w-full max-w-sm border border-[#ccd5e4] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-[#111827]">Change password</h1>
          <p className="mt-1 text-sm text-[#64748b]">
            Signed in as {user.username}.{" "}
            {user.passwordChangeReason === "rotation"
              ? "Your password has expired under the rotation policy."
              : "Update your password before opening the console."}
          </p>
          <label className="mt-5 block text-sm font-medium">
            Current password
            <input
              className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-medium">
            New password
            <input
              className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Confirm new password
            <input
              className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 outline-none focus:border-[#3c6e9f]"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {error ? <p className="mt-3 text-sm text-[#b42318]">{error}</p> : null}
          <button
            className="mt-5 w-full rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Update password
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#1d2433]">
      <header className="flex items-center justify-between border-b border-[#d9e1ee] bg-white px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">{text.agentConsole}</h1>
          <p className="text-sm text-[#64748b]">
            {text.signedInAs} {user.username} ({user.role})
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-[#eef2f7] px-2 py-1 text-[#475569]">
              Inbox {listStreamState}
            </span>
            <span className="rounded-md bg-[#eef2f7] px-2 py-1 text-[#475569]">
              Conversation {selected ? conversationStreamState : "idle"}
            </span>
            {lastStreamEventAt ? (
              <span className="rounded-md bg-[#eef2f7] px-2 py-1 text-[#475569]">
                Last event {formatDuration(clock - lastStreamEventAt)} ago
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm"
            value={user.locale}
            onChange={(event) => void updateLocale(event.target.value as User["locale"])}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          {user.role !== "viewer" ? (
            <select
              className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm"
              value={agentStatus}
              onChange={(event) => void updateAgentStatus(event.target.value as AgentOption["status"])}
            >
              <option value="online">Online</option>
              <option value="away">Away</option>
              <option value="offline">Offline</option>
            </select>
          ) : null}
          <Link className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium" href="/agent/settings">
            Settings
          </Link>
          <Link className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium" href="/">
            Visitor view
          </Link>
        </div>
      </header>

      <div className="grid h-[calc(100vh-73px)] grid-cols-[340px_minmax(0,1fr)_320px]">
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
            <select
              className="mt-2 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.username} ({agent.status})
                </option>
              ))}
            </select>
            {canMutate ? (
              <div className="mt-3 border border-[#d9e1ee] bg-[#f8fafc] p-3">
                <label className="flex items-center gap-2 text-xs font-medium text-[#475569]">
                  <input
                    type="checkbox"
                    checked={
                      visibleConversations.length > 0 &&
                      visibleConversations.every((conversation) => selectedConversationIdSet.has(conversation.id))
                    }
                    onChange={(event) => toggleVisibleSelection(event.target.checked)}
                  />
                  Select visible
                </label>
                {selectedConversationIds.length ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs font-semibold text-[#111827]">
                      {bulkSelectedConversations.length}/{selectedConversationIds.length} selected
                    </div>
                    <select
                      className="w-full rounded-md border border-[#bbc7d8] px-2 py-1.5 text-xs"
                      value={bulkStatus}
                      onChange={(event) => setBulkStatus(event.target.value as ConversationStatus)}
                    >
                      <option value="ai_active">AI active</option>
                      <option value="queued_for_human">Queued</option>
                      <option value="human_active">Human active</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-[#1f2a44] px-2 py-1.5 text-xs font-semibold text-white"
                        onClick={() => void bulkUpdateStatus()}
                      >
                        Apply status
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[#d17a7a] bg-white px-2 py-1.5 text-xs font-semibold text-[#9f1d1d]"
                        onClick={() => void bulkDeleteSelected()}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {visibleConversations.length === 0 ? (
            <p className="p-4 text-sm leading-6 text-[#64748b]">No conversations yet. Open the visitor page and send a message.</p>
          ) : (
            visibleConversations.map((conversation) => {
              const unread = unreadCount(conversation);
              const sla = conversationSla(conversation, clock);
              return (
                <div
                  key={conversation.id}
                  className={`block w-full border-b border-[#eef2f7] p-4 text-left transition hover:bg-[#f4f7fb] ${
                    selected?.id === conversation.id ? "bg-[#edf3f8]" : "bg-white"
                  }`}
                >
                  <div className="flex gap-3">
                    {canMutate ? (
                      <input
                        className="mt-1 h-4 w-4 shrink-0"
                        type="checkbox"
                        checked={selectedConversationIdSet.has(conversation.id)}
                        onChange={(event) => toggleConversationSelection(conversation.id, event.target.checked)}
                        aria-label={`Select ${conversation.subject ?? conversation.id}`}
                      />
                    ) : null}
                    <button className="min-w-0 flex-1 text-left" type="button" onClick={() => selectConversation(conversation)}>
                      <div className="flex items-center justify-between gap-3">
                        <strong className="truncate text-sm text-[#111827]">{conversation.subject ?? "New conversation"}</strong>
                        <span className="shrink-0 rounded-md bg-[#eef2f7] px-2 py-1 text-xs text-[#475569]">
                          {conversation.status}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm text-[#64748b]">
                        {conversation.messages.at(-1)?.content ?? "No messages"}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {sla.waitMs !== undefined ? (
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              sla.level === "breach"
                                ? "bg-[#b42318] text-white"
                                : sla.level === "warning"
                                  ? "bg-[#fef0c7] text-[#93370d]"
                                  : "bg-[#e6f4ef] text-[#276749]"
                            }`}
                          >
                            Wait {formatDuration(sla.waitMs)}
                          </span>
                        ) : null}
                        {unread ? (
                          <span className="rounded-md bg-[#b42318] px-2 py-1 text-xs font-semibold text-white">
                            {unread} unread
                          </span>
                        ) : null}
                        {(conversation.tags ?? []).slice(0, 3).map((tag) => (
                          <span key={tag.name} className="rounded-md bg-[#e9eef6] px-2 py-1 text-xs text-[#475569]">
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </button>
                  </div>
                </div>
              );
            })
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
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-[#eef2f7] px-2 py-1 text-[#475569]">
                      First response {formatDuration(selectedSla?.firstResponseMs)}
                    </span>
                    <span
                      className={`rounded-md px-2 py-1 ${
                        selectedSla?.level === "breach"
                          ? "bg-[#b42318] text-white"
                          : selectedSla?.level === "warning"
                            ? "bg-[#fef0c7] text-[#93370d]"
                            : "bg-[#eef2f7] text-[#475569]"
                      }`}
                    >
                      Human wait {formatDuration(selectedSla?.waitMs)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <select
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm"
                    disabled={!canMutate || selected.status === "closed" || selected.status === "resolved"}
                    value={selected.takenOverById ?? ""}
                    onChange={(event) => void assignConversation(event.target.value)}
                  >
                    <option value="">Assign</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.username} ({agent.status})
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-md bg-[#2e6f57] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
                    disabled={
                      !canMutate ||
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
                    disabled={!canMutate || selected.status !== "human_active"}
                    onClick={() => action("release")}
                  >
                    Release
                  </button>
                  <button
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                    disabled={!canMutate || selected.status === "closed" || selected.status === "resolved"}
                    onClick={() => action("resolve")}
                  >
                    Resolve
                  </button>
                  <button
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                    disabled={!canMutate || selected.status === "closed"}
                    onClick={() => action("close")}
                  >
                    Close
                  </button>
                  <button
                    className="rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                    disabled={!canMutate || !selected.customerProfile?.email}
                    onClick={() => void emailTranscript()}
                  >
                    Email transcript
                  </button>
                  <button
                    className="rounded-md border border-[#d17a7a] bg-white px-3 py-2 text-sm font-semibold text-[#9f1d1d] disabled:text-[#94a3b8]"
                    disabled={!canMutate}
                    onClick={() => void deleteSelectedConversation()}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {notice || error ? (
                <div className="border-b border-[#d9e1ee] bg-white px-5 py-2">
                  {notice ? <p className="text-sm text-[#2e6f57]">{notice}</p> : null}
                  {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
                </div>
              ) : null}

              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {selected.messages.map((message) => {
                  const isInternalNote = Boolean(message.metadata?.internalNote);
                  const author = typeof message.metadata?.authorUsername === "string" ? message.metadata.authorUsername : "";
                  return (
                    <div
                      key={message.id}
                      className={`max-w-3xl border px-3 py-2 text-sm leading-6 ${
                        message.role === "visitor"
                          ? "border-[#2f6f95] bg-[#e9f3f8]"
                          : message.role === "human_agent"
                            ? "ml-auto border-[#2e6f57] bg-[#edf7f3]"
                            : isInternalNote
                              ? "ml-auto border-[#b59a4a] bg-[#fff7d6]"
                              : message.role === "system"
                                ? "mx-auto border-[#d6dae3] bg-white text-[#64748b]"
                                : "border-[#d9c6a3] bg-[#fff8e8]"
                      }`}
                    >
                      <div className="mb-1 text-xs font-semibold uppercase tracking-normal text-[#475569]">
                        {isInternalNote ? `internal note${author ? ` by ${author}` : ""}` : message.role}
                      </div>
                      <div>{displayMessageContent(message)}</div>
                      {messageAttachments(message).map(renderAttachment)}
                      {message.role === "visitor" && typeof translationMetadata(message).agentText === "string" ? (
                        <button
                          className="mt-1 text-xs font-medium underline"
                          type="button"
                          onClick={() => setShowOriginal((current) => ({ ...current, [message.id]: !current[message.id] }))}
                        >
                          {showOriginal[message.id] ? "Show translation" : "Show original"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <form onSubmit={submitReply} className="border-t border-[#d9e1ee] bg-white p-4">
                {error ? <p className="mb-2 text-sm text-[#b42318]">{error}</p> : null}
                {(selected.quickReplies ?? []).length ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {(selected.quickReplies ?? []).map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="rounded-md border border-[#b9c2d4] bg-white px-3 py-1.5 text-xs font-medium disabled:text-[#94a3b8]"
                        disabled={!canMutate || selected.status !== "human_active"}
                        onClick={() => setReply(item)}
                      >
                        {item.length > 38 ? `${item.slice(0, 38)}...` : item}
                      </button>
                    ))}
                  </div>
                ) : null}
                {replyAttachments.length ? (
                  <div className="mb-2 flex flex-wrap gap-2 text-xs text-[#475569]">
                    {replyAttachments.map((file) => (
                      <span key={`${file.name}-${file.size}`} className="rounded-md border border-[#cbd5e1] bg-white px-2 py-1">
                        {file.name}
                      </span>
                    ))}
                  </div>
                ) : null}
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
                    disabled={!canMutate || selected.status !== "human_active"}
                  />
                  <label className="cursor-pointer rounded-md border border-[#b9c2d4] bg-white px-3 py-2 text-sm font-medium text-[#1f2a44] has-disabled:cursor-not-allowed has-disabled:text-[#94a3b8]">
                    Attach
                    <input
                      className="hidden"
                      type="file"
                      multiple
                      accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.zip"
                      onChange={(event) => setReplyAttachments(Array.from(event.target.files ?? []))}
                      disabled={!canMutate || selected.status !== "human_active"}
                    />
                  </label>
                  <button
                    className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
                    disabled={!canMutate || selected.status !== "human_active" || (!reply.trim() && !replyAttachments.length)}
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

        <aside className="overflow-y-auto border-l border-[#d9e1ee] bg-white p-4">
          {selected ? (
            <div className="space-y-6">
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Agent activity</h2>
                <div className="mt-3 space-y-2">
                  {agents.map((agent) => {
                    const lastActiveAt = timeMs(agent.statusUpdatedAt);
                    return (
                      <div key={agent.id} className="flex items-center justify-between gap-3 border border-[#e1e7f0] bg-[#f8fafc] p-3 text-sm">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(agent.status)}`} />
                            <span className="truncate font-semibold text-[#111827]">{agent.username}</span>
                          </div>
                          <div className="mt-1 text-xs text-[#64748b]">
                            {agent.role}
                            {agent.statusUpdatedAt
                              ? ` | active ${formatDuration(lastActiveAt ? clock - lastActiveAt : undefined)} ago`
                              : " | no activity yet"}
                          </div>
                        </div>
                        <span className="rounded-md bg-white px-2 py-1 text-xs text-[#475569]">{agent.status}</span>
                      </div>
                    );
                  })}
                  {!agents.length ? <p className="text-sm text-[#64748b]">No active agents found.</p> : null}
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">SLA</h2>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                    <dt className="text-xs font-medium text-[#64748b]">First response</dt>
                    <dd className="mt-1 font-semibold text-[#111827]">
                      {formatDuration(selectedSla?.firstResponseMs)}
                    </dd>
                  </div>
                  <div className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                    <dt className="text-xs font-medium text-[#64748b]">Human wait</dt>
                    <dd
                      className={`mt-1 font-semibold ${
                        selectedSla?.level === "breach"
                          ? "text-[#b42318]"
                          : selectedSla?.level === "warning"
                            ? "text-[#93370d]"
                            : "text-[#111827]"
                      }`}
                    >
                      {formatDuration(selectedSla?.waitMs)}
                    </dd>
                  </div>
                  <div className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                    <dt className="text-xs font-medium text-[#64748b]">Last visitor</dt>
                    <dd className="mt-1 text-xs leading-5 text-[#111827]">
                      {formatDateTime(selected.messages.filter((message) => message.role === "visitor").at(-1)?.createdAt)}
                    </dd>
                  </div>
                  <div className="border border-[#e1e7f0] bg-[#f8fafc] p-3">
                    <dt className="text-xs font-medium text-[#64748b]">Alert</dt>
                    <dd className="mt-1 font-semibold text-[#111827]">
                      {selectedSla?.level === "breach"
                        ? "Breached"
                        : selectedSla?.level === "warning"
                          ? "Warning"
                          : "Normal"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs leading-5 text-[#64748b]">
                  Warning at {formatDuration(slaWarningMs)}, breach at {formatDuration(slaBreachMs)}.
                </p>
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Customer profile</h2>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs font-medium text-[#51607a]">
                    Name
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                      value={profile.name}
                      disabled={!canMutate}
                      onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#51607a]">
                    Email
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                      value={profile.email}
                      disabled={!canMutate}
                      onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#51607a]">
                    External ID
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                      value={profile.externalId}
                      disabled={!canMutate}
                      onChange={(event) => setProfile((current) => ({ ...current, externalId: event.target.value }))}
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#51607a]">
                    Plan
                    <input
                      className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                      value={profile.plan}
                      disabled={!canMutate}
                      onChange={(event) => setProfile((current) => ({ ...current, plan: event.target.value }))}
                    />
                  </label>
                  <label className="block text-xs font-medium text-[#51607a]">
                    Profile notes
                    <textarea
                      className="mt-1 min-h-20 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                      value={profile.notes}
                      disabled={!canMutate}
                      onChange={(event) => setProfile((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                </div>
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Tags</h2>
                <input
                  className="mt-3 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={tagInput}
                  disabled={!canMutate}
                  placeholder="billing, vip, follow-up"
                  onChange={(event) => setTagInput(event.target.value)}
                />
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Quick replies</h2>
                <textarea
                  className="mt-3 min-h-28 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={quickReplyInput}
                  disabled={!canMutate}
                  placeholder="One reply per line"
                  onChange={(event) => setQuickReplyInput(event.target.value)}
                />
              </section>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Translation</h2>
                <select
                  className="mt-3 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={translationEnabled === undefined ? "default" : translationEnabled ? "on" : "off"}
                  disabled={!canMutate}
                  onChange={(event) =>
                    setTranslationEnabled(event.target.value === "default" ? undefined : event.target.value === "on")
                  }
                >
                  <option value="default">Use global setting</option>
                  <option value="on">Translation on</option>
                  <option value="off">Translation off</option>
                </select>
              </section>

              <button
                className="w-full rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
                disabled={!canMutate}
                onClick={() => void saveOperations()}
              >
                Save operations data
              </button>

              <form onSubmit={addInternalNote} className="border-t border-[#e1e7f0] pt-5">
                <h2 className="text-sm font-semibold uppercase tracking-normal text-[#51607a]">Internal note</h2>
                <textarea
                  className="mt-3 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={noteInput}
                  disabled={!canMutate}
                  placeholder="Visible only in the agent console"
                  onChange={(event) => setNoteInput(event.target.value)}
                />
                <button
                  className="mt-3 w-full rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold disabled:text-[#94a3b8]"
                  disabled={!canMutate || !noteInput.trim()}
                >
                  Add note
                </button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-[#64748b]">Select a conversation to manage profile and operations data.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
