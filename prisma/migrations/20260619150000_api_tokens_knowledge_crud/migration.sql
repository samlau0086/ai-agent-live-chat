CREATE TABLE IF NOT EXISTS "ApiToken" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ApiToken_tokenPrefix_idx" ON "ApiToken"("tokenPrefix");
CREATE INDEX IF NOT EXISTS "ApiToken_disabled_idx" ON "ApiToken"("disabled");

