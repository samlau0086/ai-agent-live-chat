#!/usr/bin/env node

const defaultBaseUrl = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${process.env.APP_PORT ?? "3000"}`;

function parseArgs(argv) {
  const options = {
    baseUrl: defaultBaseUrl,
    retries: 20,
    retryDelayMs: 3000,
    requirePrisma: false,
    requireSecrets: false,
    skipChat: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = argv[(index += 1)];
    else if (arg === "--retries") options.retries = Number(argv[(index += 1)]);
    else if (arg === "--retry-delay-ms") options.retryDelayMs = Number(argv[(index += 1)]);
    else if (arg === "--require-prisma") options.requirePrisma = true;
    else if (arg === "--require-secrets") options.requireSecrets = true;
    else if (arg === "--skip-chat") options.skipChat = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.retries) || options.retries < 1) options.retries = 20;
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0) options.retryDelayMs = 3000;
  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-test.mjs [options]

Options:
  --base-url <url>          Base app URL. Defaults to SMOKE_BASE_URL or APP_PORT.
  --retries <count>         Health check retry count. Defaults to 20.
  --retry-delay-ms <ms>     Delay between health retries. Defaults to 3000.
  --require-prisma          Require /api/health to report Prisma/Postgres and applied migrations.
  --require-secrets         Require SESSION_SECRET and WEBHOOK_SIGNING_SECRET to be non-default.
  --skip-chat               Skip visitor chat write/read smoke checks.
`);
}

function normalizeBaseUrl(value) {
  if (!value) throw new Error("Base URL is required");
  return value.replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pass(message) {
  console.log(`[pass] ${message}`);
}

function fail(message, details) {
  const suffix = details ? `\n${details}` : "";
  throw new Error(`${message}${suffix}`);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    fail(`Expected JSON response from ${response.url}`, text.slice(0, 500));
  }
}

async function waitForHealth(options) {
  let lastError;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${options.baseUrl}/api/health`);
      const body = await readJson(response);
      if (response.ok && body.ok === true) {
        validateHealth(body, options);
        pass(`/api/health is healthy after ${attempt} attempt(s)`);
        return body;
      }
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < options.retries) await sleep(options.retryDelayMs);
  }

  fail(`/api/health did not become healthy at ${options.baseUrl}`, lastError);
}

function validateHealth(health, options) {
  if (options.requirePrisma) {
    if (health.storage !== "prisma") fail("Expected Prisma storage in production health check", JSON.stringify(health));
    if (health.database?.provider !== "postgresql") fail("Expected PostgreSQL health provider", JSON.stringify(health));
    if (health.database?.migrationStatus !== "ok") {
      fail("Expected applied Prisma migrations", JSON.stringify(health.database));
    }
    if (!health.database?.appliedMigrations || health.database.appliedMigrations < 1) {
      fail("Expected at least one applied migration", JSON.stringify(health.database));
    }
  }

  if (options.requireSecrets && health.secrets?.insecureDefaults?.length) {
    fail("Production secrets are still using insecure defaults", JSON.stringify(health.secrets));
  }
  if (
    options.requireSecrets &&
    (!health.secrets?.sessionSecretConfigured || !health.secrets?.webhookSigningSecretConfigured)
  ) {
    fail("Production secret health fields are not fully configured", JSON.stringify(health.secrets));
  }
}

async function checkWidget(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/widget.js`);
  const text = await response.text();
  if (!response.ok) fail(`/widget.js returned HTTP ${response.status}`, text.slice(0, 500));
  if (!text.includes("__aiAgentLiveChatLoaded") || !text.includes("iframe") || !text.includes("?embed=1")) {
    fail("/widget.js response did not look like the live chat embed script", text.slice(0, 500));
  }
  pass("/widget.js is reachable");

  const configResponse = await fetchWithTimeout(`${baseUrl}/api/chat/widget-config`);
  const configBody = await readJson(configResponse);
  if (!configResponse.ok) fail("Widget config API failed", JSON.stringify(configBody));
  const widgetConfig = configBody.widgetConfig;
  if (
    !widgetConfig?.themeColor ||
    !widgetConfig?.welcomeMessage ||
    !widgetConfig?.offlineMessage ||
    typeof configBody.supportOnline !== "boolean"
  ) {
    fail("Widget config API returned an incomplete public configuration", JSON.stringify(configBody));
  }
  pass("widget public configuration is reachable");
}

function getCookieHeader(response) {
  const headers = response.headers;
  const setCookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : headers.get("set-cookie")?.split(/,(?=\s*\w+=)/);
  return (setCookies ?? [])
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function checkVisitorChat(baseUrl) {
  const content = `smoke test ${new Date().toISOString()}`;
  const messageResponse = await fetchWithTimeout(`${baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const messageBody = await readJson(messageResponse);
  if (!messageResponse.ok) fail("Visitor message API failed", JSON.stringify(messageBody));

  const conversation = messageBody.conversation;
  if (!conversation?.id) fail("Visitor message response did not include a conversation id", JSON.stringify(messageBody));
  if (!conversation.messages?.some((message) => message.role === "visitor" && message.content === content)) {
    fail("Visitor message was not present in returned conversation", JSON.stringify(conversation));
  }

  const cookie = getCookieHeader(messageResponse);
  if (!cookie.includes("visitor_session=")) fail("Visitor message API did not set visitor_session cookie");

  const conversationResponse = await fetchWithTimeout(`${baseUrl}/api/chat/conversation`, {
    headers: { Cookie: cookie },
  });
  const conversationBody = await readJson(conversationResponse);
  if (!conversationResponse.ok) fail("Visitor conversation API failed", JSON.stringify(conversationBody));
  if (conversationBody.conversation?.id !== conversation.id) {
    fail("Visitor cookie did not resume the same conversation", JSON.stringify(conversationBody));
  }

  pass("visitor chat message and cookie resume flow works");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`[info] smoke testing ${options.baseUrl}`);

  const health = await waitForHealth(options);
  console.log(
    `[info] storage=${health.storage} database=${health.database?.provider}:${health.database?.migrationStatus} ai=${health.ai?.provider ?? "unknown"}:${health.ai?.model ?? "unknown"}`,
  );

  await checkWidget(options.baseUrl);
  if (!options.skipChat) await checkVisitorChat(options.baseUrl);

  console.log("[pass] smoke test completed");
}

main().catch((error) => {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
