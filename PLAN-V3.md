# PLAN-V3: Research Tools, MCP Page, DataForSEO BYOK

> Date: 2026-07-20

## Overview

Add research tools (Keyword Research, Domain Overview, Backlinks), an AI & MCP info page, DataForSEO Bring-Your-Own-Key support, and reorganize sidebar navigation into grouped sections.

---

## 1. Database Schema

### New Model: `ApiKey`

```prisma
model ApiKey {
  id              String   @id @default(cuid())
  userId          String
  provider        String   // "dataforseo"
  encryptedLogin  String
  encryptedPassword String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider])
}
```

Add `apiKeys ApiKey[]` relation to `User` model.

---

## 2. Library Code

### `lib/encryption.ts`
- AES-256-GCM encrypt/decrypt using `NEXTAUTH_SECRET` as key material
- `encrypt(plaintext)` → `iv:ciphertext:tag` base64 string
- `decrypt(encrypted)` → plaintext

### `lib/dataforseo/client.ts`
- Base client with Basic Auth (login:password base64)
- `getApiKey(userId)` — fetch and decrypt credentials from DB
- `keywordResearch(seed, language?, location?)` → keyword ideas with volume, difficulty, CPC, competition, trend
- `domainOverview(domain)` → organic keywords, traffic estimate, backlinks count
- `backlinksOverview(domain)` → backlink summary stats
- `backlinksProfile(domain, limit?, offset?)` → individual backlinks
- All methods return `null` if no API key configured
- Rate limiting and error handling

### `lib/google/autocomplete.ts`
- `fetchSuggestions(query, language?)` → string[]
- Uses `https://suggestqueries.google.com/complete/search` endpoint
- Free, no API key needed
- Server-side only (to avoid CORS)

---

## 3. API Routes

### `app/api/user/api-keys/route.ts`
- `GET` — Return configured providers and status (connected/not configured), never return decrypted credentials
- `POST` — Save/update API key (encrypt before storing)
- `DELETE` — Remove API key for a provider

### `app/api/user/api-keys/test/route.ts`
- `POST` — Test DataForSEO connection with provided credentials (without saving)

### `app/api/sites/[siteId]/keyword-research/route.ts`
- `GET ?q=seed` — If DataForSEO configured: fetch keyword ideas; else: Google Autocomplete suggestions

### `app/api/sites/[siteId]/domain-overview/route.ts`
- `GET ?domain=competitor` — Domain metrics (DataForSEO or GSC fallback)

### `app/api/sites/[siteId]/backlinks/route.ts`
- `GET` — Backlinks data (DataForSEO or empty with banner flag)

---

## 4. Pages

### `/sites/[siteId]/mcp` — AI & MCP Page
- Header: "AI & MCP — Connect your AI agent to CrawlSEO"
- MCP connection config JSON (copyable)
- Setup guide cards: Claude Code, Claude Desktop, Cursor
- Available tools list (10 tools grouped by category)
- Roadmap section

### `/sites/[siteId]/keyword-research` — Keyword Research
- Input: seed keyword
- Results table: keyword, volume, difficulty, CPC (if DataForSEO)
- Fallback: Google Autocomplete suggestions + banner
- Save keyword button per row

### `/sites/[siteId]/domain-overview` — Domain Overview
- Domain metrics (DataForSEO or GSC fallback)
- Competitor input for comparison
- Side-by-side view

### `/sites/[siteId]/backlinks` — Backlinks
- Backlinks table: referring domain, target URL, anchor text, dofollow/nofollow
- DataForSEO or partial GSC data + banner

---

## 5. Sidebar Reorganization

Groups: OVERVIEW → WORKSPACE → RESEARCH → CONNECT

---

## 6. Settings Page Update

Add "External API Keys" section with DataForSEO login/password fields, test connection button, status indicator.

---

## Implementation Order

1. Schema + migration
2. `lib/encryption.ts`
3. `lib/dataforseo/client.ts` + `lib/google/autocomplete.ts`
4. API routes (api-keys, keyword-research, domain-overview, backlinks)
5. Sidebar navigation update
6. Settings page update (External API Keys)
7. New pages (MCP, Keyword Research, Domain Overview, Backlinks)
8. Test and verify
