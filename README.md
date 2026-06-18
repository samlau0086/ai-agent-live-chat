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

Open:

- Visitor chat: http://localhost:3000
- Agent console: http://localhost:3000/agent

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
5. The VPS runs `docker compose up -d --build`.
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
- `VPS_ENV_FILE`: Full contents of the production `.env.production` file to write on the VPS.

Example `VPS_ENV_FILE`:

```env
APP_PORT=3000
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ai_agent_live_chat
AI_PROVIDER=mock
OPENAI_API_KEY=
SESSION_SECRET=replace-with-a-long-random-secret
WEBHOOK_SIGNING_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

The current Docker Compose file runs only the Next.js app container and persists the MVP file store in a Docker volume. If you switch the runtime repository implementation to Prisma/Postgres, add a Postgres service or point `DATABASE_URL` at an external managed database.

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

- `DATABASE_URL`: Postgres URL for the Prisma-backed repository.
- `AI_PROVIDER`: `mock` or `openai`.
- `OPENAI_API_KEY`: Required when `AI_PROVIDER=openai`.
- `OPENAI_MODEL`: Optional OpenAI chat model override.
- `SESSION_SECRET`: Signing secret for the agent session cookie.
- `WEBHOOK_SIGNING_SECRET`: Signing secret for inbound/outbound webhook payloads.
- `ADMIN_USERNAME`: Seed username for the file-store MVP.
- `ADMIN_PASSWORD`: Seed password for the file-store MVP.

## APIs

- `POST /api/chat/messages`: sends a visitor message. Body: `{ "content": string }`.
- `GET /api/chat/stream`: streams the visitor's current conversation via SSE.
- `POST /api/auth/login`: signs an agent in. Body: `{ "username": string, "password": string }`.
- `POST /api/auth/logout`: clears the agent session cookie.
- `GET /api/auth/me`: returns the current signed-in agent.
- `GET /api/agent/conversations`: lists conversations for the agent console.
- `GET /api/agent/conversations?stream=1`: streams conversation list updates via SSE.
- `GET /api/agent/conversations/:id/stream`: streams one conversation via SSE.
- `POST /api/agent/conversations/:id/takeover`: switches the conversation to `human_active`.
- `POST /api/agent/conversations/:id/release`: switches the conversation back to `ai_active`.
- `POST /api/agent/conversations/:id/messages`: sends a human agent reply. Body: `{ "content": string }`.
- `POST /api/integrations/webhooks/inbound`: lets trusted external systems merge metadata or add a system note.

Inbound webhooks must include `X-Live-Chat-Signature`, an HMAC-SHA256 signature of the raw JSON payload using `WEBHOOK_SIGNING_SECRET`.
