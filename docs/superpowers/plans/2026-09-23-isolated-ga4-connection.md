# Isolated GA4 Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CrawlSEO read each site's GA4 reports through an encrypted, owner-managed service-account credential without requesting GA4 access through the shared STRUM OAuth client.

**Architecture:** A user-owned encrypted credential supplies short-lived GA4 access tokens to the existing `fetchGa4Report` seam. Site-owned property IDs, atomic manual/scheduled sync, and historical measurements stay in place. Settings accepts a JSON key once, while AI Visibility keeps only property mapping and sync controls.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Node `crypto`, existing AES-GCM encryption helper, Node test runner through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-23-isolated-ga4-connection-design.md`

## Global Constraints

- Do not change the STRUM web app or the shared `strum-web-app` Cloud project's OAuth consent scopes.
- Do not add a GA4 OAuth scope to CrawlSEO's Google login; its Search Console flow remains intact.
- The service-account key is server-only, encrypted at rest, never returned by GET or in an error, and never logged.
- One credential belongs to one CrawlSEO user; one numeric GA4 property ID belongs to one site. Preserve existing multi-site rows and reports.
- Use only `https://oauth2.googleapis.com/token` as token endpoint, with `https://www.googleapis.com/auth/analytics.readonly` in the signed service-account assertion.
- Failed credential replacement, property test, or report fetch must preserve the previous working credential, property mapping, and daily reports respectively.
- No paid API calls, Google Cloud mutations, production deploy, or secret uploads occur as part of the code implementation.

## File structure

- `lib/google/ga4-service-account.ts`: parse and sign a Google service-account assertion; exchange it for a short-lived token without trusting JSON URLs.
- `prisma/schema.prisma` and one new migration: user-owned `Ga4Credential`, independent of DataForSEO's `ApiKey`.
- `app/api/user/ga4-credential/route.ts`: authenticated connection status, tested replacement, and removal.
- `lib/google/ga4-client.ts`: obtain a service-account token while preserving existing report request and parser behavior.
- `components/settings/ga4-credentials-section.tsx`: one-time JSON file upload and secret-free status/removal.
- `app/(dashboard)/sites/[siteId]/settings/page.tsx`: show the credential form for the authenticated owner.
- `components/operator/ai-visibility-controls.tsx` and `app/(dashboard)/sites/[siteId]/ai-visibility/page.tsx`: remove GA4 OAuth grant button and show credential/settings guidance.
- `.env.example` and `docs/solo-seo-operator-operations.md`: correct setup and deployment instructions.

## Review Focus

1. A malformed or >16 KiB JSON key must fail before any DB write or network request (Task 1 tests).
2. An invalid replacement must leave the old encrypted credential usable (Task 2 route test).
3. A foreign site must not test its GA4 property or expose connection status (existing route test plus Task 3 test).
4. A key removal during a scheduled sync must leave historical daily rows intact and mark freshness unavailable (Task 2 and Task 3 tests).
5. A Google 403 caused by wrong property rights/API state must not echo provider response or claim a definitive cause (Task 3 test).

---

### Task 1: Validate and authenticate a service account

**Files:**
- Create: `lib/google/ga4-service-account.ts`
- Create: `tests/ga4-service-account.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260923_ga4_service_account/migration.sql`

**Interfaces:**
- Produces `parseGa4ServiceAccount(raw: string): Ga4ServiceAccount` with `projectId`, `clientEmail`, and `privateKey`.
- Produces `getGa4ServiceAccountToken(account: Ga4ServiceAccount, now?: Date): Promise<string>`; token error text never includes Google response bodies.
- Produces `db.ga4Credential` with `userId`, `encryptedJson`, `clientEmail`, `projectId`, timestamps.

- [ ] **Step 1: Write failing parser tests.** A test using `generateKeyPairSync("rsa", { modulusLength: 2048 })` builds JSON with `type: "service_account"`, `project_id: "crawlseo-internal"`, `client_email: "reader@crawlseo-internal.iam.gserviceaccount.com"`, `private_key`, and Google's token URI. Assert parsed metadata; assert oversized input, mismatched email/project, non-RSA key, and non-Google `token_uri` throw without a `fetch` call.

```ts
assert.deepEqual(
  { projectId: parseGa4ServiceAccount(raw).projectId, clientEmail: parseGa4ServiceAccount(raw).clientEmail },
  { projectId: "crawlseo-internal", clientEmail: "reader@crawlseo-internal.iam.gserviceaccount.com" },
);
assert.throws(() => parseGa4ServiceAccount(raw + " ".repeat(16_385)), /size/i);
assert.throws(() => parseGa4ServiceAccount(raw.replace("https://oauth2.googleapis.com/token", "https://example.com/token")), /token uri/i);
```

- [ ] **Step 2: Run** `npx tsx --test tests/ga4-service-account.test.ts`; confirm missing module/export is the expected red failure.
- [ ] **Step 3: Implement the minimal parser.** Limit input to 16 KiB; parse a plain object; require exact `type`, fixed token URI, project/email match, and `createPrivateKey(privateKey).asymmetricKeyType === "rsa"`. Return only the typed fields needed for signing; avoid logging `raw`.

```ts
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export type Ga4ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };
export function parseGa4ServiceAccount(raw: string): Ga4ServiceAccount {
  if (Buffer.byteLength(raw, "utf8") > 16_384) throw new Error("GA4 key exceeds size limit");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid GA4 key");
  const data = value as Record<string, unknown>;
  if (data.type !== "service_account" || data.token_uri !== TOKEN_URL ||
      typeof data.project_id !== "string" || typeof data.client_email !== "string" ||
      typeof data.private_key !== "string" ||
      !data.client_email.endsWith(`@${data.project_id}.iam.gserviceaccount.com`) ||
      createPrivateKey(data.private_key).asymmetricKeyType !== "rsa") throw new Error("Invalid GA4 service-account key");
  return { projectId: data.project_id, clientEmail: data.client_email, privateKey: data.private_key };
}
```

- [ ] **Step 4: Add a red token-exchange test.** Intercept `globalThis.fetch`; decode the submitted JWT body, verify `iss`, `scope`, `aud`, and expiration, and verify its RS256 signature with the generated public key. Return a fake token and assert it is returned; return an HTTP error containing a fake secret and assert the error does not contain that secret.
- [ ] **Step 5: Implement token exchange.** Sign a one-hour JWT with Node `crypto`; POST only to `TOKEN_URL` with a 15-second timeout and form-encoded JWT-bearer grant; validate a non-empty `access_token`; return generic status-only failures.

```ts
const claims = { iss: account.clientEmail, scope: SCOPE, aud: TOKEN_URL,
  iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 3600 };
const input = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url(claims)}`;
const assertion = `${input}.${sign("RSA-SHA256", Buffer.from(input), account.privateKey).toString("base64url")}`;
const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
```

- [ ] **Step 6: Run** `npx tsx --test tests/ga4-service-account.test.ts` and confirm green.
- [ ] **Step 7: Add Prisma model and additive SQL migration.** Add `ga4Credential Ga4Credential?` to `User`; create a `Ga4Credential` model keyed by `userId`, with `encryptedJson String @db.Text`, `clientEmail`, `projectId`, `createdAt`, `updatedAt`, and `user User @relation(..., onDelete: Cascade)`. The migration creates the table and FK only; it changes no existing `Site` or GA4 daily rows. Run `npx prisma validate` and `npx prisma generate`.
- [ ] **Step 8: Commit** `git add lib/google/ga4-service-account.ts tests/ga4-service-account.test.ts prisma/schema.prisma prisma/migrations/20260923_ga4_service_account/migration.sql && git commit -m "feat: authenticate GA4 with isolated service account"`.

### Task 2: Store the credential securely in Settings API

**Files:**
- Create: `app/api/user/ga4-credential/route.ts`
- Create: `tests/ga4-credential-route.test.ts`

**Interfaces:**
- Consumes `parseGa4ServiceAccount`, `getGa4ServiceAccountToken`, `encrypt`, `db.ga4Credential`.
- Produces `GET`, `POST`, `DELETE` under `/api/user/ga4-credential`; JSON responses include only `connected`, `clientEmail`, and `projectId` on success.

- [ ] **Step 1: Write red route tests.** Follow `tests/operator-ga4-routes.test.ts`'s `createRequire`/`require.cache` auth stub and `intercept` helper. Assert unauthorized requests make no DB calls; GET selects metadata only; POST with a generated valid key tests token exchange before `upsert`; POST with a failed token exchange never calls `upsert`; DELETE deletes the user's key and clears `lastGa4SyncAt` for that user's sites without deleting daily rows.

```ts
const response = await route.POST(new Request("https://seo.example/api/user/ga4-credential", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialJson: validJson }),
}));
assert.equal(response.status, 201);
assert.deepEqual(await response.json(), { connected: true, clientEmail, projectId });
assert.equal(saved.encryptedJson.includes(privateKey), false);
```

- [ ] **Step 2: Run** `npx tsx --test tests/ga4-credential-route.test.ts`; confirm the missing route fails as expected.
- [ ] **Step 3: Implement authenticated GET and POST.** Reject non-string or oversized `credentialJson` with 400. Parse, test short-lived token, encrypt, then `upsert` by `userId`. Send only metadata; catch credential/token failures without echoing request content. Use `Cache-Control: no-store` on GET and POST.
- [ ] **Step 4: Implement authenticated DELETE.** In a transaction, `deleteMany({ where: { userId } })` then `site.updateMany({ where: { userId }, data: { lastGa4SyncAt: null } })`; leave GA4 daily tables intact. Respond `{ connected: false }` and `Cache-Control: no-store`.
- [ ] **Step 5: Run** `npx tsx --test tests/ga4-credential-route.test.ts` and `npx tsc --noEmit`; fix only relevant failures.
- [ ] **Step 6: Commit** `git add app/api/user/ga4-credential/route.ts tests/ga4-credential-route.test.ts && git commit -m "feat: store GA4 service-account credential securely"`.

### Task 3: Switch all GA4 reports to the stored credential

**Files:**
- Modify: `lib/google/ga4-client.ts`
- Modify: `tests/operator-ga4-routes.test.ts`
- Create: `tests/ga4-client-auth.test.ts`
- Modify: `app/api/sites/[siteId]/ga4/connect/route.ts` only if clearer error mapping needs a narrow route change.

**Interfaces:**
- Consumes `db.ga4Credential.findUnique`, `decrypt`, `parseGa4ServiceAccount`, and `getGa4ServiceAccountToken`.
- Keeps `fetchGa4Report(userId, propertyId, startDate, endDate): Promise<Ga4Report>` stable for site connect, manual sync, and cron.

- [ ] **Step 1: Write red client tests.** Intercept `db.ga4Credential.findUnique` and `globalThis.fetch`. Assert a missing key fails before any GA4 report call; a valid encrypted key obtains a token and sends it to the fixed Analytics Data API URL; wrong numeric property IDs fail locally; a 403 response with a fake secret produces a safe, qualified error; an incomplete paginated report still fails before sync replaces data.

```ts
await assert.rejects(fetchGa4Report("owner", "123456789", "2026-09-01", "2026-09-02"), /Connect a GA4 service account/i);
assert.equal(calls.at(-1)?.url, "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport");
assert.equal(calls.at(-1)?.authorization, "Bearer test-access-token");
```

- [ ] **Step 2: Run** `npx tsx --test tests/ga4-client-auth.test.ts tests/operator-ga4-routes.test.ts`; confirm failure in the old OAuth credential path.
- [ ] **Step 3: Replace the OAuth lookup only.** Fetch `encryptedJson` by `userId`, decrypt, parse, obtain token, and reuse the existing GA4 report loop. Delete `requireGa4Scope`; do not change `lib/auth.ts`, GSC token storage, dimensions, metrics, page size, atomic sync, or site ownership rules.

```ts
const credential = await db.ga4Credential.findUnique({ where: { userId }, select: { encryptedJson: true } });
if (!credential) throw new Error("Connect a GA4 service account in Settings first");
const token = await getGa4ServiceAccountToken(parseGa4ServiceAccount(decrypt(credential.encryptedJson)));
```

- [ ] **Step 4: Refine status-only GA4 errors.** A 403 says “check GA4 Viewer access and that Analytics Data API is enabled in the service-account project”; a 404 says “check GA4 property ID and access”; neither claims the exact cause or includes Google's response body.
- [ ] **Step 5: Run** `npx tsx --test tests/ga4-client-auth.test.ts tests/operator-ga4-routes.test.ts tests/operator-ai-visibility.test.ts`; confirm green and no daily-data mutation on failed fetch.
- [ ] **Step 6: Commit** `git add lib/google/ga4-client.ts tests/ga4-client-auth.test.ts tests/operator-ga4-routes.test.ts app/api/sites/'[siteId]'/ga4/connect/route.ts && git commit -m "feat: sync GA4 through service-account identity"`; omit the optional route file from `git add` if unchanged.

### Task 4: Replace OAuth button with owner-facing setup

**Files:**
- Create: `components/settings/ga4-credentials-section.tsx`
- Modify: `app/(dashboard)/sites/[siteId]/settings/page.tsx`
- Modify: `components/operator/ai-visibility-controls.tsx`
- Modify: `app/(dashboard)/sites/[siteId]/ai-visibility/page.tsx`
- Modify: `.env.example`
- Modify: `docs/solo-seo-operator-operations.md`
- Create: `tests/ga4-settings-ui.test.tsx`

**Interfaces:**
- Consumes `/api/user/ga4-credential` GET/POST/DELETE and `Ga4Controls`'s `credentialConnected` Boolean.
- Produces no new secret-bearing GET or client-side stored token.

- [ ] **Step 1: Write a red server-render test for Settings.** Use `renderToStaticMarkup(<Ga4CredentialsSection initialStatus={{ connected: false, clientEmail: null, projectId: null }} />)`. Assert the markup contains a JSON-file input, explicit Viewer/access instructions, and no `Authorize GA4 read-only` action. Render a connected state and assert metadata is shown without any private-key text.
- [ ] **Step 2: Run** `npx tsx --test tests/ga4-settings-ui.test.tsx`; confirm missing component is the expected failure.
- [ ] **Step 3: Implement credential form.** Use `<input type="file" accept="application/json,.json">`, read `file.text()` only on submit, POST `{ credentialJson }`, clear the file input on success/failure, and show status using only metadata. Provide explicit Remove with confirmation; `DELETE` removes the stored key. Do not put credentials in localStorage, URL, hidden inputs, or server-rendered props.
- [ ] **Step 4: Put the form in site Settings.** Load `db.ga4Credential.findUnique({ where: { userId }, select: { clientEmail: true, projectId: true } })` after ownership check; pass status only. The same user credential may appear on several site Settings pages, but each site keeps its own GA4 property mapping.
- [ ] **Step 5: Remove the GA4 OAuth button.** Delete `signIn` import and the `signIn("google", ... analytics.readonly ...)` call from `Ga4Controls`. Pass `credentialConnected` from the AI Visibility page and show a link to `/sites/${siteId}/settings` when disconnected. Keep property ID, connect, and sync buttons; disable them until a credential exists.
- [ ] **Step 6: Update operator docs and `.env.example`.** Explain the dedicated project, Data API enablement, service-account JSON key, GA4 property-level Viewer grant, upload, property connection, manual verification, and scheduler. Remove the claim that existing OAuth credentials alone enable GA4. Warn that keeping `NEXTAUTH_SECRET` stable is required to decrypt stored keys.
- [ ] **Step 7: Run** `npx tsx --test tests/ga4-settings-ui.test.tsx`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. Check `rg -n 'analytics.readonly|Authorize GA4 read-only' lib/auth.ts components/operator app` shows no browser OAuth grant (the server-to-server scope constant is expected). Inspect `git diff --check` and `git status --short`; do not stage the user's untracked agency documents.
- [ ] **Step 8: Commit** `git add components/settings/ga4-credentials-section.tsx app/'(dashboard)'/sites/'[siteId]'/settings/page.tsx components/operator/ai-visibility-controls.tsx app/'(dashboard)'/sites/'[siteId]'/ai-visibility/page.tsx .env.example docs/solo-seo-operator-operations.md tests/ga4-settings-ui.test.tsx && git commit -m "feat: connect GA4 from site settings without OAuth consent"`.

## Rollout after code review

Apply the migration during normal deploy. In a new Cloud project, enable Google Analytics Data API and create a service account. Add its email as Viewer on the STRUM GA4 property, upload its JSON key in CrawlSEO Settings, enter the numeric property ID, and run a manual sync. Compare one finalized day against GA4's Organic Search sessions before trusting trend summaries. Observe the next authenticated cron run. Do not change the shared STRUM OAuth project or send the private key through chat/Git.
