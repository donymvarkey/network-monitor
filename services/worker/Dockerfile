FROM node:22-alpine
RUN apk add --no-cache iputils openssl
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
WORKDIR /repo/services/worker
RUN pnpm exec prisma generate --schema ../../apps/web/prisma/schema.prisma
ENV NODE_ENV=production
USER node
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
