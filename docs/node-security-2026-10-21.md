# Node runtime maintenance — 2026-10-21

## Scope and result

The owner authorized updating CrawlSEO to patched Node, deploying it, cleaning unused Docker images/build cache, and leaving n8n unchanged. Runtime commit `5cedbb619fc42c9cf5df130faa298ec6fa693538` is deployed and verified. No application behavior, dependency versions, database schema, provider settings or schedules changed.

## Runtime and compatibility

- Docker base: official `node:24.22.1-alpine3.23`, preserving the previous Alpine OS line.
- Multi-platform base index: `sha256:4b00b6d1aa138805aace94cc2482808f2b4f01e5e9c9f8cdc0e217fd70600ef9`, verified directly in Docker Hub.
- Every stage inherits this base. A build guard requires exact Node `v24.22.1`.
- `.nvmrc` and `.node-version` pin 24.22.1. Root manifest/lockfile engines require `^24.22.1`; active setup instructions were updated.
- Dependency graph and all Prisma schema/migration files were compared with baseline `9e05874` and are unchanged.

## Validation and publication

- All 280 existing tests passed under Node 24.22.1.
- Lint reports 13 existing errors / 10 warnings in unchanged application components and MCP formatters. Those source fixes are outside this runtime update.
- A local Linux/arm64 image build passed compile, TypeScript and static generation. Rebuilding the final Alpine 3.23 variant hit the local Docker disk limit during npm extraction; CI subsequently validated the final variant on both architectures.
- GitHub run `39643820806` completed linux/amd64 and linux/arm64 compile, TypeScript, static generation, image assembly and publication.
- Published application index: `sha256:e94bd0f48a2293496cc1468aaf623bfbc0e6f706069cf35a3c01495290b602ab`. Both `main` and `sha-5cedbb6` were independently verified against GHCR.
- After image publication, optional GitHub cache export did not finish promptly. Only this maintenance workflow was cancelled, using normal cancellation followed by the documented force-cancel endpoint. Its dependent automatic deployment did not run. The verified image was deployed once manually through Coolify instead.
- Build evidence was retained locally at `/private/tmp/crawlseo-security-image-build.log`.

## Rollout and live verification

Manual Coolify deployment `l1pjkarkwqlh6exw16dzbtay` completed successfully at 17:41 UTC. The normal Compose deployment recreated the SEO app and database containers while retaining the database's persistent data volume.

- Live app: `app-fvzfjsywmwrmmyg93pgzzea6-20261021T174115`.
- Direct container check: Node `v24.22.1`, healthy, restart count 0.
- Live image OCI revision matches runtime commit `5cedbb6`.
- Before rollout, Prisma status reported all 17 migrations applied and the database up to date. New-container startup reported `No pending migrations to apply.` No database migration was applied for this task.
- SEO `/api/health` and login returned HTTP 200. Strum web, backoffice login and the API health endpoint also returned HTTP 200 after rollout.
- SEO database and remaining services were observed healthy/up after deployment. n8n retained its existing container/image and two-week uptime; no n8n update or restart was performed.

## Cleanup boundaries and outcome

All container image references and available images were inventoried first. Specific unused image candidates were guarded with `docker ps -a --filter ancestor=...` before `docker image rm`, without force. Current deployments, referenced parent images and a previous usable image per relevant application/preview were retained.

- Unused production BuildKit cache reclaimed: 1.03 GB.
- Removed obsolete backoffice, SEO local-build, helper, realtime and sentinel images. Missing or referenced/parent candidates were left alone.
- No volume, container or network prune commands were used. Persistent data and unrelated running workloads were preserved.
- Root free space increased from 3.1 GB (96% used) to 6.1 GB (92% used) after cleanup. After the new image and concurrent other deployments, the later reading was 4.1 GB free (95% used). Additional build capacity is still advisable; active builds were not cancelled or cleaned.
- The task's temporary local validation image and only the 40 cache records created by its two local builds were removed, reclaiming 2.399 GB locally. Older/unrelated local Docker state was preserved.

## Rollback and remaining work

The original SEO image is retained locally on the server as `crawlseo:rollback-node20-20261021` (image ID prefix `01748d49aab9`). Restoring that image is an emergency fallback; its Node 20 runtime is EOL and does not complete security remediation. No data rollback is needed for this runtime-only change.

n8n remains unchanged until an official patched image is available. Existing lint issues and server capacity planning are separate follow-ups. This audit-only update skips CI to avoid another image build/deployment; the deployed application revision remains `5cedbb6`.
