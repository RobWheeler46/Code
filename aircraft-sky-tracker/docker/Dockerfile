# Local Aircraft Sky Tracker (FRD §26). Build from the repository root:
#   docker build -f docker/Dockerfile -t aircraft-sky-tracker .

# ---- build stage ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HTTP_PORT=3000 \
    DATABASE_PATH=/app/data/tracker.sqlite

# Workspace symlinks + hoisted dependencies (express, ws) live in node_modules.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
# Note: persistent storage is provided by a Railway Volume mounted at /app/data
# (Railway does not support the Dockerfile VOLUME instruction). For plain Docker
# use, add `-v tracker-data:/app/data` at run time instead.
CMD ["node", "apps/server/dist/index.js"]
