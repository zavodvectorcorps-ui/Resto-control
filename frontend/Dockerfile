# Стадия 1: сборка статического бандла
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Пусто = фронт ходит на /api того же домена (Caddy проксирует на backend) —
# не завязываемся на конкретный домен в собранном бандле.
ENV REACT_APP_BACKEND_URL=
RUN npm run build

# Стадия 2: Caddy — раздаёт статику и сам получает HTTPS-сертификат
FROM caddy:2-alpine
COPY --from=build /app/build /srv
COPY Caddyfile /etc/caddy/Caddyfile
