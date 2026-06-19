ALTER TABLE "KnowledgeChunk"
  ALTER COLUMN "embedding" TYPE vector(64)
  USING "embedding"::vector(64);

ALTER TABLE "KnowledgeEmbedding"
  ALTER COLUMN "embedding" TYPE vector(64)
  USING "embedding"::vector(64);

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_embedding_hnsw_idx"
  ON "KnowledgeEmbedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_provider_model_status_idx"
  ON "KnowledgeEmbedding"("provider", "model", "status");

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_knowledgeBaseId_documentId_idx"
  ON "KnowledgeChunk"("knowledgeBaseId", "documentId");
