# AI Agent Live Chat Roadmap

This roadmap tracks the path from the current MVP to a production-ready AI Agent Live Chat platform. The order is intentionally backend-first: production data, AI/RAG reliability, support operations, integrations, then platform expansion.

Status legend:

- `Done`: implemented and verified for the current MVP scope.
- `In progress`: partially implemented or ready for the next hardening pass.
- `Planned`: not started or only represented by placeholders/schema.

## Current Baseline

Status: `In progress`

The current system already includes:

- [x] Visitor chat widget, anonymous cookie sessions, and SSE live updates.
- [x] Agent console with manual takeover, release, human replies, resolve, and close actions.
- [x] AI provider abstraction with `mock` and `openai`.
- [x] Admin AI settings, basic knowledge base management, AI test panel, webhook/tool foundations, audit logs, and metrics.
- [x] File-store local development plus Prisma/Postgres production repository support.
- [x] Docker Compose, Postgres with pgvector image, migration tool image, and VPS deployment through GitHub Actions.
- [x] Add reusable deployment smoke test for health, Prisma migration status, production secrets, widget script/config, and visitor chat flow.
- [x] Add pre-chat profile collection, bidirectional AI translation controls, provider/model registry, and account-level admin language preference.
- [ ] Full production verification on VPS with real Postgres migration, seed, health check, and smoke tests.

## Phase 1: Production Foundation

Status: `In progress`

Goal: make the service safe to run as a single-workspace production app.

Planned work:

- [x] Add Prisma/Postgres repository behind the existing store interface.
- [x] Add Docker Compose Postgres service and pgvector-ready image.
- [x] Add migration tool image so deployment can run `prisma migrate deploy` without shipping Prisma CLI in the app runtime image.
- [x] Add admin seed path.
- [x] Add `APP_PORT` deployment secret support.
- [x] Add admin, agent, and viewer roles.
- [x] Add disabled-user sign-in protection.
- [x] Add basic admin user management.
- [x] Add basic audit logs.
- [x] Expand health checks to cover database connectivity, migration status, AI provider config, and webhook signing secret presence.
- [x] Add login, failed-login, and logout audit log events.
- [x] Add audited unauthorized and forbidden responses for admin APIs.
- [x] Reject disabled users when decoding existing agent sessions.
- [x] Keep `STORE_DRIVER=prisma` as the production data layer and reduce file-store usage to local development only.
- [x] Add migration verification in CI.
- [x] Add post-deploy smoke test command to the VPS GitHub Actions workflow.
- [x] Add deployment preflight validation for required production secrets.
- [x] Add account lockout after repeated failed sign-in attempts.
- [x] Add admin password reset controls and password-change metadata.
- [x] Add first-run/default-admin force-password-change marker.
- [x] Add self-service password change API and enforced password-change screen.
- [x] Harden full first-run setup wizard.
- [x] Add account lock policy configuration.
- [x] Add password rotation enforcement.
- [x] Add invite flow.
- [x] Improve audit logs for remaining config changes, conversation lifecycle gaps, and tool invocation details.
- [x] Add backup/restore guidance for Postgres and `.env.production` secrets.

Acceptance criteria:

- Fresh VPS deployment can bootstrap Postgres, run migrations, seed admin, and pass `/api/health`.
- A disabled user cannot sign in or access APIs.
- Admin-only APIs reject `agent` and `viewer`.
- Audit logs show security-sensitive and operator actions.

## Phase 2: AI Configuration And Agent Runtime

Status: `Done`

Goal: route every AI response through one observable runtime.

Planned work:

- [x] Add configurable provider, model, temperature, max context messages, system prompt, fallback message, knowledge toggle, tool toggle, and auto-handoff rules.
- [x] Route chat replies through Agent Runtime.
- [x] Add basic knowledge retrieval before AI generation.
- [x] Add basic automatic handoff rules for human-request phrases, sensitive keywords, and VIP/customer metadata.
- [x] Add AI test panel.
- [x] Make Agent Runtime fully responsible for prompt assembly, history trimming, knowledge retrieval, tool availability, provider calls, fallback behavior, and trace logging.
- [x] Add repeated AI failure and low-confidence knowledge hit handoff rules.
- [x] Improve AI test panel with retrieved knowledge chunks, prompt structure summary, provider/model, latency, fallback reason, and handoff decision.
- [x] Upgrade OpenAI provider path with structured tool-call interface placeholders.
- [x] Store AI traces for debugging: config snapshot, selected context messages, knowledge sources, tool calls, provider latency, and error details.
- [x] Add provider/model registry for mock and OpenAI chat/translation models.
- [x] Add global and per-conversation AI translation controls.

Acceptance criteria:

- Changing model/prompt/temperature affects new AI replies.
- Missing `OPENAI_API_KEY` produces a clear admin-visible error or configured fallback.
- Auto-handoff prevents AI replies when a rule is matched.
- AI test panel explains what context and configuration were used.

## Phase 3: Knowledge Base And RAG

Status: `Done`

Goal: make knowledge-grounded AI answers reliable and inspectable.

Planned work:

- [x] Add basic knowledge base, document, and chunk models.
- [x] Add manual document creation, chunking, reindex, and search test.
- [x] Add keyword search fallback.
- [x] Productionize knowledge models: `KnowledgeBase`, `KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeEmbedding`, and `KnowledgeSource`.
- [x] Support document sources for manual FAQ, Markdown/text paste, and URL crawl.
- [x] Add signed external sync document source API.
- [x] Add PDF/Docx upload document sources.
- [x] Add text/Markdown cleaning, chunking, local embedding generation, indexing, reindexing, and failure tracking.
- [x] Use Postgres + pgvector as the default vector store for Prisma-backed knowledge retrieval.
- [x] Add baseline hybrid retrieval with pgvector top-k candidates, keyword matching, and weighted reranking.
- [x] Add advanced hybrid retrieval: query rewrite, source filtering, and stronger reranking controls.
- [x] Include source metadata in AI replies for internal inspection and future visitor-facing citations.
- [x] Add no-answer strategies: continue with caveat, return fallback, queue for human, or immediately transfer.
- [x] Improve knowledge admin UI with indexing status, failed document reason, search test, hit preview, and reindex controls.

Acceptance criteria:

- Admin can add a document, index it, search it, and see matching chunks.
- Visitor questions can retrieve relevant chunks and inject them into AI context.
- AI reply metadata records knowledge source IDs.
- Low/no match behavior follows AI configuration.

## Phase 4: Support Operations Workspace

Status: `Done`

Goal: make the agent console useful for real customer support work.

Planned work:

- [x] Add statuses for `ai_active`, `queued_for_human`, `human_active`, `resolved`, and `closed`.
- [x] Add manual takeover, release, resolve, and close actions.
- [x] Add basic conversation search and status filter.
- [x] Add queue management, manual assignment, transfer to another agent, online/away/offline agent status, and assigned-agent filters.
- [x] Add unread counts, tags, internal notes, quick replies, and customer profile sidebar.
- [x] Add SLA fields for first response time, wait time, timeout alerting, and queue sorting.
- [x] Add visitor-side configurable widget theme, welcome message, offline message, satisfaction rating, end-chat confirmation, and transcript download.
- [x] Add agent activity indicators and better SSE recovery behavior.
- [x] Add pre-chat visitor profile form and account-level admin language preference.

Acceptance criteria:

- Agents can filter and search active/closed conversations.
- Queued conversations can be assigned, transferred, resolved, and closed without losing messages.
- Internal notes are visible only to agents.
- Visitor widget can be themed and embedded through `/widget.js`.

## Phase 5: Integrations And Plugin System

Status: `Done`

Goal: connect the chat system to external business systems without changing core chat flow code.

Planned work:

- [x] Add static tool registry and tool invocation logs.
- [x] Add signed inbound webhook API.
- [x] Add outbound webhook delivery logging foundation.
- [x] Add integration APIs for conversation creation, message append, and metadata update.
- [x] Expand Tool Registry into configurable tools with name, description, input schema, auth config, timeout, enabled state, and permission scope.
- [x] Add built-in tool templates for CRM lookup, order lookup, ticket creation, refund status, subscription status, and user profile sync.
- [x] Build webhook management UI for endpoint creation, event selection, signing secret, retry strategy, delivery logs, and manual replay.
- [x] Expand inbound APIs for external user identity binding, profile updates, conversation creation, system notes, and metadata updates.
- [x] Add event contracts for conversation lifecycle, message creation, handoff, resolution, close, AI fallback, knowledge hit, and tool invocation.
- [x] Add channel adapter registry and REST API adapter.
- [x] Add Slack Events API inbound adapter with optional AI reply delivery.
- [x] Add Discord Interactions inbound adapter with immediate AI responses.
- [x] Add WhatsApp Cloud API webhook adapter with optional AI reply delivery.
- [x] Add WeChat Official Account plaintext webhook adapter with synchronous text replies.

Acceptance criteria:

- Admin can create a webhook endpoint and inspect delivery attempts.
- Failed webhook deliveries can be retried or replayed.
- External systems can create/update conversations and append system messages with signed requests.
- Tool calls are permission-checked and logged.

## Phase 6: Analytics And Continuous Improvement

Status: `Done`

Goal: help operators measure support quality and improve AI performance.

Planned work:

- [x] Add basic metrics endpoint and admin display.
- [x] Add dashboards for total conversations, AI replies, human takeover rate, AI resolution rate, first response time, resolution time, knowledge hit rate, and satisfaction score.
- [x] Add filters by date range, agent, channel, tag, status, and knowledge base.
- [x] Add low-rating review queue and unresolved-conversation review.
- [x] Add AI missed-question clustering and suggestions for new knowledge base entries.
- [x] Add knowledge gap analysis: frequent questions with no reliable hit, stale documents, low-performing chunks, and fallback trends.
- [x] Add export APIs for analytics data and conversation transcripts.

Acceptance criteria:

- Admin can review daily/weekly support metrics.
- Low-score and unresolved conversations are easy to inspect.
- The system can suggest candidate FAQ/knowledge entries from repeated unanswered questions.
- Metrics distinguish AI-handled, human-handled, and mixed conversations.

## Later Platform Work

Status: `Deferred`

These items are intentionally deferred until the single-workspace product is stable:

- [ ] Multi-tenant workspaces and organization management.
- [ ] Billing, quotas, usage metering, and plan limits.
- [ ] Complex enterprise SSO and SCIM provisioning.
- [ ] Advanced routing rules by team, language, region, product, or SLA.
- [ ] Full omnichannel inbox with channel-specific delivery guarantees.
- [ ] Dedicated vector database adapters such as Qdrant, Pinecone, or Weaviate.
- [ ] Advanced analytics warehouse integration.
