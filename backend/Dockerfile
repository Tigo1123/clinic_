# Use official Node.js image as base
FROM node:22-alpine

RUN apk add --no-cache openssl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy prisma schema first to generate client
COPY --chown=node:node prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application files
COPY --chown=node:node . .

RUN mkdir -p /data /app/uploads && chown -R node:node /app /data

USER node

# Expose port 5000
EXPOSE 5000

# Keep Node as PID 1 so Docker SIGTERM/SIGINT reach the server's graceful
# shutdown handlers instead of stopping at an npm wrapper process.
CMD ["node", "src/server.js"]
