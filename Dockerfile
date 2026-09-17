# syntax=docker/dockerfile:1

# ---- build: install everything, compile fonts and css, bundle the server
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN npm install -g pnpm@10.34.5
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

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
EXPOSE 8787
USER node
CMD ["node", "dist/server.js"]
