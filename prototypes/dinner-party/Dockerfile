# The dinner-party prototype, shipped as its own Cloud Run service.
#
# Deliberately separate from the root Dockerfile: this has no dependencies, no build step
# and no share of the workspace, and keeping it that way is what stops notebook code
# leaking into `packages/server`. Rooms live in memory, so the service must run at
# max-instances=1 -- see cloudbuild.yaml.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server.mjs tale.mjs index.html ./
EXPOSE 8080
CMD ["node", "server.mjs"]
