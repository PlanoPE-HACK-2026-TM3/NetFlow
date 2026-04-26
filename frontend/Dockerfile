# syntax=docker/dockerfile:1.7
# =============================================================================
# NetFlow Frontend — Next.js 16 + React 18
# Multi-stage: deps → builder → runner. Runner ships only what's needed.
# =============================================================================

# ---------- Stage 1: install deps ----------
FROM node:20-alpine AS deps
WORKDIR /app

# libc6-compat is the standard shim Next binaries expect on Alpine.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
# --legacy-peer-deps: the repo's package-lock pins eslint@^8.57.1 while
# eslint-config-next@16.2.3 peer-requires eslint>=9. The mismatch is a
# lint-time concern only — it doesn't affect the production bundle — and
# npm itself recommends this flag in its error output.
RUN npm ci --legacy-peer-deps

# ---------- Stage 2: build ----------
FROM node:20-alpine AS builder
WORKDIR /app

# This is baked into the client bundle at build time because Next.js
# inlines NEXT_PUBLIC_* variables during `next build`.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js anonymous telemetry in CI / containers.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the build output plus the minimum needed to run `next start`.
COPY --from=builder --chown=nextjs:nodejs /app/.next          ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules   ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json   ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.js ./next.config.js

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -qO- http://localhost:3000 >/dev/null 2>&1 || exit 1

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
