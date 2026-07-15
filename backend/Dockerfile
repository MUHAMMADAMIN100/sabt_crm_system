# ─── Stage 1: Build ─────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ─── Stage 2: Production ─────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# su-exec — сбросить привилегии до node после фикса прав на смонтированный volume
RUN apk add --no-cache su-exec

# Install only production deps
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Entrypoint чинит владельца смонтированного тома uploads и дропает права до node
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Создаём папки uploads (для сценария без тома всё работает как раньше)
RUN mkdir -p uploads/avatars uploads/files uploads/models && \
    chown -R node:node /app

# ВАЖНО: НЕ ставим `USER node` — entrypoint стартует от root, чинит права на
# смонтированный Railway volume (он приходит owned by root) и сам сбрасывает
# привилегии до node через su-exec. Node уже бежит без root.

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Graceful shutdown support
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
