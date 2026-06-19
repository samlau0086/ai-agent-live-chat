CREATE TABLE "AITrace" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "action" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "configSnapshot" JSONB NOT NULL DEFAULT '{}',
    "selectedMessages" JSONB NOT NULL DEFAULT '[]',
    "knowledgeSources" JSONB NOT NULL DEFAULT '[]',
    "toolNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "handoffReason" TEXT,
    "fallbackReason" TEXT,
    "error" TEXT,
    "replyMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITrace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AITrace_conversationId_createdAt_idx" ON "AITrace"("conversationId", "createdAt");
CREATE INDEX "AITrace_createdAt_idx" ON "AITrace"("createdAt");
