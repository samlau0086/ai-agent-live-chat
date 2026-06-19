CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_embedding_hnsw_idx"
  ON "KnowledgeEmbedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_provider_model_status_idx"
  ON "KnowledgeEmbedding"("provider", "model", "status");

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_knowledgeBaseId_documentId_idx"
  ON "KnowledgeChunk"("knowledgeBaseId", "documentId");
