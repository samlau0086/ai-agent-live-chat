CREATE TABLE "WidgetConfiguration" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "themeColor" TEXT NOT NULL DEFAULT '#1f2a44',
    "welcomeMessage" TEXT NOT NULL DEFAULT 'Start a conversation. The AI agent will answer first, and a human can take over when needed.',
    "offlineMessage" TEXT NOT NULL DEFAULT 'No human agents are online right now. Leave a message and the AI agent will keep helping.',
    "enableSatisfaction" BOOLEAN NOT NULL DEFAULT true,
    "enableTranscriptDownload" BOOLEAN NOT NULL DEFAULT true,
    "requireEndConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetConfiguration_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WidgetConfiguration" (
    "id",
    "themeColor",
    "welcomeMessage",
    "offlineMessage",
    "enableSatisfaction",
    "enableTranscriptDownload",
    "requireEndConfirmation",
    "createdAt",
    "updatedAt"
) VALUES (
    'global',
    '#1f2a44',
    'Start a conversation. The AI agent will answer first, and a human can take over when needed.',
    'No human agents are online right now. Leave a message and the AI agent will keep helping.',
    true,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
