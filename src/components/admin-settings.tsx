"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AIConfiguration, AuditLog, KnowledgeBase, KnowledgeDocument, KnowledgeSearchResult, UserRole } from "@/lib/types";

type SettingsPayload = {
  aiConfig: AIConfiguration;
};

type KnowledgePayload = {
  knowledgeBases: KnowledgeBase[];
  documents: KnowledgeDocument[];
};

type AdminUser = {
  id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
};

type Metrics = {
  totalConversations: number;
  aiMessages: number;
  humanMessages: number;
  humanHandoffRate: number;
  aiResolutionRate: number;
  knowledgeHitRate: number;
  openConversations: number;
};

const emptyAiConfig: AIConfiguration = {
  id: "global",
  provider: "mock",
  model: "gpt-4o-mini",
  temperature: 0.2,
  maxContextMessages: 12,
  systemPrompt: "",
  fallbackMessage: "",
  enableKnowledgeBase: true,
  enableTools: true,
  knowledgeBaseIds: [],
  autoHandoff: {
    enabled: true,
    userRequestPatterns: [],
    sensitiveKeywords: [],
    vipMetadataKeys: [],
    aiFailureThreshold: 2,
  },
  createdAt: "",
  updatedAt: "",
};

function linesToArray(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AdminSettings() {
  const [aiConfig, setAiConfig] = useState<AIConfiguration>(emptyAiConfig);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [metrics, setMetrics] = useState<Metrics>();
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("agent");
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");
  const [selectedKbId, setSelectedKbId] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [testMessage, setTestMessage] = useState("How do I get support?");
  const [aiTestReply, setAiTestReply] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function load() {
    const [aiResponse, kbResponse, auditResponse, metricsResponse] = await Promise.all([
      fetch("/api/admin/ai-config"),
      fetch("/api/admin/knowledge-bases"),
      fetch("/api/admin/audit-logs"),
      fetch("/api/admin/metrics"),
    ]);
    const usersResponse = await fetch("/api/admin/users");
    if (aiResponse.status === 401 || kbResponse.status === 401) {
      setError("Please sign in as an admin first.");
      return;
    }
    if (!aiResponse.ok || !kbResponse.ok) {
      setError("Admin role is required to manage settings.");
      return;
    }
    const aiJson = (await aiResponse.json()) as SettingsPayload;
    const kbJson = (await kbResponse.json()) as KnowledgePayload;
    setAiConfig(aiJson.aiConfig);
    setKnowledgeBases(kbJson.knowledgeBases);
    setDocuments(kbJson.documents);
    setSelectedKbId((current) => current || kbJson.knowledgeBases[0]?.id || "");
    if (auditResponse.ok) {
      const auditJson = (await auditResponse.json()) as { auditLogs: AuditLog[] };
      setAuditLogs(auditJson.auditLogs);
    }
    if (usersResponse.ok) {
      const usersJson = (await usersResponse.json()) as { users: AdminUser[] };
      setUsers(usersJson.users);
    }
    if (metricsResponse.ok) {
      const metricsJson = (await metricsResponse.json()) as { metrics: Metrics };
      setMetrics(metricsJson.metrics);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function saveAIConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved("");
    const response = await fetch("/api/admin/ai-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aiConfig),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to save AI configuration.");
      return;
    }
    setAiConfig(json.aiConfig);
    setSaved("AI configuration saved.");
  }

  async function testAI(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiTestReply("");
    const response = await fetch("/api/admin/ai-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: testMessage }),
    });
    const json = await response.json();
    setAiTestReply(response.ok ? json.reply : json.error);
  }

  async function createKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/knowledge-bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKbName, description: newKbDescription }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to create knowledge base.");
      return;
    }
    setNewKbName("");
    setNewKbDescription("");
    await load();
    setSelectedKbId(json.knowledgeBase.id);
  }

  async function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbId) return;
    const response = await fetch(`/api/admin/knowledge-bases/${selectedKbId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: documentTitle, content: documentContent, sourceType: "manual" }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to add document.");
      return;
    }
    setDocumentTitle("");
    setDocumentContent("");
    await load();
  }

  async function searchKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedKbId) return;
    const response = await fetch(`/api/admin/knowledge-bases/${selectedKbId}/search-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery }),
    });
    const json = await response.json();
    setSearchResults(response.ok ? json.results : []);
    if (!response.ok) setError(json.error ?? "Search failed.");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername, password: newUserPassword, role: newUserRole }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to create user.");
      return;
    }
    setNewUsername("");
    setNewUserPassword("");
    setNewUserRole("agent");
    await load();
  }

  async function updateUser(user: AdminUser, input: Partial<Pick<AdminUser, "role" | "disabled">>) {
    setError("");
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error ?? "Failed to update user.");
      return;
    }
    await load();
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-[#1d2433]">
      <header className="flex items-center justify-between border-b border-[#d9e1ee] bg-white px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Admin settings</h1>
          <p className="text-sm text-[#64748b]">AI configuration, knowledge base, audit and deployment controls.</p>
        </div>
        <a className="rounded-md border border-[#b9c2d4] px-3 py-2 text-sm font-medium" href="/agent">
          Agent console
        </a>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-5">
          <form onSubmit={saveAIConfig} className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">AI configuration</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                Provider
                <select
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.provider}
                  onChange={(event) => setAiConfig({ ...aiConfig, provider: event.target.value as AIConfiguration["provider"] })}
                >
                  <option value="mock">mock</option>
                  <option value="openai">openai</option>
                  <option value="future_provider">future_provider</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Model
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.model}
                  onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })}
                />
              </label>
              <label className="text-sm font-medium">
                Temperature
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={aiConfig.temperature}
                  onChange={(event) => setAiConfig({ ...aiConfig, temperature: Number(event.target.value) })}
                />
              </label>
              <label className="text-sm font-medium">
                Context messages
                <input
                  className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  type="number"
                  min="1"
                  max="50"
                  value={aiConfig.maxContextMessages}
                  onChange={(event) => setAiConfig({ ...aiConfig, maxContextMessages: Number(event.target.value) })}
                />
              </label>
            </div>
            <label className="mt-4 block text-sm font-medium">
              System prompt
              <textarea
                className="mt-1 min-h-28 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.systemPrompt}
                onChange={(event) => setAiConfig({ ...aiConfig, systemPrompt: event.target.value })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Fallback message
              <input
                className="mt-1 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                value={aiConfig.fallbackMessage}
                onChange={(event) => setAiConfig({ ...aiConfig, fallbackMessage: event.target.value })}
              />
            </label>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.enableKnowledgeBase}
                  onChange={(event) => setAiConfig({ ...aiConfig, enableKnowledgeBase: event.target.checked })}
                />
                Enable knowledge base
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.enableTools}
                  onChange={(event) => setAiConfig({ ...aiConfig, enableTools: event.target.checked })}
                />
                Enable tools
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiConfig.autoHandoff.enabled}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: { ...aiConfig.autoHandoff, enabled: event.target.checked },
                    })
                  }
                />
                Enable auto handoff
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                Handoff request patterns
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.autoHandoff.userRequestPatterns.join("\n")}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: { ...aiConfig.autoHandoff, userRequestPatterns: linesToArray(event.target.value) },
                    })
                  }
                />
              </label>
              <label className="text-sm font-medium">
                Sensitive keywords
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2"
                  value={aiConfig.autoHandoff.sensitiveKeywords.join("\n")}
                  onChange={(event) =>
                    setAiConfig({
                      ...aiConfig,
                      autoHandoff: { ...aiConfig.autoHandoff, sensitiveKeywords: linesToArray(event.target.value) },
                    })
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Save AI config</button>
              {saved ? <span className="text-sm text-[#2e6f57]">{saved}</span> : null}
            </div>
          </form>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Knowledge base</h2>
            <form onSubmit={createKnowledgeBase} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Knowledge base name"
                value={newKbName}
                onChange={(event) => setNewKbName(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Description"
                value={newKbDescription}
                onChange={(event) => setNewKbDescription(event.target.value)}
              />
              <button className="rounded-md bg-[#2e6f57] px-4 py-2 text-sm font-semibold text-white">Create</button>
            </form>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <form onSubmit={addDocument} className="space-y-3">
                <select
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  value={selectedKbId}
                  onChange={(event) => setSelectedKbId(event.target.value)}
                >
                  <option value="">Select knowledge base</option>
                  {knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name}
                    </option>
                  ))}
                </select>
                <input
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  placeholder="Document title"
                  value={documentTitle}
                  onChange={(event) => setDocumentTitle(event.target.value)}
                />
                <textarea
                  className="min-h-40 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  placeholder="Paste FAQ, Markdown, or plain text"
                  value={documentContent}
                  onChange={(event) => setDocumentContent(event.target.value)}
                />
                <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Add document</button>
              </form>
              <form onSubmit={searchKnowledge} className="space-y-3">
                <input
                  className="w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                  placeholder="Search test query"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <button className="rounded-md border border-[#b9c2d4] bg-white px-4 py-2 text-sm font-semibold">
                  Search knowledge
                </button>
                <div className="space-y-2">
                  {searchResults.map((result) => (
                    <div key={result.id} className="border border-[#e1e7f0] bg-[#f8fafc] p-3 text-sm">
                      <div className="font-semibold">{result.documentTitle}</div>
                      <div className="text-xs text-[#64748b]">score {result.score.toFixed(2)}</div>
                      <p className="mt-2 max-h-24 overflow-hidden">{result.content}</p>
                    </div>
                  ))}
                </div>
              </form>
            </div>
          </section>
        </section>

        <aside className="space-y-5">
          {metrics ? (
            <section className="border border-[#d9e1ee] bg-white p-5">
              <h2 className="text-lg font-semibold">Operations</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Conversations</div>
                  <div className="text-xl font-semibold">{metrics.totalConversations}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Open</div>
                  <div className="text-xl font-semibold">{metrics.openConversations}</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">Handoff</div>
                  <div className="text-xl font-semibold">{Math.round(metrics.humanHandoffRate * 100)}%</div>
                </div>
                <div className="border border-[#e1e7f0] p-3">
                  <div className="text-[#64748b]">KB hit</div>
                  <div className="text-xl font-semibold">{Math.round(metrics.knowledgeHitRate * 100)}%</div>
                </div>
              </div>
            </section>
          ) : null}

          <form onSubmit={testAI} className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Test AI</h2>
            <textarea
              className="mt-3 min-h-24 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
              value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)}
            />
            <button className="mt-3 rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Run test</button>
            {aiTestReply ? <p className="mt-3 border border-[#e1e7f0] bg-[#f8fafc] p-3 text-sm">{aiTestReply}</p> : null}
          </form>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Knowledge inventory</h2>
            <div className="mt-3 space-y-3 text-sm">
              {knowledgeBases.map((kb) => (
                <div key={kb.id} className="border border-[#e1e7f0] p-3">
                  <div className="font-semibold">{kb.name}</div>
                  <div className="text-[#64748b]">
                    {documents.filter((document) => document.knowledgeBaseId === kb.id).length} documents
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Audit logs</h2>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto text-sm">
              {auditLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="border-l-4 border-[#3c6e9f] bg-[#f8fafc] p-3">
                  <div className="font-semibold">{log.action}</div>
                  <div className="text-xs text-[#64748b]">{new Date(log.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-[#d9e1ee] bg-white p-5">
            <h2 className="text-lg font-semibold">Users</h2>
            <form onSubmit={createUser} className="mt-3 grid gap-2">
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Username"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
              />
              <input
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                placeholder="Password"
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
              />
              <select
                className="rounded-md border border-[#bbc7d8] px-3 py-2 text-sm"
                value={newUserRole}
                onChange={(event) => setNewUserRole(event.target.value as UserRole)}
              >
                <option value="agent">agent</option>
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
              <button className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white">Create user</button>
            </form>
            <div className="mt-4 space-y-2 text-sm">
              {users.map((user) => (
                <div key={user.id} className="border border-[#e1e7f0] p-3">
                  <div className="font-semibold">{user.username}</div>
                  <div className="mt-2 flex gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-2 py-1"
                      value={user.role}
                      onChange={(event) => updateUser(user, { role: event.target.value as UserRole })}
                    >
                      <option value="agent">agent</option>
                      <option value="admin">admin</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      className="rounded-md border border-[#b9c2d4] px-3 py-1"
                      type="button"
                      onClick={() => updateUser(user, { disabled: !user.disabled })}
                    >
                      {user.disabled ? "Enable" : "Disable"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {error ? <p className="border border-[#f1b8b8] bg-[#fff5f5] p-3 text-sm text-[#b42318]">{error}</p> : null}
        </aside>
      </div>
    </main>
  );
}
