"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationWithMessages, Message, WidgetConfiguration } from "@/lib/types";

type WidgetConfigPayload = {
  widgetConfig: WidgetConfiguration;
  supportOnline: boolean;
};

type StreamState = "connecting" | "live" | "reconnecting";

const fallbackWidgetConfig: WidgetConfiguration = {
  id: "global",
  themeColor: "#1f2a44",
  welcomeMessage: "Start a conversation. The AI agent will answer first, and a human can take over when needed.",
  offlineMessage: "No human agents are online right now. Leave a message and the AI agent will keep helping.",
  enableSatisfaction: true,
  enableTranscriptDownload: true,
  requireEndConfirmation: true,
  createdAt: "",
  updatedAt: "",
};

function labelFor(role: Message["role"]) {
  if (role === "visitor") return "You";
  if (role === "human_agent") return "Agent";
  if (role === "system") return "System";
  return "AI";
}

export function ChatWidget() {
  const [conversation, setConversation] = useState<ConversationWithMessages>();
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfiguration>(fallbackWidgetConfig);
  const [supportOnline, setSupportOnline] = useState(true);
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSaved, setRatingSaved] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/chat/widget-config")
      .then((response) => response.json())
      .then((json: WidgetConfigPayload) => {
        setWidgetConfig(json.widgetConfig ?? fallbackWidgetConfig);
        setSupportOnline(Boolean(json.supportOnline));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/chat/stream");
    source.onopen = () => setStreamState("live");
    source.onmessage = (event) => {
      setStreamState("live");
      setConversation(JSON.parse(event.data) as ConversationWithMessages);
    };
    source.onerror = () => {
      setStreamState("reconnecting");
      fetch("/api/chat/conversation")
        .then((response) => response.json())
        .then((json) => {
          if (json.conversation) setConversation(json.conversation);
        })
        .catch(() => undefined);
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages.length]);

  const statusText = useMemo(() => {
    if (conversation?.status === "human_active") return "Human agent active";
    if (conversation?.status === "queued_for_human") return "Waiting for a human agent";
    if (conversation?.status === "resolved") return "Conversation resolved";
    if (conversation?.status === "closed") return "Conversation closed";
    return "AI agent active";
  }, [conversation?.status]);

  const satisfaction = conversation?.metadata?.satisfaction as { rating?: number; comment?: string } | undefined;
  const canRate =
    widgetConfig.enableSatisfaction &&
    Boolean(conversation) &&
    (conversation?.status === "closed" || conversation?.status === "resolved");

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

  async function endConversation() {
    if (widgetConfig.requireEndConfirmation && !window.confirm("End this chat now?")) return;
    const response = await fetch("/api/chat/end", { method: "POST" });
    const json = await response.json();
    if (json.conversation) setConversation(json.conversation);
  }

  async function submitRating(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rating) return;
    const response = await fetch("/api/chat/rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment: ratingComment }),
    });
    const json = await response.json();
    if (json.conversation) {
      setConversation(json.conversation);
      setRatingSaved(true);
    }
  }

  async function downloadTranscript() {
    const response = await fetch("/api/chat/transcript");
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `live-chat-${conversation?.id ?? "transcript"}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex h-[calc(100vh-140px)] min-h-[560px] flex-col border border-[#cfd7e6] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#e1e7f0] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">Live chat</h2>
          <p className="text-xs text-[#64748b]">{statusText}</p>
        </div>
        <div className="flex items-center gap-2">
          {conversation && conversation.status !== "closed" && conversation.status !== "resolved" ? (
            <button
              className="rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1 text-xs font-medium text-[#475569]"
              type="button"
              onClick={() => void endConversation()}
            >
              End
            </button>
          ) : null}
          <span
            className="rounded-md px-2.5 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: widgetConfig.themeColor }}
          >
            {conversation?.status ?? "connecting"}
          </span>
          <span className="rounded-md bg-[#eef2f7] px-2.5 py-1 text-xs font-medium text-[#475569]">
            {streamState}
          </span>
        </div>
      </div>

      <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto bg-[#f8fafc] p-4">
        {!supportOnline ? (
          <div className="rounded-md border border-[#f2c94c] bg-[#fff8e1] p-3 text-sm leading-6 text-[#6f4e00]">
            {widgetConfig.offlineMessage}
          </div>
        ) : null}
        {(conversation?.messages.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed border-[#b8c2d6] bg-white p-5 text-sm leading-6 text-[#526175]">
            {widgetConfig.welcomeMessage}
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

      {canRate ? (
        <form onSubmit={submitRating} className="border-t border-[#e1e7f0] bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-[#111827]">
              {satisfaction?.rating ? `Rated ${satisfaction.rating}/5` : ratingSaved ? "Rating saved" : "Rate this chat"}
            </div>
            {widgetConfig.enableTranscriptDownload ? (
              <button
                className="rounded-md border border-[#b9c2d4] bg-white px-3 py-1.5 text-xs font-medium text-[#1f2a44]"
                type="button"
                onClick={() => void downloadTranscript()}
              >
                Transcript
              </button>
            ) : null}
          </div>
          {!satisfaction?.rating ? (
            <>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    className={`h-8 w-8 rounded-md border text-sm font-semibold ${
                      rating >= value ? "border-transparent text-white" : "border-[#cbd5e1] bg-white text-[#475569]"
                    }`}
                    style={rating >= value ? { backgroundColor: widgetConfig.themeColor } : undefined}
                    type="button"
                    onClick={() => setRating(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <input
                className="mt-2 w-full rounded-md border border-[#bbc7d8] px-3 py-2 text-sm outline-none focus:border-[#3c6e9f]"
                placeholder="Optional feedback"
                value={ratingComment}
                onChange={(event) => setRatingComment(event.target.value)}
              />
              <button
                className="mt-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:bg-[#94a3b8]"
                disabled={!rating}
                style={rating ? { backgroundColor: widgetConfig.themeColor } : undefined}
              >
                Submit rating
              </button>
            </>
          ) : null}
        </form>
      ) : widgetConfig.enableTranscriptDownload && conversation?.messages.length ? (
        <div className="border-t border-[#e1e7f0] bg-white px-3 py-2">
          <button
            className="rounded-md border border-[#b9c2d4] bg-white px-3 py-1.5 text-xs font-medium text-[#1f2a44]"
            type="button"
            onClick={() => void downloadTranscript()}
          >
            Download transcript
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} className="border-t border-[#e1e7f0] p-3">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-[#bbc7d8] px-3 py-2 text-sm outline-none focus:border-[#3c6e9f]"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Type your message"
            disabled={conversation?.status === "closed" || conversation?.status === "resolved"}
          />
          <button
            className="rounded-md px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
            style={!isSending && content.trim() && conversation?.status !== "closed" && conversation?.status !== "resolved" ? { backgroundColor: widgetConfig.themeColor } : undefined}
            disabled={isSending || !content.trim() || conversation?.status === "closed" || conversation?.status === "resolved"}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
