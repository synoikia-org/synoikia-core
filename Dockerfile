# syntax=docker/dockerfile:1

# ── build ─────────────────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/check-node.mjs scripts/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/core/package.json packages/core/
COPY packages/admin-ui/package.json packages/admin-ui/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
# Only what the image ships: other workspace packages (create-plugin) aren't installed in this stage.
RUN pnpm --filter @synoikia/plugin-sdk --filter @synoikia/core --filter @synoikia/admin-ui build

# ── runtime ───────────────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    MCP_PORT=8080 \
    ADMIN_PORT=8081 \
    ADMIN_UI_DIR=/app/packages/admin-ui/dist
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/check-node.mjs scripts/
COPY --from=build /app/packages/plugin-sdk/package.json packages/plugin-sdk/
COPY --from=build /app/packages/plugin-sdk/dist packages/plugin-sdk/dist
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/drizzle packages/core/drizzle
COPY --from=build /app/packages/admin-ui/package.json packages/admin-ui/
COPY --from=build /app/packages/admin-ui/dist packages/admin-ui/dist
# Core's tree only: the portal ships prebuilt, so its Vue and Vite dependencies stay out of the image.
RUN pnpm install --frozen-lockfile --prod --filter @synoikia/core... \
 && mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# isolated-vm requires --no-node-snapshot on Node >= 20.
CMD ["node", "--no-node-snapshot", "packages/core/dist/main.js"]
