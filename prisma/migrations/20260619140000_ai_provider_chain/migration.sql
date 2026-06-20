ALTER TABLE "AIConfiguration"
  ADD COLUMN IF NOT EXISTS "providerChain" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "providerFallbackStrategy" TEXT NOT NULL DEFAULT 'priority';

