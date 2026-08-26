/**
 * RestoControl — Локальный агент печати (мост между облаком и принтерами)
 *
 * Запускается на устройстве в ЛОКАЛЬНОЙ сети заведения (ноутбук/мини-ПК/Android TV Box),
 * в той же сети, что и чековые принтеры. Проброс портов на роутере НЕ нужен —
 * агент сам ходит наружу к облачному бэкенду (polling).
 *
 * Что делает:
 *   1) раз в POLL_INTERVAL мс забирает pending-задания:  GET  /api/agent/print-jobs
 *   2) декодирует base64 payload (готовый ESC/POS буфер, кириллица уже в нужной кодировке)
 *   3) открывает raw TCP сокет на printer.local_ip:printer.port (обычно :9100), шлёт байты
 *   4) отчитывается:  PATCH /api/agent/print-jobs/{id}  { status: printed|failed }
 *   5) раз в HEARTBEAT_INTERVAL пингует принтеры и шлёт: POST /api/agent/heartbeat
 *
 * Конфиг через переменные окружения (см. .env.example).
 */

const net = require("net");

const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const API_KEY = process.env.AGENT_API_KEY || "";
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS || 1500);
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_MS || 30000);
const RETRY_DELAYS = [5000, 15000, 30000];

if (!BACKEND_URL || !API_KEY) {
  console.error("ОШИБКА: задайте BACKEND_URL и AGENT_API_KEY (см. .env.example)");
  process.exit(1);
}

const headers = { "X-Agent-Key": API_KEY, "Content-Type": "application/json" };

async function api(path, method = "GET", body) {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// кэш принтеров: id -> {local_ip, port, name}
let printers = {};
async function refreshPrinters() {
  try {
    const list = await api("/agent/printers");
    printers = {};
    for (const p of list) printers[p.id] = p;
  } catch (e) {
    console.error("refreshPrinters error:", e.message);
  }
}

// Отправка сырых байт на принтер по TCP :9100
function sendToPrinter(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, 8000);
    socket.connect(port, ip, () => {
      socket.write(buffer, () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function processJob(job) {
  const buffer = Buffer.from(job.payload, "base64");
  const ip = job.printer_ip || printers[job.printer_id]?.local_ip;
  const port = job.printer_port || printers[job.printer_id]?.port || 9100;

  // ретраи 5с/15с/30с
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      if (!ip) throw new Error("не задан IP принтера");
      await sendToPrinter(ip, port, buffer);
      await api(`/agent/print-jobs/${job.id}`, "PATCH", { status: "printed" });
      console.log(`[OK] job ${job.id} -> ${job.printer_name} (${ip}:${port})`);
      return;
    } catch (e) {
      if (attempt < RETRY_DELAYS.length) {
        console.warn(`[retry ${attempt + 1}] job ${job.id}: ${e.message}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      } else {
        console.error(`[FAIL] job ${job.id}: ${e.message}`);
        await api(`/agent/print-jobs/${job.id}`, "PATCH", {
          status: "failed",
          error_message: e.message,
        });
      }
    }
  }
}

async function pollLoop() {
  try {
    const jobs = await api("/agent/print-jobs");
    for (const job of jobs) await processJob(job);
  } catch (e) {
    console.error("poll error:", e.message);
  } finally {
    setTimeout(pollLoop, POLL_INTERVAL);
  }
}

async function heartbeatLoop() {
  try {
    // Пингуем известные принтеры TCP-коннектом; статусы шлём на бэкенд.
    const statuses = {};
    for (const [id, p] of Object.entries(printers)) {
      statuses[id] = await ping(p.local_ip, p.port).then(() => "online").catch(() => "offline");
    }
    await api("/agent/heartbeat", "POST", { printers: statuses });
  } catch (e) {
    console.error("heartbeat error:", e.message);
  } finally {
    setTimeout(heartbeatLoop, HEARTBEAT_INTERVAL);
  }
}

function ping(ip, port) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    const t = setTimeout(() => { s.destroy(); reject(new Error("timeout")); }, 3000);
    s.connect(port || 9100, ip, () => { clearTimeout(t); s.end(); resolve(); });
    s.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

console.log(`RestoControl print-agent запущен. Бэкенд: ${BACKEND_URL}, опрос: ${POLL_INTERVAL}ms`);
refreshPrinters().then(() => {
  pollLoop();
  heartbeatLoop();
});
setInterval(refreshPrinters, 60000);
