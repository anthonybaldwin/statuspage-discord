FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

CMD ["bun", "src/index.ts"]
