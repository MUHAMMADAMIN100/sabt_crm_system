# ─── Stage 1: Build ─────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 2: Production ─────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Create uploads directories
RUN mkdir -p uploads/avatars uploads/files && \
    chown -R node:node /app

# Run as non-root user
USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Graceful shutdown support
CMD ["node", "dist/main"]
