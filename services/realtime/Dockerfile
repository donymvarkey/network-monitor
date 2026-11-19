FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
WORKDIR /repo/services/realtime
ENV NODE_ENV=production
USER node
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
