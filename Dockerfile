# Build the whole workspace, then ship only the server and its prod deps.
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
# Every workspace package, not just the ones the server imports. `COPY . .` below
# brings in all of them and the root tsconfig references all of them, so `tsc --build`
# builds the whole solution -- and a package whose manifest was missing here has no
# node_modules, so its `workspace:*` dependency does not resolve and the build fails.
# tools/sacre is the one that proved it: tools/ci had been missing from this list for
# months without complaint, because it depends on nothing.
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY tools/ci/package.json tools/ci/
COPY tools/simulate/package.json tools/simulate/
COPY tools/mapviz/package.json tools/mapviz/
COPY tools/sacre/package.json tools/sacre/
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
