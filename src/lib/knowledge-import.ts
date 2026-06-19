import type { KnowledgeDocument } from "./types";

export const knowledgeSourceTypes = ["manual", "markdown", "text", "pdf", "docx", "url", "external"] as const;

export function normalizeKnowledgeSourceType(value: unknown): KnowledgeDocument["sourceType"] {
  return knowledgeSourceTypes.includes(value as KnowledgeDocument["sourceType"])
    ? (value as KnowledgeDocument["sourceType"])
    : "manual";
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|section|article|main|header|footer|li|h[1-6]|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function documentTitleFromHtml(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) : undefined;
}

export async function fetchUrlKnowledgeSource(sourceUri: string) {
  const url = new URL(sourceUri);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL source must use http or https.");
  }

  const response = await fetch(url, {
    headers: {
      Accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
      "User-Agent": "ai-agent-live-chat-knowledge-import/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`URL fetch failed with status ${response.status}.`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("URL source must return text/html or text/plain content.");
  }

  const raw = (await response.text()).slice(0, 1_000_000);
  const content = contentType.includes("text/html") ? htmlToText(raw) : raw.trim();
  if (!content) throw new Error("URL source returned no indexable text.");

  return {
    title: documentTitleFromHtml(raw),
    content,
  };
}

export async function extractUploadedKnowledgeSource(file: File, sourceType: KnowledgeDocument["sourceType"]) {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("Uploaded knowledge document must be 10MB or smaller.");
  }

  if (sourceType === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const parsed = await parser.getText();
      const content = parsed.text.trim();
      if (!content) throw new Error("PDF upload produced no indexable text.");
      return { content };
    } finally {
      await parser.destroy();
    }
  }

  if (sourceType === "docx") {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer: bytes });
    const content = parsed.value.trim();
    if (!content) throw new Error("Docx upload produced no indexable text.");
    return { content };
  }

  throw new Error(`${sourceType} uploads are not supported.`);
}
