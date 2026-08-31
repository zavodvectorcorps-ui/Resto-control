# Стадия 1: сборка статического бандла
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
# Пусто = фронт ходит на /api того же домена (общий nginx на VPS проксирует
# /api на backend, а этот контейнер отдаёт только статику) — не завязываемся
# на конкретный домен в собранном бандле.
ENV REACT_APP_BACKEND_URL=
ENV CI=false
RUN npm run build

# Стадия 2: раздаём статику плоским nginx (TLS и роутинг /api берёт на себя
# общий nginx-хаб на VPS — см. DEPLOY.md)
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
