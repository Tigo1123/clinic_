# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Copy package manifests and build configs
COPY package*.json tsconfig*.json nest-cli.json ./

# Install full dependencies (including TypeScript and Nest CLI)
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy application source and build NestJS application
COPY . .
RUN npm run build:nest

# -----------------------------------------------------------------------------
# Stage 2: Production Runner
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl wget

WORKDIR /app

# Copy application source files
COPY --chown=node:node . .

# Install production-only dependencies
RUN npm ci --omit=dev

# Overlay compiled NestJS artifacts and generated Prisma client from builder
COPY --from=builder --chown=node:node /app/src/generated ./src/generated/
COPY --from=builder --chown=node:node /app/dist ./dist/

# Ensure storage directories exist with node user permissions
RUN mkdir -p /data /app/uploads && chown -R node:node /app /data /app/uploads

USER node

# Expose port 5000
EXPOSE 5000

# Keep Node as PID 1 so Docker SIGTERM/SIGINT reach graceful shutdown handlers
# Express stays the production entrypoint until NestJS reaches route parity.
# Switch to ["node", "dist/main.js"] at cutover.
CMD ["node", "src/server.js"]
