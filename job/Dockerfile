# Build context: repository root.  docker build -f job/Dockerfile -t premium-watch-job .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY api/package.json api/
COPY job/package.json job/
COPY firestore/package.json firestore/
RUN npm ci -w @pw/shared -w @pw/job --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY job job
RUN npm run build -w @pw/shared && npm run build -w @pw/job

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY api/package.json api/
COPY job/package.json job/
COPY firestore/package.json firestore/
RUN npm ci -w @pw/shared -w @pw/job --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/job/dist job/dist
USER node
# Default: daily close for every market. Scheduler triggers override the args.
ENTRYPOINT ["node", "job/dist/main.js"]
CMD ["--mode", "close", "--market", "all"]
