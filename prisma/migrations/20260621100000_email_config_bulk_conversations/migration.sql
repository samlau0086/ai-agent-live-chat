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

CREATE TABLE IF NOT EXISTS "NotificationConfiguration" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "barkEnabled" BOOLEAN NOT NULL DEFAULT false,
  "barkServerUrl" TEXT NOT NULL DEFAULT 'https://api.day.app',
  "barkDeviceKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "newMessage" JSONB NOT NULL DEFAULT '{}',
  "unreplied" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationConfiguration_pkey" PRIMARY KEY ("id")
);
