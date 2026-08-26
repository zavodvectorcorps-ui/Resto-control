#!/usr/bin/env node
/**
 * RestoControl — Диагностика ESC/POS-принтера (перебор кодировок + тестовая печать)
 *
 * Инструмент для подключения НОВЫХ принтеров: печатает кириллическую тестовую
 * строку с разными значениями команды `ESC t <n>` и разными кодировками, чтобы
 * эмпирически подобрать рабочую пару <escape_t_value, codepage_label> под конкретную
 * модель/прошивку. Найденное значение escape_t_value заносится в карточку принтера
 * в админке (поле «ESC t»). НЕ выводить номер команды из названия кодировки —
 * у клонов (напр. Zjiang ZJ-80) он не совпадает со «стандартными» значениями.
 *
 * Подтверждено вживую на оборудовании заведения:
 *   Bixolon SRP-350U (кухня, 192.168.0.112:9100) — CP866, ESC t 17  ✅
 *   Zjiang ZJ-80    (бар,   192.168.0.111:9100) — CP866, ESC t 17  ✅
 *   Значения ESC t = 7,18 (cp866) и 6,20,34,46,71 (cp1251) — кракозябры, НЕ использовать.
 *
 * Требуется: Node.js 18+ и пакет iconv-lite  (npm i iconv-lite)
 *
 * Примеры:
 *   node printer-diagnostic.js --host 192.168.0.112            # перебор набора значений
 *   node printer-diagnostic.js --host 192.168.0.111 --t 17 --cp cp866   # одиночная печать
 *   node printer-diagnostic.js --host 192.168.0.112 --sweep 0,7,17,18,255
 */

const net = require("net");
let iconv;
try {
  iconv = require("iconv-lite");
} catch (e) {
  console.error("Установите зависимость:  npm i iconv-lite");
  process.exit(1);
}

const ESC = 0x1b, GS = 0x1d;
const args = parseArgs(process.argv.slice(2));
const HOST = args.host;
const PORT = Number(args.port || 9100);

if (!HOST) {
  console.error("Укажите --host <IP принтера> (порт по умолчанию 9100)");
  process.exit(1);
}

const TEST_TEXT = [
  "=== ТЕСТ ПЕЧАТИ ===",
  "Проверка кириллицы:",
  "абвгдеёжзийклмноп",
  "АБВГДЕЁЖЗ 0123456789",
  "Стол 5 / Официант Иван",
];

function buildBuffer(escT, codepage, labelLine) {
  const chunks = [];
  chunks.push(Buffer.from([ESC, 0x40]));                // ESC @  init
  chunks.push(Buffer.from([ESC, 0x74, escT & 0xff]));   // ESC t <n>  select codepage
  chunks.push(iconv.encode(`ESC t ${escT} / ${codepage}\n`, codepage));
  if (labelLine) chunks.push(iconv.encode(labelLine + "\n", codepage));
  for (const line of TEST_TEXT) chunks.push(iconv.encode(line + "\n", codepage));
  chunks.push(Buffer.from("\n\n\n"));
  chunks.push(Buffer.from([GS, 0x56, 0x00]));           // GS V 0  full cut
  return Buffer.concat(chunks);
}

function send(buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT }, () => {
      socket.write(buffer, () => { socket.end(); resolve(); });
    });
    socket.setTimeout(8000, () => { socket.destroy(); reject(new Error("timeout")); });
    socket.on("error", reject);
  });
}

async function main() {
  // одиночная печать под конкретную пару
  if (args.t !== undefined) {
    const escT = Number(args.t);
    const cp = args.cp || "cp866";
    console.log(`Печать одиночного теста: ESC t ${escT}, кодировка ${cp}`);
    await send(buildBuffer(escT, cp, null));
    console.log("Готово. Проверьте распечатку.");
    return;
  }

  // перебор набора значений ESC t (кодировка cp866 по умолчанию, можно --cp cp1251)
  const cp = args.cp || "cp866";
  const values = (args.sweep ? args.sweep.split(",") : ["0", "7", "17", "18", "255"]).map(Number);
  console.log(`Перебор ESC t = [${values.join(", ")}] с кодировкой ${cp} на ${HOST}:${PORT}`);
  console.log("Найдите на ленте блок, где кириллица читается корректно, и запишите его номер ESC t в карточку принтера.\n");
  for (const escT of values) {
    process.stdout.write(`  печать ESC t ${escT}... `);
    try {
      await send(buildBuffer(escT, cp, `>>> ВАРИАНТ ESC t = ${escT} <<<`));
      console.log("ок");
    } catch (e) {
      console.log("ошибка: " + e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("\nПеребор завершён.");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

main().catch((e) => { console.error("Ошибка:", e.message); process.exit(1); });
