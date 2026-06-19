import type { ConversationWithMessages } from "./types";

type Listener = (payload: unknown) => void;

const channels = new Map<string, Set<Listener>>();

function channelKey(scope: string, id = "global") {
  return `${scope}:${id}`;
}

export function publish(scope: string, id: string | undefined, payload: unknown) {
  const targets = [channelKey(scope, id), channelKey(scope)];
  for (const target of targets) {
    for (const listener of channels.get(target) ?? []) {
      listener(payload);
    }
  }
}

export function subscribe(scope: string, id: string | undefined, listener: Listener) {
  const key = channelKey(scope, id);
  const listeners = channels.get(key) ?? new Set<Listener>();
  listeners.add(listener);
  channels.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) channels.delete(key);
  };
}

export function sseStream(initial: unknown, subscribeTo: (send: Listener) => () => void) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      send(initial);
      unsubscribe = subscribeTo(send);
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          if (keepAlive) clearInterval(keepAlive);
          unsubscribe?.();
        }
      }, 25_000);
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe?.();
    },
  });
}

export function publishConversation(conversation: ConversationWithMessages) {
  publish("conversation", conversation.id, conversation);
  publish("conversations", undefined, conversation);
}
