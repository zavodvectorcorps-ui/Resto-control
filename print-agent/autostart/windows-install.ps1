# Windows: автозапуск агента печати RestoControl
# Регистрирует задачу планировщика, которая запускает агент при входе в систему
# и перезапускает его при сбое. Запускать в PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА
# из папки, где лежит agent.js:
#     powershell -ExecutionPolicy Bypass -File windows-install.ps1

$ErrorActionPreference = "Stop"
$TaskName = "RestoControlPrintAgent"

# путь к папке скрипта (тут же должен лежать agent.js — на уровень выше, если запускаете из autostart\)
$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $AgentDir "agent.js"))) {
    $AgentDir = Split-Path -Parent $AgentDir   # запуск из подпапки autostart\
}
$AgentJs = Join-Path $AgentDir "agent.js"
if (-not (Test-Path $AgentJs)) { throw "Не найден agent.js рядом со скриптом. Положите windows-install.ps1 в папку с agent.js." }

# ищем node.exe
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { throw "Node.js не найден. Установите с nodejs.org (LTS) и повторите." }

Write-Host "Node:   $Node"
Write-Host "Agent:  $AgentJs"

$Action  = New-ScheduledTaskAction -Execute $Node -Argument "`"$AgentJs`"" -WorkingDirectory $AgentDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId $env:UserName -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Готово. Агент будет запускаться автоматически при входе в Windows." -ForegroundColor Green
Write-Host "Проверить статус:   Get-ScheduledTask -TaskName $TaskName"
Write-Host "Удалить автозапуск: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
