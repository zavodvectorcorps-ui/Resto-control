# RestoControl — Сервис учёта и контроля для ресторана

## Original Problem Statement
Сервис учёта и контроля для ресторана (аналог caffesta.com). Нужен фронт для администраторов и отдельно для официантов и кассиров.

## User Choices
- MVP: Касса (POS), Складской учёт, Отчёты/аналитика для админа, Меню + заказы
- Auth: админ — email/пароль (JWT); официант/кассир — PIN-код
- Своя система со своей БД (без интеграции Caffesta API)
- Оплата без реального платежа (наличные/карта вручную)
- Русский язык, тёмная тема
- Цеха (kitchen workshops) + печать (print preview)

## Architecture
- Backend: FastAPI + MongoDB (motor), JWT bearer auth, `/api` prefix. Single `server.py`.
- Frontend: React + react-router, react-query, zustand (POS cart), Tailwind, shadcn/ui, recharts. Manrope + IBM Plex Sans, dark theme (#0A0A0A / #FF5A00 accent).
- Роли: admin (/admin back-office), waiter+cashier (/pos терминал).

## User Personas
- Администратор: управляет меню, цехами, столами, складом, сотрудниками; смотрит отчёты.
- Официант: принимает заказы по столам, отправляет на кухню (по цехам).
- Кассир: всё что официант + приём оплаты, открытие/закрытие смены.

## Implemented (2026-06)
- Auth: /auth/login (email/pass), /auth/pin-login (PIN), /auth/me. Bcrypt, brute-force lockout (5 попыток / 15 мин по IP).
- Admin: Dashboard (выручка сегодня/всего, средний чек, график 7 дней, топ позиций), Меню (товары+категории), Цеха, Столы, Склад (остатки + приходные накладные + списания), Сотрудники (роли+PIN), Отчёты (за период: по позициям, по кассирам, структура оплат).
- POS: открытие/закрытие смены, выбор стола, заказ по категориям, корзина, отправка на кухню с печатью тикетов по цехам, оплата (нал/карта + скидка), чек. RBAC: официант не видит и не может «Оплатить» (enforced на API).
- Seed: admin@resto.com/admin123, официант PIN 1111, кассир PIN 2222, демо-меню/столы/склад.
- RBAC на pay/CRUD, валидация ObjectId (404), запрет списания в минус.

## Backlog
- P1: Печать на физические принтеры (сейчас browser print preview / MOCKED железо); привязка ингредиентов к тех.картам для авто-списания со склада при продаже.
- P2: Блокировка закрытия смены при открытых заказах; замена нативных date-input на shadcn Calendar (ru-RU); объединение/разделение счетов, перенос заказа между столами.
- P2: httpOnly cookie сессии вместо localStorage; редактирование цехов/столов.

## Implemented (2026-06 — iteration 2/3)
- **Печать по цехам (ESC/POS)**: модели printers/print_agents/print_jobs. Цех = станция печати (kitchen/bar/precheck). Бэкенд рендерит ESC/POS (ESC @ + ESC t <escape_t_value> + текст в codepage_label + GS V 0 рез). Роутинг заказа по цеху блюда → принтер. Типы заданий: ticket (только новые позиции), precheck (счёт с ценами), void (сторно). Ретраи/статусы, retry из админки.
- **escape_t_value (по брифу)**: у каждого принтера ручное поле ESC t <n> + codepage_label (cp866/cp1251, whitelist). Реальное оборудование: Кухня 192.168.0.112 (Bixolon SRP-350U), Бар/Касса 192.168.0.111 (Zjiang ZJ-80) — cp866, ESC t 17. Миграция существующих принтеров в seed().
- **Локальный агент** `/app/print-agent/` (Node.js + Docker + README): polling GET /agent/print-jobs → TCP :9100 → PATCH статус, heartbeat, /agent/printers. Auth по X-Agent-Key. Запускается на устройстве в сети заведения.
- **Эмулятор** `/agent/emulate` + кнопка в админке (демо потока печати в облаке без железа).
- **Диагностика** `/app/tools/printer-diagnostic.js` — перебор ESC t / кодировок + тестовая печать для подключения новых принтеров.
- **Авто-списание склада (тех.карты)**: у блюда список ингредиентов {inventory_id, amount}; при оплате списывается amount × count, пишется writeoff «Продажа: <блюдо>». Редактор тех.карты в админ-меню.
- **Разделение счёта** (по индексам позиций) + **несколько счетов на столе** (bill picker) + **перенос заказа** на другой стол.
- **Сторно позиции**: печатает СТОРНО-тикет на цех; сторно последней позиции отменяет заказ.
- **Контроль смены**: закрытие блокируется при незакрытых заказах текущей смены; открытие смены — только кассир/админ.
- **Безопасность**: lockout по идентичности (валидный вход не блокируется) + глобальный троттлинг подбора PIN; 404 на удаление несуществующего заказа.

## Implemented (2026-06 — iteration 7: роли + защищённое удаление)
- **Задача 0 — роли**: старые роли переименованы/разделены на **manager** (бэк-офис, вход email/пароль), **admin** (касса/POS, вход по PIN, бывший «кассир»), **waiter** (официант, PIN). Manager видит только /admin, admin/waiter — только /pos. Одноразовая миграция ролей и имён в seed (флаги role_migration_v1 / role_names_v1). RBAC: бэк-офис = manager; открытие смены и оплата = admin. StaffReq валидирует роль (Literal); PUT /staff запрещает эскалацию PIN-пользователя в manager.
- **Задача 1 — защищённое удаление позиций**: удаление уже отправленной на цех позиции требует **причину** и, если удаляет официант, **PIN администратора/менеджера**; каждое такое удаление пишется в `order_corrections` и видно в отчёте «Удаления позиций (контроль)» (GET /reports/corrections). Неотправленные позиции удаляются мгновенно (локально + синхронизация PUT/DELETE заказа).

## Implemented (2026-06 — Задача 5: расширенная аналитика) ✅ протестировано (iteration_8, 21/21 backend + frontend)
- Бэкенд: GET /reports/by-category (группировка по category_id через products), GET /reports/by-workshop (по workshop_id позиции), GET /reports/abc?metric=revenue|count (кумулятивная доля + класс A≤80% / B≤95% / C). Всё под require_roles("manager"). Существовавший /reports/analytics (by_hour, avg_check, margin_by_product) сохранён.
- Фронт: Reports.jsx переделан во вкладки — Продажи / Аналитика / Категории+Цеха / ABC-анализ / Удаления. recharts BarChart (по часам, по категориям/цехам гориз.), таблицы маржи и ABC с классовыми бейджами, переключатель метрики ABC. Все панели с data-testid.
- stock-movement НЕ сделан — зависит от Задачи 2 (нужен warehouse_id).

## Implemented (2026-06 — Мультитенантный фундамент) ✅ протестировано (iteration_9, 39 тестов + self-test IDOR)
- Коллекция `restaurants` + дефолтное заведение «Мята Спортивная» (is_default). Эндпоинты: GET /restaurants, GET /restaurants/current, POST /restaurants (manager).
- `restaurant_id` во всех сущностях: добавляется на всех insert'ах (workshops, categories, products, tables, users, shifts, orders, inventory, suppliers, invoices, writeoffs, printers, print_agents, print_jobs, order_corrections).
- JWT несёт `rid`; get_current_user выставляет user["restaurant_id"] (из user-дока, fallback token → default).
- Все list/read-запросы scoped по restaurant_id. Отчёты tenant-scoped.
- Все by-id find_one/update_one/delete_one scoped → cross-tenant IDOR закрыт. Агентские эндпоинты scoped по restaurant_id агента.
- Миграция: seed() бэкфиллит restaurant_id на все документы. Данные сохранены (products=8, orders=124, staff=3).
- UI-переключатель заведений отложен (одно заведение). Settings (чек) пока общие.

## ОБНОВЛЁННЫЙ БРИФ (q4ubq956) — 16 задач + мультитенантность
- Архитектурное замечание: заложить restaurant_id во ВСЕ сущности + фильтрацию в db-запросах + в JWT/сессию, дефолтный Restaurant «Мята», миграция. UI-переключатель заведения можно отложить. (НЕ сделано)
- Задачи 0,1 — ✅ сделаны ранее. Задача 5 — ✅ сделана (кроме stock-movement).
- Задача 2: мультисклад + автосебестоимость из рецепта (cost_source auto|manual). (следующая)
- Задача 3: модификаторы блюд (ModifierGroup/Option, selected_modifiers в заказе, пикер в POS, печать, списание).
- Задача 4: клиенты + скидка по телефону (Client, client_id в заказе, поле телефона в оплате, отчёт по клиенту).
- Фаза 2:
  - Задача 6: бонусный баланс (LoyaltyGroup/Transaction, bonus_redeem, max_bonus_payment_percent) + акции с окнами (Promotion, /promotions/active).
  - Задача 7: брутто/нетто, % потерь по методу обработки, yield_g, preparation_notes.
  - Задача 8: отчёты by-hall, promotions (ROI), loyalty.
- Фаза 3:
  - Задача 9: возврат товара (POST /orders/{id}/refund, refunds, /reports/refunds).
  - Задача 10: сервисный сбор (service_charge_percent в Settings, тумблер в POS, строка в чеке).
  - Задача 11: резервы/депозиты (Reservation, /reservations, Order.prepaid_amount).
  - Задача 12: справочник «Быстрые комментарии» (QuickComment по context) + внесение/изъятие налички (cash_movements, /shifts/cash-movement) + причина при отмене заказа.
  - Задача 13: стоп-лист в кассе (stop_list_entries на смену, /pos/stop-list/{id}).
  - Задача 14: настраиваемые способы оплаты (PaymentMethod) + счёт клиента «в долг» (debt_balance, /clients/{id}/pay-debt, /reports/debts).
  - Задача 15: курсы подачи блюд (course_number на категории/продукте/позиции, печать, группировка в корзине).

## Вне рамок
Фискализация чеков; QR-меню внутри RestoControl; KDS-экран повара; штрихкоды/ценники; весы/дисплей покупателя; тонкая CRUD-матрица прав.

## Notes
- Печать реализована как print-preview в браузере (реальное подключение к принтерам — железо, недоступно в облаке).
