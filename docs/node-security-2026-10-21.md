# Node runtime maintenance — 2026-10-21

## Authorized scope

Update CrawlSEO from its EOL Node 20 runtime to patched Node 24.22.1, publish and deploy the application image, verify the live version and health, and clean unused Docker images/build cache. Keep n8n unchanged. Preserve user documents, databases, volumes, configuration and existing application behavior.

## Forward and rollback paths

- Pin the official multi-platform Node 24.22.1 Alpine 3.23 base (preserving the existing OS line) by registry index digest; verify the exact runtime during image build. All Docker stages inherit it.
- Pin local Node files and root engine metadata; leave dependency resolution unchanged. Update active setup instructions.
- Run existing lint, tests and production build under patched Node. The normal multi-architecture GitHub workflow publishes GHCR and triggers Coolify.
- Before push/deployment, verify the current live schema has no pending migrations and the deployed schema/migration files match the unchanged repository files. The existing startup migration check must report no pending migrations; do not apply schema changes for this task.
- Record and retain the current SEO image ID/digest as rollback. A failed image/build/healthcheck leaves or restores that image. Reverting to Node 20 is an emergency rollback only and does not complete remediation.

## Docker cleanup boundaries

Inventory all container image references and image tags first. Retain running/stopped container images and one prior usable application image per relevant app/preview, including the previous SEO image. Remove only specifically identified unused images and regenerable unused build cache. Never prune volumes, containers, networks or persistent data. Confirm disk increase and unchanged service health afterward.

## Status and open decisions

Runtime changes implemented locally; checks, publishing, live deployment and cleanup pending. No open product or schema decisions. n8n remains excluded until an official patched image exists.

## Validation checkpoint

- Production schema status: all 17 migrations applied; database up to date. Current image OCI revision is the same unchanged baseline as this branch (`9e05874`).
- Existing 280 tests passed under Node 24.22.1. Local tsx initially needed an allowed IPC socket; the canonical test command passed outside the restricted sandbox.
- ESLint reports 13 errors / 10 warnings in unchanged application components and MCP formatters. No application source is modified by this maintenance update. These existing lint issues are outside scope.
- Full local Linux/arm64 Docker build on the official patched runtime passed Next compile, TypeScript and static generation; the final Alpine 3.23 build hit the local Docker disk limit during npm extraction. The unchanged production OS line remains pinned; GitHub multi-architecture build success is required before its dependent deploy job can run.
- Official Docker registry index digest for `node:24.22.1-alpine3.23`: `sha256:4b00b6d1aa138805aace94cc2482808f2b4f01e5e9c9f8cdc0e217fd70600ef9`.
- Production rollback image retained as `ghcr.io/ddushkin/crawlseo:rollback-node20-20261021`, image ID `017484d9aab9`.
