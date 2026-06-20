import fs from "node:fs/promises";
import path from "node:path";
import { randomId } from "./crypto";
import type { MessageAttachment } from "./types";

const uploadDir = path.join(process.cwd(), ".data", "uploads");
const maxAttachmentBytes = 50 * 1024 * 1024;

function attachmentKind(mimeType: string): MessageAttachment["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[^\w.\- ()]/g, "_").trim();
  return cleaned || "attachment";
}

function assertSupportedFile(file: File) {
  if (file.size > maxAttachmentBytes) {
    throw new Error("Attachment exceeds the 50MB limit");
  }
  const mimeType = file.type || "application/octet-stream";
  if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) return;
  const allowedDocuments = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/zip",
  ]);
  if (!allowedDocuments.has(mimeType)) {
    throw new Error(`Unsupported attachment type: ${mimeType}`);
  }
}

export async function saveMessageAttachments(files: File[]) {
  if (!files.length) return [] as MessageAttachment[];
  await fs.mkdir(uploadDir, { recursive: true });
  const attachments: MessageAttachment[] = [];
  for (const file of files) {
    assertSupportedFile(file);
    const id = randomId("att");
    const mimeType = file.type || "application/octet-stream";
    const attachment: MessageAttachment = {
      id,
      fileName: safeFileName(file.name),
      mimeType,
      size: file.size,
      kind: attachmentKind(mimeType),
      url: `/api/uploads/${id}`,
    };
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(uploadDir, `${id}.bin`), buffer);
    await fs.writeFile(path.join(uploadDir, `${id}.json`), JSON.stringify(attachment, null, 2));
    attachments.push(attachment);
  }
  return attachments;
}

export async function readMessageAttachment(id: string) {
  if (!/^att_[a-f0-9]+$/.test(id)) return undefined;
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(uploadDir, `${id}.json`), "utf8")) as MessageAttachment;
    const data = await fs.readFile(path.join(uploadDir, `${id}.bin`));
    return { metadata, data };
  } catch {
    return undefined;
  }
}

export function messageAttachments(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.attachments;
  if (!Array.isArray(value)) return [] as MessageAttachment[];
  return value.filter((item): item is MessageAttachment => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Partial<MessageAttachment>;
    return Boolean(record.id && record.fileName && record.mimeType && record.kind && record.url);
  });
}

