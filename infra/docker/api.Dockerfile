# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig*.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@steward/api...

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# The API never drives a browser — pages live in the worker that opened them — but it is the process a founder
# asks "can this deployment browse?", and the honest answer is a fact about the image, not a guess from an
# environment variable. Same install, same path as the worker, so the two answers cannot drift apart.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY --from=build /app /app
RUN pnpm --filter @steward/browser exec playwright install --with-deps chromium
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
