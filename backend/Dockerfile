# Multi-stage Dockerfile for Exargen backend in a monorepo
# Build context should be the repository root
# Using node:20-slim (Debian) for better Prisma/OpenSSL compatibility

FROM node:20-slim AS builder

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy workspace package.json files
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install all dependencies (including dev deps for build)
RUN npm install --workspaces --include-workspace-root

# Copy source code
COPY shared ./shared
COPY backend ./backend

# Build shared first, then generate Prisma client, then build backend
RUN npm run build --workspace=shared
RUN cd backend && npx prisma generate
RUN npm run build --workspace=backend

# Production stage
FROM node:20-slim AS runner

# Install OpenSSL for Prisma runtime
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# COPY with --chown so the node user can read+write everything we copy.
# Without this, files land owned by root (Docker default) and our boot
# code (`ensureUploadsDirectory` → mkdir at runtime) fails with EACCES
# the moment we drop to USER node below.
COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/shared/package.json ./shared/
COPY --chown=node:node --from=builder /app/shared/dist ./shared/dist
COPY --chown=node:node --from=builder /app/backend/package.json ./backend/
COPY --chown=node:node --from=builder /app/backend/dist ./backend/dist
COPY --chown=node:node --from=builder /app/backend/prisma ./backend/prisma

# Pre-create the uploads directory so `ensureUploadsDirectory()` doesn't
# need to mkdir under /app/backend at boot. Owned by node so the runtime
# user can write into it (CMS uploads land here today, until R2/S3
# durable-storage wiring lands — see docs/DEPLOYMENT.md §file-storage).
RUN mkdir -p /app/backend/uploads/cms && chown -R node:node /app/backend/uploads

WORKDIR /app/backend

# Drop root before starting the process. The base node image ships a
# `node` user for exactly this purpose. QA H-L4: previously the
# container ran as root, which is a defense-in-depth gap (any RCE
# escalates to root inside the container).
#
# Bug fix: PR #52 introduced this without --chown on the COPYs above,
# which broke boot — `mkdir` for the uploads directory failed with
# EACCES under the unprivileged user. Hotfix: chown everything we copy
# to node:node, plus pre-create the uploads dir.
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
