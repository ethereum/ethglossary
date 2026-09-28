# syntax=docker/dockerfile:1

# ---- build: install everything, compile fonts and css, bundle the server
FROM node:22-slim AS build
ENV CI=true
# pnpm's version comes from the packageManager field in package.json, the
# same place CI reads it; corepack fetches exactly that one.
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# A type error or a missing term uid fails here, not as a crash loop after rollout.
RUN pnpm run check && pnpm run check:uids && pnpm run build

# ---- runtime: node, the bundle and the static assets. No package manager,
# no node_modules; dist/server.js carries every dependency.
FROM node:22-slim
ARG GIT_SHA=""
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/migrations ./migrations
EXPOSE 8787
USER node
CMD ["node", "dist/server.js"]
