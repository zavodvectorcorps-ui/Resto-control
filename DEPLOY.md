# Деплой RestoControl на VPS (общий хаб Menu_rest2)

На этом VPS уже живут несколько проектов (`Menu_rest2`/rest-menu.by,
`alfinance`, `wm-finance`) за одним общим nginx-контейнером
(`menu_rest2-nginx-1`), который держит порты 80/443 и раздаёт SSL для всех
доменов через общий certbot. RestoControl подключается тем же способом —
собственного nginx/Caddy и своих портов 80/443 не заводим.

Домен: **restocontrol.by**

## Схема

```
Интернет → menu_rest2-nginx-1 (80/443, общий) → restocontrol-backend:8001
                                                → restocontrol-frontend:80
```

`restocontrol-backend`/`restocontrol-frontend` — контейнеры RestoControl,
подключённые к общей docker-сети `menu_rest2_default` (как и
`wmfinance-backend`/`wmfinance-frontend` для wm-finance.pl — тот же
проверенный паттерн). Mongo RestoControl — в отдельной сети, наружу и
другим проектам не виден.

## 1. Забрать код на сервер

```bash
ssh vps-knyazev
cd /root
git clone https://github.com/zavodvectorcorps-ui/Resto-control.git
cd Resto-control
```

## 2. Заполнить конфиги

```bash
cp .env.production.example .env
cp backend/.env.production.example backend/.env.production
```

Сгенерировать и вписать:
- `.env`: `MONGO_ROOT_PASSWORD` — `openssl rand -hex 24`
- `backend/.env.production`: `JWT_SECRET` — `openssl rand -hex 32`;
  пароль в `MONGO_URL` = тот же `MONGO_ROOT_PASSWORD`; `ADMIN_EMAIL`/
  `ADMIN_PASSWORD` — учётка первого менеджера (`CORS_ORIGINS` и остальное
  уже проставлено на `restocontrol.by`)

## 3. Поднять контейнеры

```bash
docker compose up -d --build
docker compose ps
```

На этом этапе сайт ещё не доступен снаружи — только внутри общей сети.
Проверка изнутри:

```bash
docker run --rm --network menu_rest2_default curlimages/curl \
  curl -s http://restocontrol-backend:8001/api/health
```

## 4. DNS

У регистратора `restocontrol.by` добавить A-запись на IP этого VPS
(`212.192.22.12`) для `restocontrol.by` и `www.restocontrol.by`.
Подождать распространения (`dig +short restocontrol.by`).

## 5. Подключить домен к общему nginx + получить сертификат

`Menu_rest2/scripts/add-domain.sh` заточен под upstream-имена `backend`/
`frontend` (это контейнеры основного rest-menu.by) — для RestoControl
имена другие (`restocontrol-backend`/`restocontrol-frontend`), поэтому
шаги те же самые, но руками:

```bash
cd /root/Menu_rest2

# 1) сертификат
docker compose run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
    --email admin@restocontrol.by --agree-tos --no-eff-email \
    -d restocontrol.by -d www.restocontrol.by" certbot

# 2) конфиг сайта
cat > nginx/custom-domains/restocontrol.by.conf <<'EOF'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name restocontrol.by www.restocontrol.by;
    resolver 127.0.0.11 valid=10s ipv6=off;

    ssl_certificate /etc/nginx/ssl/live/restocontrol.by/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/live/restocontrol.by/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 20M;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        set $backend_upstream "restocontrol-backend:8001";
        proxy_pass http://$backend_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_next_upstream error timeout http_502 http_503 http_504;
    }

    location / {
        set $frontend_upstream "restocontrol-frontend:80";
        proxy_pass http://$frontend_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_next_upstream error timeout http_502 http_503 http_504;
    }
}
EOF

# 3) проверить и перезагрузить
docker run --rm \
  -v "$(pwd)/nginx/nginx.conf":/etc/nginx/nginx.conf:ro \
  -v "$(pwd)/nginx/custom-domains":/etc/nginx/custom-domains:ro \
  -v "$(pwd)/nginx/ssl":/etc/nginx/ssl:ro \
  nginx:alpine nginx -t -c /etc/nginx/nginx.conf

docker compose restart nginx
```

Если `nginx -t` ругается — конфиг НЕ применится сам (контейнер продолжит
работать со старым конфигом), можно спокойно чинить и повторять команду.

## 6. Проверка

Открыть `https://restocontrol.by` — экран входа RestoControl, рабочий
замок в адресной строке. Остальные сайты (`rest-menu.by`, `wm-finance.pl`
и т.д.) должны продолжать отвечать как раньше — не пересекались.

Дальше — вход менеджером, полный цикл заказа (смена → стол → заказ →
оплата → закрытие смены), как в исходном плане.

## Бэкапы

```bash
crontab -e
```

```
0 3 * * * /root/Resto-control/scripts/mongo-backup.sh >> /var/log/resto-backup.log 2>&1
```

## Обновление после изменений в коде

```bash
cd /root/Resto-control
git pull
docker compose up -d --build
```

Данные в Mongo не трогаются (том `mongo_data` персистентный). Домен и
сертификат трогать не нужно — они настраиваются один раз.

## Диагностика

- `docker compose logs backend` / `docker compose logs frontend` — логи
  RestoControl
- `docker exec menu_rest2-nginx-1 nginx -t` — валиден ли общий конфиг
  прямо сейчас
- 502 на `restocontrol.by` → RestoControl ещё не поднялся или упал;
  проверить `docker compose ps` в `/root/Resto-control`
- Другие сайты (rest-menu.by и т.д.) отвалились после наших правок →
  `cd /root/Menu_rest2 && docker compose restart nginx` откатит на
  последний валидный конфиг только если мы не перезаписали рабочий файл;
  наш файл лежит отдельно (`custom-domains/restocontrol.by.conf`) и на
  остальные не влияет — можно просто удалить его и перезапустить nginx
