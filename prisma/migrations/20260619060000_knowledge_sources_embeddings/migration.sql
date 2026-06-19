CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "name" TEXT NOT NULL,
    "uri" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KnowledgeDocument"
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "indexingStatus" TEXT NOT NULL DEFAULT 'indexed',
  ADD COLUMN "indexedAt" TIMESTAMP(3),
  ADD COLUMN "lastIndexError" TEXT;

ALTER TABLE "KnowledgeChunk"
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "tokenCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "KnowledgeChunk" SET "tokenCount" = COALESCE(array_length("tokens", 1), 0);

CREATE TABLE "KnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "sourceId" TEXT,
    "documentId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'none',
    "model" TEXT NOT NULL DEFAULT 'none',
    "dimensions" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(64),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeSource_knowledgeBaseId_idx" ON "KnowledgeSource"("knowledgeBaseId");
CREATE INDEX "KnowledgeSource_type_idx" ON "KnowledgeSource"("type");
CREATE INDEX "KnowledgeDocument_sourceId_idx" ON "KnowledgeDocument"("sourceId");
CREATE INDEX "KnowledgeDocument_indexingStatus_idx" ON "KnowledgeDocument"("indexingStatus");
CREATE INDEX "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk"("sourceId");
CREATE UNIQUE INDEX "KnowledgeEmbedding_chunkId_provider_model_key" ON "KnowledgeEmbedding"("chunkId", "provider", "model");
CREATE INDEX "KnowledgeEmbedding_knowledgeBaseId_idx" ON "KnowledgeEmbedding"("knowledgeBaseId");
CREATE INDEX "KnowledgeEmbedding_sourceId_idx" ON "KnowledgeEmbedding"("sourceId");
CREATE INDEX "KnowledgeEmbedding_documentId_idx" ON "KnowledgeEmbedding"("documentId");
CREATE INDEX "KnowledgeEmbedding_status_idx" ON "KnowledgeEmbedding"("status");

ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
