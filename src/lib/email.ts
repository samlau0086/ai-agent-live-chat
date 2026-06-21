import net from "node:net";
import tls from "node:tls";
import { store } from "./store";
import type { EmailConfiguration } from "./types";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

function envValue(name?: string) {
  return name ? process.env[name] : undefined;
}

function requireConfigured(config: EmailConfiguration) {
  if (!config.enabled) throw new Error("Email sending is disabled");
  if (!config.fromEmail) throw new Error("Email from address is not configured");
}

function headerValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function addressHeader(email: string, name?: string) {
  const cleanEmail = headerValue(email);
  const cleanName = headerValue(name ?? "");
  if (!cleanName) return cleanEmail;
  return `"${cleanName.replace(/"/g, '\\"')}" <${cleanEmail}>`;
}

async function sendViaResend(config: EmailConfiguration, input: SendEmailInput) {
  const apiKeyEnv = config.resendApiKeyEnv ?? "RESEND_API_KEY";
  const apiKey = envValue(apiKeyEnv);
  if (!apiKey) throw new Error(`Missing Resend API key env var: ${apiKeyEnv}`);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: addressHeader(config.fromEmail, config.fromName),
      to: [input.to],
      subject: input.subject,
      text: input.text,
      reply_to: config.replyToEmail || undefined,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Resend email failed: ${response.status} ${details}`.trim());
  }
}

function smtpContent(config: EmailConfiguration, input: SendEmailInput) {
  const headers = [
    `From: ${addressHeader(config.fromEmail, config.fromName)}`,
    `To: ${headerValue(input.to)}`,
    `Subject: ${headerValue(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (config.replyToEmail) headers.push(`Reply-To: ${headerValue(config.replyToEmail)}`);
  return `${headers.join("\r\n")}\r\n\r\n${input.text.replace(/^\./gm, "..")}\r\n.`;
}

async function sendViaSmtp(config: EmailConfiguration, input: SendEmailInput) {
  const host = config.smtpHost;
  if (!host) throw new Error("SMTP host is not configured");
  const port = config.smtpPort || (config.smtpSecure ? 465 : 587);
  const passwordEnv = config.smtpPasswordEnv ?? "SMTP_PASSWORD";
  const password = config.smtpUsername ? envValue(passwordEnv) : undefined;
  if (config.smtpUsername && !password) throw new Error(`Missing SMTP password env var: ${passwordEnv}`);

  let socket: net.Socket | tls.TLSSocket | undefined;
  let buffer = "";
  let rejectCurrent: ((error: Error) => void) | undefined;
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
  };
  const onError = (error: Error) => {
    rejectCurrent?.(error);
  };

  function attach(nextSocket: net.Socket | tls.TLSSocket) {
    socket?.off("data", onData);
    socket?.off("error", onError);
    socket = nextSocket;
    socket.on("data", onData);
    socket.on("error", onError);
  }

  function waitResponse() {
    return new Promise<{ code: number; text: string }>((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines[lines.length - 1] ?? "";
        const match = last.match(/^(\d{3})\s/);
        if (match) {
          const text = buffer;
          buffer = "";
          rejectCurrent = undefined;
          resolve({ code: Number(match[1]), text });
          return;
        }
        if (Date.now() - startedAt > 15000) {
          rejectCurrent = undefined;
          reject(new Error("SMTP response timed out"));
          return;
        }
        setTimeout(tick, 25);
      };
      rejectCurrent = reject;
      tick();
    });
  }

  async function command(line: string, accepted: number[]) {
    if (!socket) throw new Error("SMTP socket is not connected");
    socket.write(`${line}\r\n`);
    const response = await waitResponse();
    if (!accepted.includes(response.code)) {
      throw new Error(`SMTP command failed (${line}): ${response.text.trim()}`);
    }
  }

  const initialSocket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const client = config.smtpSecure
      ? tls.connect({ host, port, servername: host }, () => resolve(client))
      : net.connect({ host, port }, () => resolve(client));
    client.once("error", reject);
  });
  attach(initialSocket);

  try {
    const greeting = await waitResponse();
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed: ${greeting.text.trim()}`);
    await command("EHLO localhost", [250]);

    if (!config.smtpSecure) {
      await command("STARTTLS", [220]);
      buffer = "";
      const tlsSocket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        if (!socket) {
          reject(new Error("SMTP socket is not connected"));
          return;
        }
        const secured = tls.connect({ socket, servername: host }, () => resolve(secured));
        secured.once("error", reject);
      });
      attach(tlsSocket);
      await command("EHLO localhost", [250]);
    }

    if (config.smtpUsername && password) {
      await command("AUTH LOGIN", [334]);
      await command(Buffer.from(config.smtpUsername).toString("base64"), [334]);
      await command(Buffer.from(password).toString("base64"), [235]);
    }

    await command(`MAIL FROM:<${config.fromEmail}>`, [250]);
    await command(`RCPT TO:<${input.to}>`, [250, 251]);
    await command("DATA", [354]);
    await command(smtpContent(config, input), [250]);
    await command("QUIT", [221]);
  } finally {
    socket?.destroy();
  }
}

export async function sendConfiguredEmail(input: SendEmailInput) {
  const config = await store.getEmailConfiguration();
  requireConfigured(config);
  if (config.provider === "resend") {
    await sendViaResend(config, input);
    return { provider: "resend" as const };
  }
  await sendViaSmtp(config, input);
  return { provider: "smtp" as const };
}
