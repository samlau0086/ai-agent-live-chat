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
    'tool_crm_lookup',
    'crm_lookup',
    'Template for looking up customer records in an external CRM.',
    '{"type":"object","properties":{"externalUserId":{"type":"string","description":"External customer id"},"email":{"type":"string","description":"Customer email address"}},"additionalProperties":true}',
    '{"type":"api_key","header":"Authorization","secretRef":"CRM_API_KEY"}',
    5000,
    false,
    'disabled',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'tool_order_lookup',
    'order_lookup',
    'Template for retrieving order details from an external commerce system.',
    '{"type":"object","properties":{"orderId":{"type":"string","description":"Order id or order number"},"externalUserId":{"type":"string","description":"External customer id"}},"required":["orderId"],"additionalProperties":true}',
    '{"type":"api_key","header":"Authorization","secretRef":"ORDER_API_KEY"}',
    5000,
    false,
    'disabled',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'tool_ticket_create',
    'ticket_create',
    'Template for creating a support ticket in an external helpdesk.',
    '{"type":"object","properties":{"subject":{"type":"string","description":"Ticket subject"},"description":{"type":"string","description":"Ticket details"},"priority":{"type":"string","description":"Ticket priority"}},"required":["subject","description"],"additionalProperties":true}',
    '{"type":"api_key","header":"Authorization","secretRef":"TICKET_API_KEY"}',
    8000,
    false,
    'disabled',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'tool_refund_status',
    'refund_status',
    'Template for checking refund or return status in an external order system.',
    '{"type":"object","properties":{"orderId":{"type":"string","description":"Order id"},"refundId":{"type":"string","description":"Refund id"}},"additionalProperties":true}',
    '{"type":"api_key","header":"Authorization","secretRef":"REFUND_API_KEY"}',
    5000,
    false,
    'disabled',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'tool_subscription_status',
    'subscription_status',
    'Template for retrieving customer subscription or plan status.',
    '{"type":"object","properties":{"externalUserId":{"type":"string","description":"External customer id"},"subscriptionId":{"type":"string","description":"Subscription id"}},"additionalProperties":true}',
    '{"type":"api_key","header":"Authorization","secretRef":"SUBSCRIPTION_API_KEY"}',
    5000,
    false,
    'disabled',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'tool_user_profile_sync',
    'user_profile_sync',
    'Template for syncing external user profile data into conversation metadata.',
    '{"type":"object","properties":{"externalUserId":{"type":"string","description":"External customer id"},"profile":{"type":"object","description":"Profile fields to sync"}},"required":["externalUserId","profile"],"additionalProperties":true}',
    '{"type":"api_key","header":"Authorization","secretRef":"PROFILE_SYNC_API_KEY"}',
    8000,
    false,
    'disabled',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("name") DO NOTHING;
