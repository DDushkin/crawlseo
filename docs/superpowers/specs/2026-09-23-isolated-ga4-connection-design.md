# Isolated GA4 Connection Design

## Purpose and success

CrawlSEO needs read-only GA4 organic-search and identifiable AI-referral reports for each site without changing the production STRUM web app's Google OAuth consent screen. The owner can connect GA4 from CrawlSEO Settings, assign a different numeric GA4 property ID to each site, run a manual sync, and keep the existing authenticated scheduled sync working. Successful reports retain the existing distinction between GA4 sessions, GSC clicks, and sampled AI citations.

The owner has approved the simpler service-account path rather than another interactive OAuth flow. This choice avoids asking STRUM customers—or the CrawlSEO owner—for a new Google OAuth grant. It does require the owner to grant the service-account email Viewer access to the relevant GA4 property in Google Analytics.

## Current state

- The default CrawlSEO Google login requests Search Console read-only access. Its GA4 panel separately requests `analytics.readonly` through the same OAuth client, which belongs to the shared `strum-web-app` Cloud project.
- `Site.ga4PropertyId` and GA4 daily report tables already keep property selection and measurements per site. Manual connect, manual sync, and the cron route all call `fetchGa4Report`, which currently reads the user's OAuth token.
- DataForSEO has an existing server-side AES-GCM encryption helper and Settings form. Its API credential is user-owned, while provider settings are site-owned.
- The STRUM backoffice's Ads connection uses a stored OAuth refresh token to call the Google Ads API. Its campaign metrics are not GA4 Data API reports; reusing that OAuth approach for GA4 would still introduce a sensitive-scope consent workflow.

## Decision and boundaries

Use one dedicated Google service-account credential per CrawlSEO user and one GA4 property ID per site. The service account should live in a separate Google Cloud project for CrawlSEO, with the Google Analytics Data API enabled. It receives only Viewer access on each GA4 property the owner chooses. Keep GSC login and its existing Cloud project untouched. Do not put a private key in Git, a URL, a log, or a client response.

This is an internal, owner-managed integration, not arbitrary Google Analytics access for public SaaS tenants. The UI asks the owner to select a JSON key file; the browser sends its contents once to an authenticated server endpoint and clears the file input after saving. The server validates the credential shape and reads its project identity, obtains a short-lived Analytics token, encrypts the original credential with the existing helper, and stores only non-secret connection status for display. The server must accept only Google's fixed token endpoint rather than a URL supplied by the JSON file. Key generation and GA4 Viewer assignment remain Google-side setup actions.

## Data and API contract

- Add a user-owned `Ga4Credential` row with encrypted service-account JSON and non-secret account email/project ID metadata. Use an additive Prisma migration with a user foreign key and cascade deletion, preserving existing sites and GA4 measurements. Do not repurpose the DataForSEO login/password columns.
- `GET /api/user/ga4-credential` returns connection status, service-account email, and project ID, never key material.
- `POST /api/user/ga4-credential` validates and tests a new credential before replacing the stored one. Invalid JSON, non-service-account JSON, malformed private keys, unsupported token URI, token errors, and missing identity fail without replacing a working credential. The route is authenticated and its errors must not echo private key material or Google response bodies.
- `DELETE /api/user/ga4-credential` removes the credential and invalidates GA4 sync freshness for that user's sites without deleting historical measurements. Manual and scheduled syncs then report the missing credential and do not mutate daily data.
- Existing `POST /api/sites/[siteId]/ga4/connect` continues to validate ownership, numeric property ID, and a one-day GA4 report before saving the site mapping. A user credential can access multiple site properties; the site mapping is never inferred from a hostname.
- Existing manual and scheduled GA4 sync entry points continue to call one shared `fetchGa4Report`. Only its credential acquisition changes to service-account authentication. The existing atomic report replacement and date-window semantics remain intact.

## UI and operator workflow

Site Settings shows GA4 connection status and explains: create a dedicated Cloud project, enable Analytics Data API, create a service account, add its email as Viewer in GA4 Property Access Management, then upload its JSON key. The key input is never pre-filled or returned. A successful save shows only the service-account email and project ID. An explicit Remove action revokes the app's stored copy; the owner must revoke the key or property access in Google separately if desired.

The AI Visibility page removes the `Authorize GA4 read-only` OAuth button. It links to Settings when no service-account credential exists, keeps the per-site property ID and manual sync controls, and explains missing credentials versus missing GA4 property access. Existing GA4 historical charts and weekly reports remain available but show unavailable when the sync window is stale. A failed connection or sync does not replace previous complete data.

## Security and failure behavior

- Require an authenticated owner before reading or mutating any credential or site mapping. Enforce the existing user/site ownership checks on every path.
- Encrypt the service-account JSON at rest with the existing server-side encryption helper. Keep the encryption secret stable across deployments; loss or rotation without migration makes stored keys unreadable.
- Authenticate with the service account only on the server. Obtain short-lived access tokens for `analytics.readonly` and reuse a token within a report request; do not store access tokens in the database.
- Do not trust the JSON's `token_uri` or fetch arbitrary URLs. Reject excessively large files and incomplete or unexpected key shape. Do not log credentials, tokens, Authorization headers, or raw Google error responses.
- GA4 `403` and `404` feedback should distinguish likely missing GA4 Viewer access, wrong property ID, and a disabled Analytics Data API where possible, without claiming certainty from an HTTP status alone.
- Cron isolates failures by site. A missing or invalid credential for one user does not stop other users' site syncs.

## Verification and rollout

Test credential validation and secret non-disclosure, ownership, save/replace/remove behavior, token acquisition, per-site property connection, manual sync, scheduler isolation, and no data deletion on a failed report. Run the full test suite, lint, typecheck/build, and Prisma migration checks before deployment. Use a dedicated Cloud project and a least-privilege GA4 Viewer grant. Deploy code and migration, save the credential in Settings, connect the STRUM GA4 property, run one manual sync, compare a known date range to GA4, then enable or observe scheduled sync. The Google-side key and grant are not created automatically by code deployment.

## Out of scope

Do not alter STRUM web app auth or the shared Cloud project's OAuth consent settings. Do not migrate GSC to service-account authentication, add GA4 write scopes, expose service-account keys through an API read, infer property ownership from a domain, or blend GA4 sessions with GSC clicks or AI-citation samples.
