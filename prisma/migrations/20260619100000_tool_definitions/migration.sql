CREATE TABLE "ToolDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "authConfig" JSONB NOT NULL DEFAULT '{}',
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "permissionScope" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ToolDefinition_name_key" ON "ToolDefinition"("name");

INSERT INTO "ToolDefinition" (
    "id",
    "name",
    "description",
    "inputSchema",
    "authConfig",
    "timeoutMs",
    "enabled",
    "permissionScope",
    "createdAt",
    "updatedAt"
) VALUES
(
    'tool_lookup_customer_profile',
    'lookup_customer_profile',
    'Returns known metadata for the current visitor session.',
    '{"type":"object","properties":{"conversationId":{"type":"string","description":"Current conversation id"}},"additionalProperties":true}',
    '{}',
    5000,
    true,
    'ai',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'tool_create_support_note',
    'create_support_note',
    'Records a support note in the conversation timeline.',
    '{"type":"object","properties":{"note":{"type":"string","description":"Internal support note"}},"required":["note"],"additionalProperties":true}',
    '{}',
    5000,
    true,
    'agent',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("name") DO NOTHING;
