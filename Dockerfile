FROM oven/bun:1.3.12-alpine

ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

CMD ["bun", "src/index.ts"]
