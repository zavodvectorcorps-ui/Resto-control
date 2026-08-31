# Деплой RestoControl на свой VPS

Схема: 3 контейнера через `docker compose` — MongoDB, backend (FastAPI) и
frontend (статическая сборка React, которую раздаёт Caddy — он же
реверс-прокси `/api/*` на backend и сам получает HTTPS-сертификат
Let's Encrypt, без ручной возни с certbot).

MongoDB и backend не публикуются наружу — только Caddy слушает 80/443.

## 0. Перед первым деплоем — сохранить текущую работу

В репозитории сейчас много несохранённых изменений (не закоммичены и не
запушены в GitHub). Это первое, что нужно сделать — иначе деплоить
физически нечего будет клонировать на сервер:

```bash
git add -A
git commit -m "..."
git push origin main
```

## 1. Что нужно на руках

- [ ] Домен, который вы контролируете (DNS)
- [ ] SSH-доступ к VPS (IP, пользователь, ключ или пароль)
- [ ] VPS: Ubuntu 22.04/24.04, от 2 ГБ RAM (Mongo + backend + frontend в
      контейнерах — для двух заведений с их нагрузкой этого с запасом хватит)

## 2. DNS

У регистратора домена добавьте A-запись, указывающую на IP VPS:

```
A   your-domain.example   →   ВАШ_IP_VPS
```

Подождите, пока распространится (обычно 5–30 минут, можно проверить
`dig your-domain.example`).

## 3. Установить Docker на VPS

```bash
ssh root@ВАШ_IP_VPS

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

## 4. Забрать код на сервер

```bash
git clone https://github.com/zavodvectorcorps-ui/Resto-control.git
cd Resto-control
```

## 5. Заполнить конфиги

```bash
cp .env.production.example .env
cp backend/.env.production.example backend/.env.production
```

Откройте оба файла и замените все `CHANGE_ME_...`:

- `.env` (корень): `DOMAIN` = ваш реальный домен, `MONGO_ROOT_PASSWORD` —
  сгенерировать через `openssl rand -hex 24`
- `backend/.env.production`: `JWT_SECRET` (`openssl rand -hex 32`),
  пароль в `MONGO_URL` (тот же, что `MONGO_ROOT_PASSWORD` выше),
  `CORS_ORIGINS=https://ваш-домен`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` —
  учётка первого менеджера, под которым войдёте после запуска

## 6. Запуск

```bash
docker compose up -d --build
```

Первая сборка займёт несколько минут (собирается фронт, ставятся
Python-зависимости). Caddy сам обратится в Let's Encrypt за сертификатом —
на это нужно, чтобы DNS уже указывал на сервер (см. шаг 2).

Проверить статус:

```bash
docker compose ps
docker compose logs -f --tail=50
```

Открыть `https://ваш-домен` — должен открыться экран входа RestoControl
с рабочим замком в адресной строке.

## 7. Первый вход и проверка

1. Зайти как менеджер (`ADMIN_EMAIL`/`ADMIN_PASSWORD` из шага 5)
2. Дальше пойдёт восстановление данных из бэкапа/повторный перенос из
   Caffesta — на новой базе будет пусто, это ожидаемо
3. Пройти полный цикл заказа на одном столе, чтобы убедиться, что всё
   живое: открытие смены → заказ → печать (или эмулятор) → оплата →
   закрытие смены

## 8. Бэкапы

```bash
crontab -e
```

Добавить строку (бэкап каждую ночь в 03:00, хранится 14 копий):

```
0 3 * * * /root/Resto-control/scripts/mongo-backup.sh >> /var/log/resto-backup.log 2>&1
```

## 9. Обновление после изменений в коде

```bash
cd Resto-control
git pull
docker compose up -d --build
```

Данные в MongoDB при этом не трогаются (том `mongo_data` персистентный).

## Диагностика

- Caddy не выдаёт сертификат → проверьте, что DNS уже указывает на этот
  IP (`dig +short ваш-домен`) и что 80/443 не заняты и не закрыты
  файрволом (`ufw allow 80,443/tcp`)
- Backend не стартует → `docker compose logs backend`, чаще всего —
  опечатка в `backend/.env.production`
- 502 на `/api/*` → backend ещё не поднялся или упал, смотрите его логи
