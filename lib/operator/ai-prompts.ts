import { createHash } from "node:crypto";

export type AiPromptInput = { question: string; country: string; language: string; platform?: string; intent?: string | null };

export function normalizeAiPrompt(input: AiPromptInput) {
  if (!input || typeof input.question !== "string" || typeof input.country !== "string" || typeof input.language !== "string") throw new Error("Question and market required");
  const question = input.question.trim().replace(/\s+/g, " ");
  const country = input.country.trim().toUpperCase();
  const language = input.language.trim().toLowerCase();
  const platform = input.platform || "CHATGPT_WEB";
  if (question.length < 8 || question.length > 200) throw new Error("Question must be 8–200 characters");
  if (!/^[A-Z]{2}$/.test(country) || !/^[a-z]{2}$/.test(language)) throw new Error("Use two-letter country and language codes");
  if (platform !== "CHATGPT_WEB") throw new Error("Only ChatGPT web search is supported for this panel");
  const intent = input.intent?.trim() || null;
  if (intent && intent.length > 80) throw new Error("Intent is too long");
  return { question, country, language, platform, intent };
}

export function promptFingerprint(input: Pick<ReturnType<typeof normalizeAiPrompt>, "question" | "country" | "language" | "platform">) {
  return createHash("sha256").update(JSON.stringify([input.question.toLocaleLowerCase(), input.country, input.language, input.platform])).digest("hex");
}
