FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js evaluates the Auth.js configuration while collecting build output.
# These non-secret placeholders keep the image build independent of runtime
# configuration; deployments provide the real values to the final stage.
ENV DATABASE_URL=postgresql://crawlseo:crawlseo@localhost:5432/crawlseo
ENV GOOGLE_CLIENT_ID=docker-build-placeholder
ENV GOOGLE_CLIENT_SECRET=docker-build-placeholder
ENV NEXTAUTH_SECRET=docker-build-placeholder
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package-lock.json ./
# Do not install Prisma here. The ARM64 build runs this stage through QEMU in
# GitHub Actions, where Prisma's install script can raise an illegal-instruction
# error. Coolify runs the startup command natively, after the image is built.
ENV NPM_CONFIG_CACHE=/tmp/.npm
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/node_modules/@esbuild ./node_modules/@esbuild
RUN mkdir -p node_modules/.bin && ln -s ../tsx/dist/cli.mjs node_modules/.bin/tsx
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["sh", "-c", "npx --yes prisma@$(node -p \"require('./package-lock.json').packages['node_modules/prisma'].version\") migrate deploy && node server.js"]
