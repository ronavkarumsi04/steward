# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig*.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@steward/worker...

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# A fixed path rather than a home directory: the browser is a deployment asset, and this is the path both images
# install it to so the API's "is there a browser?" answer cannot disagree with the worker's.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY --from=build /app /app
# Chromium, because "browser-use agents" is a feature of this product and not of whoever happens to have installed
# a browser. A stack that does not want it sets BROWSER_PROVIDER=none and every surface says so in a sentence.
RUN pnpm --filter @steward/browser exec playwright install --with-deps chromium
# Worker talks to the Docker socket for sandboxes; run as root only if the socket is mounted read-write by the host.
CMD ["node", "apps/worker/dist/main.js"]
