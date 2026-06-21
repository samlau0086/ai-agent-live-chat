CREATE TABLE IF NOT EXISTS "EmailConfiguration" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "provider" TEXT NOT NULL DEFAULT 'smtp',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "fromEmail" TEXT NOT NULL DEFAULT '',
  "fromName" TEXT,
  "smtpHost" TEXT,
  "smtpPort" INTEGER NOT NULL DEFAULT 587,
  "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  "smtpUsername" TEXT,
  "smtpPasswordEnv" TEXT,
  "resendApiKeyEnv" TEXT,
  "replyToEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailConfiguration_pkey" PRIMARY KEY ("id")
);

