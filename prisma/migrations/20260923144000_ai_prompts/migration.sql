CREATE TABLE "AiPrompt" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'CHATGPT_WEB',
  "intent" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiPrompt_siteId_fingerprint_key" ON "AiPrompt"("siteId", "fingerprint");
CREATE INDEX "AiPrompt_siteId_active_idx" ON "AiPrompt"("siteId", "active");
ALTER TABLE "AiPrompt" ADD CONSTRAINT "AiPrompt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
