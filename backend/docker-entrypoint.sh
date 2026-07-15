#!/bin/sh
set -e

# Railway монтирует persistent volume в /app/uploads владельцем root, а
# приложение бежит под пользователем node → без этого фикса запись файлов
# падала бы с EACCES. Чиним владельца смонтированного тома и сбрасываем
# привилегии до node перед запуском приложения (сам Node уже не root).
UPLOADS_DIR="${UPLOADS_DIR:-/app/uploads}"
mkdir -p "$UPLOADS_DIR/avatars" "$UPLOADS_DIR/files" "$UPLOADS_DIR/models"
chown -R node:node "$UPLOADS_DIR"

exec su-exec node "$@"
