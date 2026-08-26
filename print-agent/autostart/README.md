# Автозапуск агента печати RestoControl

Чтобы агент стартовал сам при включении устройства и перезапускался после сбоя,
выберите инструкцию под вашу ОС. Во всех случаях сначала должен работать `node agent.js`
вручную (см. `../README.md`).

## Windows (Планировщик задач) — проще всего
1. Положите `windows-install.ps1` в ту же папку, где лежит `agent.js`.
2. Правой кнопкой по PowerShell → «Запуск от имени администратора».
3. Выполните:
   ```powershell
   cd C:\путь\к\папке\с\agent.js
   powershell -ExecutionPolicy Bypass -File windows-install.ps1
   ```
4. Готово: агент стартует при входе в Windows, перезапускается при сбое.
   - Удалить автозапуск: `Unregister-ScheduledTask -TaskName RestoControlPrintAgent -Confirm:$false`

Альтернатива без скрипта: создайте ярлык `node agent.js` и положите его в
`shell:startup` (Win+R → `shell:startup`).

## macOS (launchd)
1. `which node` — скопируйте путь.
2. Откройте `com.restocontrol.agent.plist`, впишите путь к node, путь к `agent.js` и рабочую папку.
3. ```bash
   cp com.restocontrol.agent.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.restocontrol.agent.plist
   ```
   Логи: `/tmp/restocontrol-agent.out`, `/tmp/restocontrol-agent.err`.

## Linux (systemd) — для мини-ПК/сервера
1. Отредактируйте `restocontrol-agent.service` (User, пути, `which node`).
2. ```bash
   sudo cp restocontrol-agent.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now restocontrol-agent
   ```
   Логи: `journalctl -u restocontrol-agent -f`.

## Docker (любая ОS) — ещё один вариант автозапуска
`docker run -d --restart=always ...` (см. `../README.md`) — контейнер сам поднимется после перезагрузки.
