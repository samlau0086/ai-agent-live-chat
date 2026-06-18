"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationWithMessages, Message } from "@/lib/types";

function labelFor(role: Message["role"]) {
  if (role === "visitor") return "You";
  if (role === "human_agent") return "Agent";
  if (role === "system") return "System";
  return "AI";
}

export function ChatWidget() {
  const [conversation, setConversation] = useState<ConversationWithMessages>();
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource("/api/chat/stream");
    source.onmessage = (event) => {
      setConversation(JSON.parse(event.data) as ConversationWithMessages);
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages.length]);

  const statusText = useMemo(() => {
    if (conversation?.status === "human_active") return "Human agent active";
    if (conversation?.status === "closed") return "Conversation closed";
    return "AI agent active";
  }, [conversation?.status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = content.trim();
    if (!message) return;
    setIsSending(true);
    setContent("");
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
      const json = await response.json();
      if (json.conversation) setConversation(json.conversation);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="flex h-[calc(100vh-140px)] min-h-[560px] flex-col border border-[#cfd7e6] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#e1e7f0] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">Live chat</h2>
          <p className="text-xs text-[#64748b]">{statusText}</p>
        </div>
        <span className="rounded-md bg-[#e8f3ef] px-2.5 py-1 text-xs font-medium text-[#1f6b4f]">
          {conversation?.status ?? "connecting"}
        </span>
      </div>

      <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto bg-[#f8fafc] p-4">
        {(conversation?.messages.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed border-[#b8c2d6] bg-white p-5 text-sm leading-6 text-[#526175]">
            Start a conversation. The mock AI will answer immediately until an agent takes over.
          </div>
        ) : (
          conversation?.messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[86%] border px-3 py-2 text-sm leading-6 ${
                message.role === "visitor"
                  ? "ml-auto border-[#2f6f95] bg-[#e9f3f8] text-[#16384d]"
                  : message.role === "human_agent"
                    ? "border-[#2e6f57] bg-[#edf7f3] text-[#174532]"
                    : message.role === "system"
                      ? "mx-auto border-[#d6dae3] bg-white text-[#64748b]"
                      : "border-[#d9c6a3] bg-[#fff8e8] text-[#4a3515]"
              }`}
            >
              <div className="mb-1 text-xs font-semibold uppercase tracking-normal">{labelFor(message.role)}</div>
              <div>{message.content}</div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} className="border-t border-[#e1e7f0] p-3">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-3 py-2 text-sm outline-none focus:border-[#3c6e9f]"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Type your message"
            disabled={conversation?.status === "closed"}
          />
          <button
            className="rounded-md bg-[#1f2a44] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#33415f] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
            disabled={isSending || !content.trim() || conversation?.status === "closed"}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
