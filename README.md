# AI Agent Live Chat

A runnable MVP for AI-first live chat with manual human takeover.

## What is included

- Next.js App Router UI for the visitor chat at `/`.
- Agent console at `/agent`.
- Anonymous visitor session cookie.
- Simple signed-cookie agent login.
- AI provider abstraction with `mock` and `openai` providers.
- Manual takeover and release flow.
- SSE updates for visitor and agent views.
- Webhook signing helpers, inbound webhook API, outbound delivery logging.
- Static Agent tool registry and invocation logging.
- Prisma schema for the planned Postgres persistence model.
- Admin settings page at `/agent/settings` for AI configuration, knowledge base management, AI tests, and audit logs.
- Agent runtime with configurable AI behavior, knowledge retrieval, tool toggles, and automatic human handoff rules.
- Prisma-backed production repository selectable with `STORE_DRIVER=prisma`.
- Admin user management, operations metrics and exports, integration conversation APIs, and embeddable widget script.

## Roadmap

The product and technical roadmap is tracked in [roadmap.md](roadmap.md).

## Run locally

Copy `.env.example` to `.env.local` and adjust values if needed.

```bash
npm install
npm run dev
```

The app reads `APP_PORT` or `PORT` from `.env.local`, `.env`, or the shell. Default is `3000`.

Examples:

```bash
APP_PORT=4000 npm run dev
npm run dev
```

On Windows PowerShell:

```powershell
$env:APP_PORT="4000"; npm run dev
```

Open:

- Visitor chat: http://localhost:3000
- First-run setup: http://localhost:3000/setup
- Agent console: http://localhost:3000/agent
- Admin settings: http://localhost:3000/agent/settings

If you set `APP_PORT=4000`, use `http://localhost:4000` instead.

Default local login:

- Username: `admin`
- Password: `admin123`

When the default admin password is still active, `/setup` requires the current admin password and replaces it with a new password before the console can be used.

Local development defaults to `.data/store.json` through the file-store driver. Production can switch to the Prisma/Postgres repository by setting `STORE_DRIVER=prisma` and `DATABASE_URL`.

Database scripts:

```bash
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:backup
npm run db:restore -- --file .backups/live-chat-2026-06-19.dump --yes
```

The app defaults to `STORE_DRIVER=file` for local development. Set `STORE_DRIVER=prisma` with `DATABASE_URL` to use Postgres in production. The Prisma schema now includes production models for conversations, AI configuration, knowledge bases, chunks, audit logs, webhook deliveries, tags, and agent status.

## Deploy to a VPS with GitHub Actions

This repository includes `.github/workflows/deploy-vps.yml`. The workflow runs on every push to `main` or `master`, and can also be started manually from the GitHub Actions tab.

Deployment model:

1. GitHub Actions checks out the repository.
2. Actions runs `npm install` and `npm run build` with the mock AI provider to catch build errors.
3. Actions connects to the VPS over SSH.
4. Actions syncs the source code to the VPS with `rsync`.
5. The VPS starts Postgres, builds the app and migration tool images, runs `prisma migrate deploy`, runs `db:seed`, and starts the app container.
6. Actions runs the production smoke test from the Compose network against `http://app:3000`.
7. The app is served from the Docker container on `${APP_PORT:-3000}`.

VPS requirements:

- Docker and Docker Compose plugin installed.
- SSH access for the deploy user.
- The deploy user can run `docker compose`.
- A reverse proxy such as Nginx or Caddy is recommended for HTTPS and domain routing.

Required GitHub repository secrets:

- `VPS_HOST`: VPS hostname or IP address.
- `VPS_USER`: SSH username.
- `VPS_SSH_KEY`: Private SSH key used by GitHub Actions to connect to the VPS.

Optional GitHub repository secrets:

- `VPS_PORT`: SSH port. Defaults to `22`.
- `VPS_APP_DIR`: Deployment directory on the VPS. Defaults to `/opt/ai-agent-live-chat`.
- `APP_PORT`: Host port exposed by Docker Compose on the VPS. Defaults to `3000`.
- `VPS_ENV_FILE`: Full contents of the production `.env.production` file to write on the VPS.

If `VPS_ENV_FILE` is not configured, the workflow creates an empty `.env.production` file so Docker Compose can still start. For any public deployment, configure `VPS_ENV_FILE` with real secrets instead of relying on development defaults.

Example `VPS_ENV_FILE`:

```env
STORE_DRIVER=prisma
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_agent_live_chat
AI_PROVIDER=mock
OPENAI_API_KEY=
SESSION_SECRET=replace-with-a-long-random-secret
WEBHOOK_SIGNING_SECRET=replace-with-a-long-random-secret
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
DISCORD_PUBLIC_KEY=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_GRAPH_API_VERSION=v20.0
WECHAT_TOKEN=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

The Docker Compose file runs the Next.js app plus Postgres with pgvector. Set the exposed host port with the GitHub Actions `APP_PORT` secret, not inside `VPS_ENV_FILE`. The workflow builds the app image and the `migrate` tool image, runs `prisma migrate deploy` and `db:seed` through that tool image, starts the app, then runs `npm run smoke:test -- --base-url http://app:3000 --require-prisma --require-secrets` from the Compose network. The production app image stays a minimal Next.js standalone runtime and does not need the Prisma CLI.

The smoke test verifies:

- `/api/health` returns healthy status.
- Production health reports `storage=prisma`, PostgreSQL, migration status `ok`, and at least one applied migration.
- `SESSION_SECRET` and `WEBHOOK_SIGNING_SECRET` are not using development defaults when `--require-secrets` is enabled.
- `/widget.js` and `/api/chat/widget-config` are reachable and return the expected embed/config shape.
- Visitor message creation and cookie-based conversation resume work, unless `--skip-chat` is passed.

Run the same smoke test manually against a local or remote deployment:

```bash
npm run smoke:test -- --base-url http://localhost:3000
npm run smoke:test -- --base-url https://chat.example.com --require-prisma --require-secrets
```

When running from the VPS Compose network:

```bash
APP_PORT=3000 docker compose --env-file .env.production run --rm migrate npm run smoke:test -- --base-url http://app:3000 --require-prisma --require-secrets
```

After the first deployment, visit `/setup` on the VPS domain. If the seeded admin is still marked for password change, the setup wizard will replace the default password, clear first-run state, and open an admin session.

## Backup and restore

Production runtime state lives in Postgres when `STORE_DRIVER=prisma`. The repository includes wrapper scripts for the Docker Compose deployment model.

Create a compressed Postgres dump on the VPS:

```bash
cd /opt/ai-agent-live-chat
npm run db:backup
```

The default output path is `.backups/live-chat-<timestamp>.dump`. To choose a path or env file:

```bash
npm run db:backup -- --out /secure/backups/live-chat.dump --env-file .env.production
```

Restore a dump into the Compose Postgres service:

```bash
cd /opt/ai-agent-live-chat
npm run db:restore -- --file /secure/backups/live-chat.dump --yes
```

Restore is destructive: it uses `pg_restore --clean --if-exists`. Confirm the target VPS, project directory, and `.env.production` before running it.

Also back up production secrets:

- Keep an encrypted copy of `.env.production` or the GitHub `VPS_ENV_FILE` secret.
- Store `SESSION_SECRET`, `WEBHOOK_SIGNING_SECRET`, `DATABASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in a password manager or secret vault.
- Do not commit `.env.production`, dump files, or `.backups/` contents.

Recommended operating practice:

- Take a backup before running manual migrations or restoring data.
- Keep at least one recent off-server backup.
- Test restore on a non-production VPS before relying on a backup strategy.
- Rotate secrets if `.env.production` or a database dump may have been exposed.

## Communication model

The visitor live chat widget communicates with the backend through HTTP POST plus Server-Sent Events.

- Sending messages: the widget calls `POST /api/chat/messages` with `{ "content": "..." }`.
- Receiving live updates: the widget opens `GET /api/chat/stream` with `EventSource`.
- SSE streams send a `retry: 3000` hint and keep-alive comments; the widget shows connection state and falls back to `GET /api/chat/conversation` while EventSource reconnects.
- Visitor identity: the backend creates and reads the `visitor_session` HTTP-only cookie, so the widget does not need to pass a conversation id.
- Agent updates: when an agent takes over, replies, or releases a conversation, the backend publishes the latest conversation to the visitor SSE stream.

Message flow:

1. The widget opens `GET /api/chat/stream`.
2. The backend creates or loads the cookie-bound conversation and immediately streams the current state.
3. The widget sends visitor input to `POST /api/chat/messages`.
4. The backend stores the visitor message.
5. If the conversation status is `ai_active`, the backend calls the configured AI provider and stores the AI reply.
6. If the conversation status is `human_active`, the backend skips the AI reply and waits for an agent response.
7. Every message or status change is pushed back to the widget through SSE.

Agent console communication:

- The console signs in through `POST /api/auth/login`.
- Accounts marked with `forcePasswordChange`, or accounts expired by the password rotation policy, must complete `POST /api/auth/change-password` before using console APIs.
- Conversation lists are loaded with `GET /api/agent/conversations`.
- Console live updates use `GET /api/agent/conversations?stream=1` and `GET /api/agent/conversations/:id/stream`.
- The console displays inbox/conversation SSE health, falls back to `GET /api/agent/conversations` when streams disconnect, and refreshes agent activity through status heartbeats.
- SLA fields in the console are derived from conversation timestamps and messages: first visitor message, first AI/human response, latest unanswered visitor message, and current queue/human wait time.
- Manual handoff uses `POST /api/agent/conversations/:id/takeover`.
- Releasing back to AI uses `POST /api/agent/conversations/:id/release`.
- Human replies use `POST /api/agent/conversations/:id/messages`.

Admin communication:

- AI settings use `GET /api/admin/ai-config`, `PUT /api/admin/ai-config`, and `POST /api/admin/ai-config/test`.
- AI traces use `GET /api/admin/ai-traces`.
- Knowledge bases use `GET /api/admin/knowledge-bases`, `POST /api/admin/knowledge-bases`, document import, reindex, and search-test endpoints.
- Audit logs use `GET /api/admin/audit-logs`.
- Webhook endpoints use `GET /api/admin/webhooks` and `POST /api/admin/webhooks`.
- Tool registry introspection uses `GET /api/admin/tools`.
- Channel adapter introspection uses `GET /api/admin/channel-adapters`.
- User management uses `GET/POST /api/admin/users` and `PUT /api/admin/users/:id`.
- Invitation management uses `GET/POST /api/admin/invitations` and `POST /api/admin/invitations/:id/revoke`.
- Security settings use `GET/PUT /api/admin/security-settings`.
- Widget settings use `GET/PUT /api/admin/widget-config`.
- Operations reporting uses `GET /api/admin/metrics`.

## Environment

- `APP_PORT`: Host port for local startup. For GitHub Actions VPS deployment, configure this as a repository secret instead of putting it in `VPS_ENV_FILE`. Defaults to `3000`.
- `PORT`: Alternative local startup port. `APP_PORT` takes precedence when both are set.
- `STORE_DRIVER`: `file` for local file storage or `prisma` for Postgres. Defaults to `file` locally and `prisma` in Docker Compose.
- `DATABASE_URL`: Postgres URL for the Prisma-backed repository.
- `AI_PROVIDER`: `mock` or `openai`.
- `OPENAI_API_KEY`: Required when `AI_PROVIDER=openai`.
- `OPENAI_MODEL`: Optional OpenAI chat model override.
- `SESSION_SECRET`: Signing secret for the agent session cookie.
- `WEBHOOK_SIGNING_SECRET`: Signing secret for inbound/outbound webhook payloads.
- `SLACK_SIGNING_SECRET`: Slack app signing secret for `/api/integrations/slack/events`.
- `SLACK_BOT_TOKEN`: Optional Slack bot token used to post AI replies back into Slack threads.
- `DISCORD_PUBLIC_KEY`: Discord application public key for `/api/integrations/discord/interactions`.
- `WHATSAPP_VERIFY_TOKEN`: Meta webhook verification token for `/api/integrations/whatsapp/webhook`.
- `WHATSAPP_APP_SECRET`: Meta app secret used to validate `X-Hub-Signature-256`.
- `WHATSAPP_ACCESS_TOKEN`: Optional WhatsApp Cloud API token used to send AI replies.
- `WHATSAPP_GRAPH_API_VERSION`: Optional Graph API version for WhatsApp sends. Defaults to `v20.0`.
- `WECHAT_TOKEN`: WeChat Official Account server token for `/api/integrations/wechat/webhook`.
- `ADMIN_USERNAME`: Seed username for the file-store MVP.
- `ADMIN_PASSWORD`: Seed password for the file-store MVP.

## APIs

All examples assume the app is running at `http://localhost:3000`. If `APP_PORT=4000`, replace the base URL with `http://localhost:4000`.

### First-run setup

#### `GET /api/setup/status`

Returns whether the configured seed admin still requires first-run setup.

```bash
curl -i http://localhost:3000/api/setup/status
```

#### `POST /api/setup/complete`

Completes first-run setup for the configured admin user. This only works while that admin is marked with `forcePasswordChange=true`.

```bash
curl -i -X POST http://localhost:3000/api/setup/complete \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"currentPassword\":\"admin123\",\"newPassword\":\"replace-with-a-long-password\"}"
```

### Visitor chat

#### `GET /widget.js`

Returns an embeddable script that injects the live chat iframe. The iframe loads widget configuration from `GET /api/chat/widget-config`, so theme color, welcome copy, offline copy, satisfaction rating, end-chat confirmation, and transcript download can be changed without editing the embed code.

```html
<script src="https://your-domain.example/widget.js" async></script>
```

#### `GET /api/chat/widget-config`

Returns public widget settings plus whether at least one agent is currently online.

```bash
curl -i http://localhost:3000/api/chat/widget-config
```

Example response:

```json
{
  "widgetConfig": {
    "themeColor": "#1f2a44",
    "welcomeMessage": "Start a conversation.",
    "offlineMessage": "No human agents are online right now.",
    "enableSatisfaction": true,
    "enableTranscriptDownload": true,
    "requireEndConfirmation": true
  },
  "supportOnline": true
}
```

#### `POST /api/chat/messages`

Sends a visitor message. The backend creates or reuses the `visitor_session` cookie, appends the visitor message, and generates an AI reply when the conversation status is `ai_active`.

Request:

```bash
curl -i -X POST http://localhost:3000/api/chat/messages \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Hi, I need help with my order.\"}"
```

Body:

```json
{
  "content": "Hi, I need help with my order."
}
```

Success response:

```json
{
  "conversation": {
    "id": "con_...",
    "visitorSessionId": "vis_...",
    "status": "ai_active",
    "subject": "Hi, I need help with my order.",
    "metadata": {},
    "createdAt": "2026-06-18T00:00:00.000Z",
    "updatedAt": "2026-06-18T00:00:01.000Z",
    "messages": [
      {
        "id": "msg_...",
        "conversationId": "con_...",
        "role": "visitor",
        "content": "Hi, I need help with my order.",
        "metadata": {},
        "createdAt": "2026-06-18T00:00:00.000Z"
      },
      {
        "id": "msg_...",
        "conversationId": "con_...",
        "role": "ai",
        "content": "AI assistant: I received \"Hi, I need help with my order.\"...",
        "metadata": {},
        "createdAt": "2026-06-18T00:00:01.000Z"
      }
    ]
  }
}
```

Errors:

- `400`: `content` is missing or empty.

#### `GET /api/chat/conversation`

Returns the visitor's cookie-bound conversation. The browser widget uses this as an HTTP fallback when SSE is reconnecting.

```bash
curl -i http://localhost:3000/api/chat/conversation \
  -H "Cookie: visitor_session=..."
```

#### `GET /api/chat/stream`

Streams the current visitor conversation via Server-Sent Events. The browser widget uses `EventSource`, displays live/reconnecting state, and falls back to `GET /api/chat/conversation` while the browser reconnects.

Browser example:

```js
const source = new EventSource("/api/chat/stream");
source.onmessage = (event) => {
  const conversation = JSON.parse(event.data);
  console.log(conversation.status, conversation.messages);
};
```

CLI example:

```bash
curl -N http://localhost:3000/api/chat/stream
```

SSE event payload:

```text
data: {"id":"con_...","status":"ai_active","messages":[]}
```

#### `POST /api/chat/end`

Closes the visitor's cookie-bound conversation and emits the normal conversation update stream.

```bash
curl -i -X POST http://localhost:3000/api/chat/end \
  -H "Cookie: visitor_session=..."
```

#### `POST /api/chat/rating`

Stores a visitor satisfaction rating in conversation metadata.

```bash
curl -i -X POST http://localhost:3000/api/chat/rating \
  -H "Content-Type: application/json" \
  -H "Cookie: visitor_session=..." \
  -d "{\"rating\":5,\"comment\":\"Helpful answer.\"}"
```

#### `GET /api/chat/transcript`

Downloads a plain-text transcript for the visitor's cookie-bound conversation. Internal notes are filtered out.

```bash
curl -i http://localhost:3000/api/chat/transcript \
  -H "Cookie: visitor_session=..."
```

### Agent auth

#### `POST /api/auth/login`

Signs an agent in and sets an HTTP-only `agent_session` cookie.

Request:

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"admin123\"}"
```

Success response:

```json
{
  "user": {
    "id": "usr_...",
    "username": "admin",
    "role": "admin",
    "forcePasswordChange": true
  }
}
```

Errors:

- `401`: invalid username or password.
- `423`: account is temporarily locked after repeated failed sign-in attempts.

#### `POST /api/auth/change-password`

Changes the signed-in agent password. This endpoint is required before console APIs can be used when `forcePasswordChange` is `true` or the account has expired under the configured password rotation policy.

```bash
curl -i -X POST http://localhost:3000/api/auth/change-password \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"currentPassword\":\"admin123\",\"newPassword\":\"new-password\"}"
```

Errors:

- `400`: new password is too short or unchanged.
- `401`: missing session or incorrect current password.

#### `POST /api/auth/logout`

Clears the `agent_session` cookie.

```bash
curl -i -X POST http://localhost:3000/api/auth/logout
```

#### `GET /api/auth/me`

Returns the current signed-in agent, or `null` when not signed in.

```bash
curl -i http://localhost:3000/api/auth/me
```

Response:

```json
{
  "user": {
    "id": "usr_...",
    "username": "admin",
    "role": "admin",
    "forcePasswordChange": false
  }
}
```

#### `GET /api/invitations/:token`

Returns whether an invitation link is valid and which username/role it will create.

```bash
curl -i http://localhost:3000/api/invitations/invitation-token
```

Example response:

```json
{
  "ok": true,
  "status": "active",
  "invitation": {
    "username": "agent1",
    "role": "agent",
    "expiresAt": "2026-06-26T00:00:00.000Z"
  }
}
```

#### `POST /api/invitations/:token`

Accepts an invitation, creates the user, marks the invitation as accepted, and sets the `agent_session` cookie.

```bash
curl -i -X POST http://localhost:3000/api/invitations/invitation-token \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"replace-with-a-long-password\"}"
```

### Agent conversations

Agent APIs require the `agent_session` cookie from `POST /api/auth/login`. If `forcePasswordChange` is true or password rotation has expired, these APIs return `403` until the agent changes their password.

The agent console computes SLA indicators client-side from returned conversation messages:

- `first response`: elapsed time from the first visitor message to the first AI or human reply.
- `human wait`: elapsed time from the latest visitor message that has not yet received a human reply while the conversation is `queued_for_human` or `human_active`.
- Queue sorting prioritizes breached SLA conversations, then warning conversations, then queued/human-active conversations by longest wait time.
- Current thresholds are warning at 5 minutes and breach at 10 minutes.

#### `GET /api/agent/conversations`

Lists conversations for the agent console.

```bash
curl -i http://localhost:3000/api/agent/conversations \
  -H "Cookie: agent_session=..."
```

Response:

```json
{
  "conversations": [
    {
      "id": "con_...",
      "status": "ai_active",
      "subject": "Hi, I need help with my order.",
      "messages": []
    }
  ]
}
```

Errors:

- `401`: missing or invalid agent session.

#### `GET /api/agent/conversations?stream=1`

Streams conversation list updates for the agent inbox.

```bash
curl -N http://localhost:3000/api/agent/conversations?stream=1 \
  -H "Cookie: agent_session=..."
```

Initial SSE payload:

```text
data: {"conversations":[{"id":"con_...","status":"ai_active","messages":[]}]}
```

#### `GET /api/agent/conversations/:id/stream`

Streams one conversation for the active conversation view.

```bash
curl -N http://localhost:3000/api/agent/conversations/con_123/stream \
  -H "Cookie: agent_session=..."
```

#### `GET /api/agent/agents`

Lists assignable agents with their online/away/offline status and `statusUpdatedAt`. The agent console uses this for activity indicators and "last active" timestamps.

```bash
curl -i http://localhost:3000/api/agent/agents \
  -H "Cookie: agent_session=..."
```

#### `PUT /api/agent/status`

Updates the signed-in agent's presence. Valid statuses are `online`, `away`, and `offline`. The console refreshes this endpoint periodically as an activity heartbeat for admin and agent users.

```bash
curl -i -X PUT http://localhost:3000/api/agent/status \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"status\":\"online\"}"
```

#### `POST /api/agent/conversations/:id/takeover`

Switches the conversation to `human_active`. While this status is active, visitor messages no longer trigger AI replies.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/takeover \
  -H "Cookie: agent_session=..."
```

Success response:

```json
{
  "conversation": {
    "id": "con_123",
    "status": "human_active",
    "takenOverBy": {
      "id": "usr_...",
      "username": "admin",
      "role": "admin"
    }
  }
}
```

#### `POST /api/agent/conversations/:id/assign`

Assigns or transfers an open conversation to an agent. The conversation becomes `human_active` and AI replies are skipped while assigned.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/assign \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"agentId\":\"usr_123\"}"
```

#### `POST /api/agent/conversations/:id/messages`

Sends a human agent reply. The conversation must already be `human_active`.

Request:

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/messages \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"content\":\"I can help with that. What is your order number?\"}"
```

Body:

```json
{
  "content": "I can help with that. What is your order number?"
}
```

Errors:

- `400`: `content` is missing or empty.
- `401`: missing or invalid agent session.
- `404`: conversation id was not found.
- `409`: conversation is not currently `human_active`.

#### `PUT /api/agent/conversations/:id/operations`

Updates support workspace metadata for a conversation: tags, customer profile fields, and quick replies. Requires an `admin` or `agent` session. The data is returned to the agent console and stored on conversation metadata.

```bash
curl -i -X PUT http://localhost:3000/api/agent/conversations/con_123/operations \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"tags\":[{\"name\":\"vip\"},{\"name\":\"billing\"}],\"customerProfile\":{\"name\":\"Sam Lee\",\"email\":\"sam@example.com\",\"externalId\":\"cus_123\",\"plan\":\"Pro\",\"notes\":\"Prefers email follow-up.\"},\"quickReplies\":[\"Thanks for the details.\",\"I am checking this now.\"]}"
```

Body:

```json
{
  "tags": [{ "name": "vip" }, { "name": "billing" }],
  "customerProfile": {
    "name": "Sam Lee",
    "email": "sam@example.com",
    "externalId": "cus_123",
    "plan": "Pro",
    "notes": "Prefers email follow-up."
  },
  "quickReplies": ["Thanks for the details.", "I am checking this now."]
}
```

#### `POST /api/agent/conversations/:id/notes`

Adds an internal note as a `system` message with `metadata.internalNote=true`. Internal notes are visible in the agent console only; visitor chat responses and visitor SSE streams filter them out.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/notes \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"content\":\"Customer asked for billing follow-up after renewal.\"}"
```

Body:

```json
{
  "content": "Customer asked for billing follow-up after renewal."
}
```

#### `POST /api/agent/conversations/:id/release`

Switches the conversation back to `ai_active`.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/release \
  -H "Cookie: agent_session=..."
```

#### `POST /api/agent/conversations/:id/resolve`

Marks the conversation as `resolved`.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/resolve \
  -H "Cookie: agent_session=..."
```

#### `POST /api/agent/conversations/:id/close`

Marks the conversation as `closed` and emits `conversation.closed`.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/close \
  -H "Cookie: agent_session=..."
```

### Admin AI configuration

Admin APIs require an admin `agent_session` cookie.

#### `GET /api/admin/ai-config`

Returns the global AI configuration.

```bash
curl -i http://localhost:3000/api/admin/ai-config \
  -H "Cookie: agent_session=..."
```

#### `PUT /api/admin/ai-config`

Updates provider, model, prompt, RAG, tool, no-answer, and auto-handoff settings. Agent Runtime assembles the final provider prompt, trims history, injects knowledge context and tool availability, handles fallback decisions, and records traces. OpenAI requests include structured `tools` definitions when tools are enabled; returned tool calls are recorded as placeholders and are not executed automatically. Auto-handoff supports user request patterns, sensitive keywords, VIP metadata, repeated AI fallback failures, and low-confidence knowledge hits.

`noAnswerStrategy` controls what happens when knowledge base retrieval is enabled but returns no chunks for the latest visitor message:

- `continue`: continue AI generation with an uncertainty caveat instruction.
- `fallback`: return the configured `fallbackMessage` without calling the AI provider.
- `handoff`: set the conversation to `queued_for_human` and add a system handoff note.
- `transfer`: immediately queue the conversation for human support using the same queue state, with a distinct transfer reason for audit/trace logs.

```bash
curl -i -X PUT http://localhost:3000/api/admin/ai-config \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"provider\":\"mock\",\"model\":\"gpt-4o-mini\",\"temperature\":0.2,\"enableKnowledgeBase\":true,\"enableTools\":true,\"noAnswerStrategy\":\"continue\",\"autoHandoff\":{\"enabled\":true,\"userRequestPatterns\":[\"human\"],\"sensitiveKeywords\":[\"refund\"],\"vipMetadataKeys\":[\"vip\"],\"aiFailureThreshold\":2,\"lowConfidenceKnowledgeScoreThreshold\":0.2}}"
```

#### `POST /api/admin/ai-config/test`

Runs a test generation through Agent Runtime without creating a real visitor conversation. The response includes the AI reply, retrieved knowledge chunks, prompt structure summary, provider/model, latency, fallback reason, and handoff decision. The test also records an AI trace.

```bash
curl -i -X POST http://localhost:3000/api/admin/ai-config/test \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"message\":\"How can I contact support?\"}"
```

#### `GET /api/admin/ai-traces`

Returns recent Agent Runtime traces for real conversations and admin test runs.

```bash
curl -i "http://localhost:3000/api/admin/ai-traces?limit=25" \
  -H "Cookie: agent_session=..."
```

### Admin knowledge base

#### `GET /api/admin/knowledge-bases`

Lists knowledge bases, sources, documents, and embedding metadata. Documents are backed by production knowledge models: `KnowledgeSource`, `KnowledgeDocument`, `KnowledgeChunk`, and `KnowledgeEmbedding`. Search hits and AI reply metadata include source IDs, source names, source types, document IDs, chunk IDs, chunk ordinals, and scores for internal inspection and future citations.
The indexing pipeline cleans pasted text, splits it into chunks, generates deterministic local hash embeddings (`local_hash` / `hashing-v1`), records indexing failures on the document, and supports reindexing. In Prisma/Postgres mode, embeddings are stored in pgvector and retrieval asks Postgres for vector top-k candidates, merges them with keyword candidates, and reranks with a weighted hybrid score. If vector data is unavailable, search falls back to keyword scoring.
The admin UI shows indexing status, failed document reasons, source counts, embedding counts, search hit previews, and reindex controls.

```bash
curl -i http://localhost:3000/api/admin/knowledge-bases \
  -H "Cookie: agent_session=..."
```

#### `POST /api/admin/knowledge-bases`

Creates a knowledge base.

```bash
curl -i -X POST http://localhost:3000/api/admin/knowledge-bases \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"name\":\"Support FAQ\",\"description\":\"Public support answers\"}"
```

#### `POST /api/admin/knowledge-bases/:id/documents`

Adds a manual, text, Markdown, URL, PDF, or Docx document source and indexes it into searchable chunks. URL sources require `sourceType:"url"` and `sourceUri`; the backend fetches `text/html` or `text/plain`, extracts readable text, and stores the URL on the `KnowledgeSource`. PDF and Docx sources use multipart upload with a `file` field; the backend extracts text before indexing.

```bash
curl -i -X POST http://localhost:3000/api/admin/knowledge-bases/kb_123/documents \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"title\":\"Refund policy\",\"content\":\"Refunds are processed within 5 business days.\",\"sourceType\":\"manual\"}"
```

URL source example:

```bash
curl -i -X POST http://localhost:3000/api/admin/knowledge-bases/kb_123/documents \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"sourceType\":\"url\",\"sourceUri\":\"https://example.com/help/refunds\"}"
```

PDF or Docx upload example:

```bash
curl -i -X POST http://localhost:3000/api/admin/knowledge-bases/kb_123/documents \
  -H "Cookie: agent_session=..." \
  -F "sourceType=pdf" \
  -F "title=Refund policy PDF" \
  -F "file=@./refund-policy.pdf"
```

#### `POST /api/admin/knowledge-bases/:id/reindex`

Rebuilds chunks for all enabled documents in a knowledge base.

```bash
curl -i -X POST http://localhost:3000/api/admin/knowledge-bases/kb_123/reindex \
  -H "Cookie: agent_session=..."
```

#### `POST /api/admin/knowledge-bases/:id/search-test`

Searches indexed chunks and returns ranked matches. In production Prisma mode, this uses query rewrite, pgvector candidate retrieval, keyword matching, optional source-type filtering, and hybrid reranking.

```bash
curl -i -X POST http://localhost:3000/api/admin/knowledge-bases/kb_123/search-test \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"query\":\"refund time\",\"topK\":5,\"sourceTypes\":[\"url\"],\"keywordWeight\":0.65,\"vectorWeight\":0.35,\"minScore\":0.05,\"candidateMultiplier\":20}"
```

### Admin operations

#### `GET /api/health`

Returns deployment health, storage status, database migration status, AI configuration status, and secret configuration warnings. The endpoint returns `503` when storage or AI configuration cannot be checked.

```bash
curl -i http://localhost:3000/api/health
```

Example response:

```json
{
  "ok": true,
  "time": "2026-06-19T00:00:00.000Z",
  "storage": "prisma",
  "database": {
    "ok": true,
    "provider": "postgresql",
    "migrationStatus": "ok",
    "appliedMigrations": 1,
    "latestMigration": "20260619000000_initial"
  },
  "ai": {
    "ok": true,
    "provider": "mock",
    "model": "gpt-4o-mini",
    "openAIKeyConfigured": false
  },
  "secrets": {
    "sessionSecretConfigured": true,
    "webhookSigningSecretConfigured": true,
    "insecureDefaults": []
  }
}
```

#### `GET /api/admin/audit-logs`

Returns recent audit logs.

```bash
curl -i http://localhost:3000/api/admin/audit-logs \
  -H "Cookie: agent_session=..."
```

#### `GET /api/admin/tools`

Returns configured Agent tool definitions, including input schema, auth config, timeout, enabled state, permission scope, and whether a server runtime implementation exists.

```bash
curl -i http://localhost:3000/api/admin/tools \
  -H "Cookie: agent_session=..."
```

#### `GET /api/admin/channel-adapters`

Lists channel adapters and whether each one is implemented or planned. REST, Slack, Discord, WhatsApp, and WeChat are implemented.

```bash
curl -i http://localhost:3000/api/admin/channel-adapters \
  -H "Cookie: agent_session=..."
```

#### `POST /api/admin/tools`

Creates or updates a tool definition. Admin role is required. Built-in tools can be enabled/disabled or scoped without changing code; definition-only tools are stored for future integrations but cannot execute until a server runtime implementation exists.
Seeded tool templates include `crm_lookup`, `order_lookup`, `ticket_create`, `refund_status`, `subscription_status`, and `user_profile_sync`. These templates start disabled with `permissionScope:"disabled"` so they can be configured safely before an external system adapter is implemented.

```bash
curl -i -X POST http://localhost:3000/api/admin/tools \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"name\":\"lookup_customer_profile\",\"description\":\"Returns known customer metadata.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"conversationId\":{\"type\":\"string\"}},\"additionalProperties\":true},\"authConfig\":{},\"timeoutMs\":5000,\"enabled\":true,\"permissionScope\":\"ai\"}"
```

#### `GET /api/admin/webhooks`

Lists outbound webhook endpoints and delivery logs, including retry settings and failure details used by the admin Webhooks panel.

```bash
curl -i http://localhost:3000/api/admin/webhooks \
  -H "Cookie: agent_session=..."
```

#### `POST /api/admin/webhooks`

Creates an outbound webhook endpoint with event subscriptions, an optional signing secret, and retry strategy fields.

```bash
curl -i -X POST http://localhost:3000/api/admin/webhooks \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"name\":\"Ops\",\"url\":\"https://example.com/webhook\",\"secret\":\"endpoint-secret\",\"events\":[\"message.created\",\"handoff.started\"],\"retryMaxAttempts\":3,\"retryBackoffSeconds\":30}"
```

Webhook deliveries use this envelope:

```json
{
  "event": "message.created",
  "eventVersion": "2026-06-19",
  "occurredAt": "2026-06-19T08:00:00.000Z",
  "payload": {}
}
```

Supported outbound event contracts:

| Event | Meaning | Main payload fields |
| --- | --- | --- |
| `conversation.created` | A conversation was created by the widget or a trusted integration. | `conversation`, `metadata` |
| `message.created` | A visitor, AI, human agent, system, or tool message was appended. | `message`, `conversation` |
| `handoff.started` | A conversation entered human support through manual takeover, assignment, or auto-handoff. | `conversation`, `reason`, `actorId`, `assignedToId` |
| `handoff.released` | A human released the conversation back to AI handling. | `conversation`, `actorId` |
| `conversation.resolved` | A human marked the conversation resolved. | `conversation`, `actorId` |
| `conversation.closed` | A conversation was closed by an agent or the visitor. | `conversation`, `metadata` |
| `ai.fallback` | Agent Runtime returned a fallback response or failed over from provider/tool-call output. | `conversation`, `trace`, `reason`, `replyMessageId` |
| `knowledge.hit` | Agent Runtime retrieved one or more knowledge chunks for a visitor message. | `conversation`, `sources`, `traceId` |
| `tool.invocation` | A server-side tool invocation completed or failed. | `toolInvocation` |

Outbound requests are signed with `X-Live-Chat-Signature`, an HMAC-SHA256 signature over the raw envelope body using the endpoint secret when configured, otherwise `WEBHOOK_SIGNING_SECRET`.

#### `POST /api/admin/webhooks/deliveries/:id/replay`

Replays a failed webhook delivery by sending the original event and payload to the original endpoint. A replay creates a new delivery log entry with an incremented attempt count.

```bash
curl -i -X POST http://localhost:3000/api/admin/webhooks/deliveries/whd_123/replay \
  -H "Cookie: agent_session=..."
```

#### `GET /api/admin/users`

Lists users without password hashes. The response includes security metadata such as failed login count, lockout timestamp, password change timestamp, and whether a password change is required.

```bash
curl -i http://localhost:3000/api/admin/users \
  -H "Cookie: agent_session=..."
```

#### `POST /api/admin/users`

Creates an admin, agent, or viewer account. New users can be marked to change their password on first sign-in.

```bash
curl -i -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"username\":\"agent1\",\"password\":\"change-me\",\"role\":\"agent\",\"forcePasswordChange\":true}"
```

#### `PUT /api/admin/users/:id`

Updates a user role, disables/enables a user, resets a password, toggles the password-change flag, or unlocks a locked account. Accounts lock for 15 minutes after 5 failed sign-in attempts.

```bash
curl -i -X PUT http://localhost:3000/api/admin/users/usr_123 \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"role\":\"viewer\",\"disabled\":true}"
```

Reset and require password change:

```bash
curl -i -X PUT http://localhost:3000/api/admin/users/usr_123 \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"password\":\"new-password\",\"forcePasswordChange\":true}"
```

Unlock:

```bash
curl -i -X PUT http://localhost:3000/api/admin/users/usr_123 \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"unlock\":true}"
```

#### `GET /api/admin/invitations`

Lists user invitations without token hashes.

```bash
curl -i http://localhost:3000/api/admin/invitations \
  -H "Cookie: agent_session=..."
```

#### `POST /api/admin/invitations`

Creates a one-time invitation link. The backend stores only the token hash; `acceptUrl` is returned only in this response.

```bash
curl -i -X POST http://localhost:3000/api/admin/invitations \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"username\":\"agent2\",\"role\":\"agent\",\"expiresInDays\":7}"
```

Example response:

```json
{
  "invitation": {
    "id": "inv_...",
    "username": "agent2",
    "role": "agent",
    "expiresAt": "2026-06-26T00:00:00.000Z",
    "createdAt": "2026-06-19T00:00:00.000Z"
  },
  "token": "...",
  "acceptUrl": "http://localhost:3000/invite/..."
}
```

#### `POST /api/admin/invitations/:id/revoke`

Revokes an unused invitation.

```bash
curl -i -X POST http://localhost:3000/api/admin/invitations/inv_123/revoke \
  -H "Cookie: agent_session=..."
```

#### `GET /api/admin/security-settings`

Returns account security policy settings.

```bash
curl -i http://localhost:3000/api/admin/security-settings \
  -H "Cookie: agent_session=..."
```

#### `PUT /api/admin/security-settings`

Updates failed-login lockout and password rotation policy. `passwordRotationDays=0` disables password rotation enforcement.

```bash
curl -i -X PUT http://localhost:3000/api/admin/security-settings \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"failedLoginLockoutThreshold\":5,\"lockoutMinutes\":15,\"passwordRotationDays\":90}"
```

#### `GET /api/admin/widget-config`

Returns visitor widget configuration. Admin role is required.

```bash
curl -i http://localhost:3000/api/admin/widget-config \
  -H "Cookie: agent_session=..."
```

#### `PUT /api/admin/widget-config`

Updates visitor widget theme, welcome message, offline message, satisfaction rating, transcript download, and end-chat confirmation settings.

```bash
curl -i -X PUT http://localhost:3000/api/admin/widget-config \
  -H "Content-Type: application/json" \
  -H "Cookie: agent_session=..." \
  -d "{\"themeColor\":\"#2e6f57\",\"welcomeMessage\":\"How can we help?\",\"offlineMessage\":\"Leave a message and we will follow up.\",\"enableSatisfaction\":true,\"enableTranscriptDownload\":true,\"requireEndConfirmation\":true}"
```

#### `GET /api/admin/metrics`

Returns filtered operations metrics for admin and viewer roles, including conversation volume, AI/human message counts, human handoff rate, AI resolution rate, first response time, resolution time, knowledge hit rate, satisfaction score, status breakdown, and channel breakdown.

```bash
curl -i "http://localhost:3000/api/admin/metrics?dateFrom=2026-06-01T00:00:00.000Z&dateTo=2026-06-19T23:59:59.000Z&channel=web&status=resolved" \
  -H "Cookie: agent_session=..."
```

Supported filters: `dateFrom`, `dateTo`, `agentId`, `channel`, `tag`, `status`, and `knowledgeBaseId`.

#### `GET /api/admin/reviews`

Returns review queues for low-rating conversations and unresolved conversations. Admin and viewer roles can read this endpoint.

```bash
curl -i "http://localhost:3000/api/admin/reviews?lowRatingThreshold=2&limit=20" \
  -H "Cookie: agent_session=..."
```

Response includes `reviews.lowRating` and `reviews.unresolved`, with conversation id, status, channel, rating/comment, latest visitor message, and AI/human message counts.

#### `GET /api/admin/missed-questions`

Returns lightweight missed-question clusters and candidate knowledge base entries. It groups visitor questions that led to AI fallback, no-knowledge handoff, low-confidence knowledge handoff, AI errors, ungrounded AI replies, or no response.

```bash
curl -i "http://localhost:3000/api/admin/missed-questions?limit=20&minClusterSize=1" \
  -H "Cookie: agent_session=..."
```

Response includes cluster counts, miss reasons, source channels, examples, and `suggestedKnowledgeEntry` objects that can be used as candidate FAQ/manual knowledge entries.

#### `GET /api/admin/knowledge-gaps`

Returns knowledge gap analysis for frequent questions with no reliable hit, stale documents, failed indexing documents, low-performing chunks, and fallback trends.

```bash
curl -i "http://localhost:3000/api/admin/knowledge-gaps?limit=20&staleDays=90&lowScoreThreshold=0.2" \
  -H "Cookie: agent_session=..."
```

Response includes `frequentNoReliableHits`, `staleDocuments`, `failedDocuments`, `lowPerformingChunks`, and `fallbackTrends`.

#### `GET /api/admin/exports`

Exports analytics data and conversation transcripts for admin and viewer roles. Supported export types are `metrics`, `conversations`, and `transcripts`. Supported formats are `json` and `csv`.

The endpoint accepts the same filters as `/api/admin/metrics`: `dateFrom`, `dateTo`, `agentId`, `channel`, `tag`, `status`, and `knowledgeBaseId`. Conversation and transcript exports also support `conversationId`, `limit`, and `includeInternal=1`.

Export filtered metrics as JSON:

```bash
curl -L "http://localhost:3000/api/admin/exports?type=metrics&format=json&dateFrom=2026-06-01T00:00:00.000Z&dateTo=2026-06-19T23:59:59.000Z&channel=web" \
  -H "Cookie: agent_session=..." \
  -o live-chat-metrics.json
```

Export conversation summary rows as CSV:

```bash
curl -L "http://localhost:3000/api/admin/exports?type=conversations&format=csv&status=resolved&limit=1000" \
  -H "Cookie: agent_session=..." \
  -o live-chat-conversations.csv
```

Export a single conversation transcript as CSV:

```bash
curl -L "http://localhost:3000/api/admin/exports?type=transcripts&format=csv&conversationId=con_123" \
  -H "Cookie: agent_session=..." \
  -o live-chat-transcript.csv
```

By default, transcript exports omit internal notes. Add `includeInternal=1` when an admin audit or support review needs internal note rows included.

### Integrations

Integration APIs use the same `X-Live-Chat-Signature` HMAC-SHA256 signature as inbound webhooks.

#### `POST /api/integrations/rest/messages`

REST channel adapter endpoint for trusted external systems. It creates or reuses a conversation from `externalConversationId`, appends a visitor message, publishes SSE updates, emits outbound webhook events, and triggers AI when the conversation is still `ai_active`.

```bash
curl -i -X POST http://localhost:3000/api/integrations/rest/messages \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"externalConversationId\":\"rest_thread_123\",\"externalUserId\":\"cus_456\",\"content\":\"Do you support annual billing?\",\"subject\":\"Billing\",\"metadata\":{\"channelAccount\":\"partner-api\"},\"messageMetadata\":{\"providerMessageId\":\"msg_789\"},\"profile\":{\"name\":\"Ada Chen\",\"email\":\"ada@example.com\",\"plan\":\"enterprise\"}}"
```

Request fields:

| Field | Required | Notes |
| --- | --- | --- |
| `content` | Yes | Visitor message text. |
| `externalConversationId` | Required unless `conversationId` is provided | Stable thread id from the external REST channel. Stored as visitor session `rest:<externalConversationId>`. |
| `conversationId` | Optional | Internal conversation id. If provided, the adapter appends to that conversation. |
| `externalUserId` | Optional | Binds the external user id to the conversation. |
| `metadata` | Optional | Conversation metadata merged into the conversation. |
| `messageMetadata` | Optional | Metadata stored on the visitor message. |
| `profile` | Optional | Customer profile fields stored under `metadata.customerProfile`. |

Example response:

```json
{
  "adapter": "rest",
  "created": true,
  "message": {
    "id": "msg_123",
    "role": "visitor",
    "content": "Do you support annual billing?"
  },
  "ai": {
    "action": "replied",
    "replyMessageId": "msg_124"
  },
  "conversation": {
    "id": "con_123",
    "externalUserId": "cus_456",
    "status": "ai_active",
    "messageCount": 2
  }
}
```

#### `POST /api/integrations/slack/events`

Slack Events API adapter endpoint. Configure this URL in the Slack app Events API request URL, set `SLACK_SIGNING_SECRET`, and subscribe to message events. The endpoint supports Slack URL verification, validates `X-Slack-Signature`, ignores bot/subtype events, maps Slack threads to conversations, writes Slack messages as visitor messages, and triggers AI when the conversation is `ai_active`.

If `SLACK_BOT_TOKEN` is configured, AI replies are posted back to the Slack thread with `chat.postMessage`. If it is missing, the conversation and AI response are still stored in Live Chat, but Slack delivery is reported as skipped.

```bash
curl -i -X POST http://localhost:3000/api/integrations/slack/events \
  -H "Content-Type: application/json" \
  -H "X-Slack-Request-Timestamp: <unix_timestamp>" \
  -H "X-Slack-Signature: v0=<signature>" \
  -d "{\"type\":\"event_callback\",\"team_id\":\"T123\",\"api_app_id\":\"A123\",\"event_id\":\"Ev123\",\"event\":{\"type\":\"message\",\"channel\":\"C123\",\"user\":\"U123\",\"text\":\"I need help with billing\",\"ts\":\"1718790000.000100\"}}"
```

Slack request signing uses base string `v0:<timestamp>:<raw_body>` and HMAC-SHA256 with `SLACK_SIGNING_SECRET`.

#### `POST /api/integrations/discord/interactions`

Discord Interactions adapter endpoint. Configure this URL as the Discord app interactions endpoint and set `DISCORD_PUBLIC_KEY`. The endpoint validates `X-Signature-Ed25519` and `X-Signature-Timestamp`, answers Discord PING requests, maps slash-command interactions to conversations, writes the command option text as a visitor message, triggers AI when the conversation is `ai_active`, and returns the AI reply as an immediate interaction response.

The first string command option is treated as the visitor message. A typical slash command can be named `chat` with a required string option named `message`.

```bash
curl -i -X POST http://localhost:3000/api/integrations/discord/interactions \
  -H "Content-Type: application/json" \
  -H "X-Signature-Ed25519: <signature>" \
  -H "X-Signature-Timestamp: <unix_timestamp>" \
  -d "{\"id\":\"int_123\",\"application_id\":\"app_123\",\"type\":2,\"guild_id\":\"guild_123\",\"channel_id\":\"chan_123\",\"member\":{\"user\":{\"id\":\"user_123\",\"username\":\"ada\"}},\"data\":{\"name\":\"chat\",\"options\":[{\"name\":\"message\",\"type\":3,\"value\":\"Can you help with billing?\"}]}}"
```

Discord request signing verifies Ed25519 over `<timestamp><raw_body>` with the Discord application public key.

#### `GET/POST /api/integrations/whatsapp/webhook`

WhatsApp Cloud API webhook adapter endpoint. Configure this URL in the Meta app webhook settings, set `WHATSAPP_VERIFY_TOKEN`, and subscribe to WhatsApp message events. `GET` handles webhook verification by echoing `hub.challenge`; `POST` validates `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`, extracts inbound text messages, maps phone-number/user pairs to conversations, writes visitor messages, triggers AI when the conversation is `ai_active`, and optionally sends AI replies through the WhatsApp Cloud API.

If `WHATSAPP_ACCESS_TOKEN` is configured, AI replies are sent to WhatsApp through `/{phone-number-id}/messages`. If it is missing, the conversation and AI response are still stored in Live Chat, but WhatsApp delivery is reported as skipped.

Verification example:

```bash
curl -i "http://localhost:3000/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<verify_token>&hub.challenge=12345"
```

Webhook event example:

```bash
curl -i -X POST http://localhost:3000/api/integrations/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=<signature>" \
  -d "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"waba_123\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"15551234567\",\"phone_number_id\":\"phone_123\"},\"contacts\":[{\"wa_id\":\"15557654321\",\"profile\":{\"name\":\"Ada Chen\"}}],\"messages\":[{\"id\":\"wamid.123\",\"from\":\"15557654321\",\"timestamp\":\"1718790000\",\"type\":\"text\",\"text\":{\"body\":\"Can you help with billing?\"}}]}}]}]}"
```

WhatsApp request signing verifies HMAC-SHA256 over the raw request body with `WHATSAPP_APP_SECRET`.

#### `GET/POST /api/integrations/wechat/webhook`

WeChat Official Account plaintext webhook adapter endpoint. Configure this URL in the WeChat server settings and set `WECHAT_TOKEN`. `GET` validates `signature`, `timestamp`, and `nonce`, then returns `echostr`; `POST` validates the same signature, parses plaintext XML text messages, maps `ToUserName`/`FromUserName` pairs to conversations, writes visitor messages, triggers AI when the conversation is `ai_active`, and returns a synchronous XML text reply.

Encrypted WeChat message mode is not implemented in this MVP adapter; configure plaintext mode for this endpoint.

Verification example:

```bash
curl -i "http://localhost:3000/api/integrations/wechat/webhook?signature=<signature>&timestamp=<timestamp>&nonce=<nonce>&echostr=hello"
```

Text message example:

```bash
curl -i -X POST "http://localhost:3000/api/integrations/wechat/webhook?signature=<signature>&timestamp=<timestamp>&nonce=<nonce>" \
  -H "Content-Type: application/xml" \
  -d "<xml><ToUserName><![CDATA[gh_123]]></ToUserName><FromUserName><![CDATA[openid_456]]></FromUserName><CreateTime>1718790000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[Can you help with billing?]]></Content><MsgId>1234567890</MsgId></xml>"
```

WeChat request signing sorts `WECHAT_TOKEN`, `timestamp`, and `nonce`, joins them, and compares the SHA-1 digest with `signature`.

#### `POST /api/integrations/conversations`

Creates a conversation from an external system.

```bash
curl -i -X POST http://localhost:3000/api/integrations/conversations \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"externalUserId\":\"cus_456\",\"subject\":\"Billing question\",\"metadata\":{\"plan\":\"pro\"}}"
```

#### `POST /api/integrations/conversations/:id/messages`

Appends an integration message to a conversation.

```bash
curl -i -X POST http://localhost:3000/api/integrations/conversations/con_123/messages \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"role\":\"system\",\"content\":\"CRM profile attached.\"}"
```

Allowed roles are `visitor`, `system`, and `tool`. If omitted or invalid, the message is stored as `system`.

#### `PUT /api/integrations/conversations/:id/identity`

Binds or replaces the external user id for an existing conversation. Optional metadata is merged into the conversation.

```bash
curl -i -X PUT http://localhost:3000/api/integrations/conversations/con_123/identity \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"externalUserId\":\"cus_456\",\"metadata\":{\"source\":\"crm\",\"segment\":\"enterprise\"}}"
```

Response:

```json
{
  "conversation": {
    "id": "con_123",
    "externalUserId": "cus_456",
    "metadata": {
      "source": "crm",
      "segment": "enterprise"
    }
  }
}
```

#### `PUT /api/integrations/conversations/:id/profile`

Updates customer profile fields on a conversation. Supported profile fields are `name`, `email`, `externalId`, `plan`, and `notes`. If `externalUserId` is provided, it is bound to the conversation in the same request.

```bash
curl -i -X PUT http://localhost:3000/api/integrations/conversations/con_123/profile \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"externalUserId\":\"cus_456\",\"profile\":{\"name\":\"Ada Chen\",\"email\":\"ada@example.com\",\"plan\":\"enterprise\",\"notes\":\"Prefers email follow-up.\"},\"metadata\":{\"crmLastSyncedAt\":\"2026-06-19T08:00:00.000Z\"}}"
```

The profile is stored under conversation metadata as `customerProfile`, so the agent console can show it in the visitor profile panel.

#### `POST /api/integrations/conversations/:id/notes`

Appends an external system note as a `system` message. Set `internal` to `true` when the note should be treated as internal metadata by downstream consumers.

```bash
curl -i -X POST http://localhost:3000/api/integrations/conversations/con_123/notes \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"content\":\"CRM risk score changed to high.\",\"internal\":true,\"metadata\":{\"crmEventId\":\"evt_789\"}}"
```

#### `PUT /api/integrations/conversations/:id/metadata`

Merges metadata into an existing conversation.

```bash
curl -i -X PUT http://localhost:3000/api/integrations/conversations/con_123/metadata \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"metadata\":{\"crmCustomerId\":\"cus_456\"},\"note\":\"Customer is on pro plan.\"}"
```

#### `POST /api/integrations/knowledge-bases/:id/documents`

Syncs an external text document into a knowledge base, stores the source as `external`, indexes chunks, and records source metadata. The request must be signed with `X-Live-Chat-Signature`.

```bash
curl -i -X POST http://localhost:3000/api/integrations/knowledge-bases/kb_123/documents \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"externalId\":\"article_456\",\"title\":\"Shipping rules\",\"content\":\"Orders ship within 2 business days.\",\"sourceUri\":\"https://crm.example/articles/456\",\"metadata\":{\"system\":\"crm\"}}"
```

#### `POST /api/integrations/webhooks/inbound`

Lets trusted external systems merge metadata or add a system note to an existing conversation.

Inbound webhooks must include `X-Live-Chat-Signature`, an HMAC-SHA256 signature of the raw JSON payload using `WEBHOOK_SIGNING_SECRET`.

Body:

```json
{
  "conversationId": "con_123",
  "metadata": {
    "crmCustomerId": "cus_456",
    "plan": "pro"
  },
  "note": "Customer has an open priority ticket."
}
```

Node signature example:

```js
import crypto from "node:crypto";

const body = JSON.stringify({
  conversationId: "con_123",
  metadata: { crmCustomerId: "cus_456", plan: "pro" },
  note: "Customer has an open priority ticket.",
});

const signature = crypto
  .createHmac("sha256", process.env.WEBHOOK_SIGNING_SECRET)
  .update(body)
  .digest("hex");
```

Request:

```bash
curl -i -X POST http://localhost:3000/api/integrations/webhooks/inbound \
  -H "Content-Type: application/json" \
  -H "X-Live-Chat-Signature: <signature>" \
  -d "{\"conversationId\":\"con_123\",\"metadata\":{\"crmCustomerId\":\"cus_456\"},\"note\":\"Customer has an open priority ticket.\"}"
```

Errors:

- `400`: `conversationId` is missing.
- `401`: invalid webhook signature.
- `404`: conversation id was not found.
