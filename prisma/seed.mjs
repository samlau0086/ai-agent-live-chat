import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `sha256:${salt}:${hash}`;
}

const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD ?? "admin123";

await prisma.user.upsert({
  where: { username },
  update: {},
  create: {
    username,
    passwordHash: hashPassword(password),
    role: "admin",
    disabled: false,
  },
});

await prisma.aIConfiguration.upsert({
  where: { id: "global" },
  update: {},
  create: {
    id: "global",
    provider: process.env.AI_PROVIDER ?? "mock",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    maxContextMessages: 12,
    systemPrompt:
      "You are a concise customer support AI. Use available knowledge when relevant. Escalate politely when a human should help. Do not invent account data.",
    fallbackMessage: "I am not certain enough to answer that. A human agent can help from the console.",
    enableKnowledgeBase: true,
    enableTools: true,
    knowledgeBaseIds: [],
    autoHandoff: {
      enabled: true,
      userRequestPatterns: ["human", "agent", "representative", "manual support", "customer service"],
      sensitiveKeywords: ["refund", "legal", "complaint", "lawsuit", "lawyer", "chargeback"],
      vipMetadataKeys: ["vip", "plan:enterprise", "priority"],
      aiFailureThreshold: 2,
    },
  },
});

await prisma.$disconnect();
