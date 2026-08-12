# Build the whole workspace, then ship only the server and its prod deps.
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY tools/simulate/package.json tools/simulate/
COPY tools/mapviz/package.json tools/mapviz/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec tsc --build
RUN pnpm --filter @www/server --prod deploy --legacy /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
EXPOSE 8080
CMD ["node", "dist/main.js"]
