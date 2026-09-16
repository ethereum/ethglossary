# syntax=docker/dockerfile:1

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@10.34.5
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@10.34.5
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --from=build --chown=node:node /app ./
ENV CI=true WRANGLER_SEND_METRICS=false
EXPOSE 8787
USER node
CMD ["pnpm", "exec", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]
