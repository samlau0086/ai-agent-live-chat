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
- Agent console: http://localhost:3000/agent

If you set `APP_PORT=4000`, use `http://localhost:4000` instead.

Default local login:

- Username: `admin`
- Password: `admin123`

Runtime data is stored in `.data/store.json` for this MVP. The Prisma schema in `prisma/schema.prisma` defines the Postgres model intended for the production repository implementation.

## Deploy to a VPS with GitHub Actions

This repository includes `.github/workflows/deploy-vps.yml`. The workflow runs on every push to `main` or `master`, and can also be started manually from the GitHub Actions tab.

Deployment model:

1. GitHub Actions checks out the repository.
2. Actions runs `npm install` and `npm run build` with the mock AI provider to catch build errors.
3. Actions connects to the VPS over SSH.
4. Actions syncs the source code to the VPS with `rsync`.
5. The VPS runs `docker compose --env-file .env.production up -d --build`.
6. The app is served from the Docker container on `${APP_PORT:-3000}`.

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
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_agent_live_chat
AI_PROVIDER=mock
OPENAI_API_KEY=
SESSION_SECRET=replace-with-a-long-random-secret
WEBHOOK_SIGNING_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

The current Docker Compose file runs only the Next.js app container and persists the MVP file store in a Docker volume. Set the exposed host port with the GitHub Actions `APP_PORT` secret, not inside `VPS_ENV_FILE`. If you switch the runtime repository implementation to Prisma/Postgres, add a Postgres service or point `DATABASE_URL` at an external managed database.

## Communication model

The visitor live chat widget communicates with the backend through HTTP POST plus Server-Sent Events.

- Sending messages: the widget calls `POST /api/chat/messages` with `{ "content": "..." }`.
- Receiving live updates: the widget opens `GET /api/chat/stream` with `EventSource`.
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
- Conversation lists are loaded with `GET /api/agent/conversations`.
- Console live updates use `GET /api/agent/conversations?stream=1` and `GET /api/agent/conversations/:id/stream`.
- Manual handoff uses `POST /api/agent/conversations/:id/takeover`.
- Releasing back to AI uses `POST /api/agent/conversations/:id/release`.
- Human replies use `POST /api/agent/conversations/:id/messages`.

## Environment

- `APP_PORT`: Host port for local startup. For GitHub Actions VPS deployment, configure this as a repository secret instead of putting it in `VPS_ENV_FILE`. Defaults to `3000`.
- `PORT`: Alternative local startup port. `APP_PORT` takes precedence when both are set.
- `DATABASE_URL`: Postgres URL for the Prisma-backed repository.
- `AI_PROVIDER`: `mock` or `openai`.
- `OPENAI_API_KEY`: Required when `AI_PROVIDER=openai`.
- `OPENAI_MODEL`: Optional OpenAI chat model override.
- `SESSION_SECRET`: Signing secret for the agent session cookie.
- `WEBHOOK_SIGNING_SECRET`: Signing secret for inbound/outbound webhook payloads.
- `ADMIN_USERNAME`: Seed username for the file-store MVP.
- `ADMIN_PASSWORD`: Seed password for the file-store MVP.

## APIs

All examples assume the app is running at `http://localhost:3000`. If `APP_PORT=4000`, replace the base URL with `http://localhost:4000`.

### Visitor chat

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

#### `GET /api/chat/stream`

Streams the current visitor conversation via Server-Sent Events. The browser widget uses `EventSource`.

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
    "role": "admin"
  }
}
```

Errors:

- `401`: invalid username or password.

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
    "role": "admin"
  }
}
```

### Agent conversations

Agent APIs require the `agent_session` cookie from `POST /api/auth/login`.

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

#### `POST /api/agent/conversations/:id/release`

Switches the conversation back to `ai_active`.

```bash
curl -i -X POST http://localhost:3000/api/agent/conversations/con_123/release \
  -H "Cookie: agent_session=..."
```

### Integrations

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
