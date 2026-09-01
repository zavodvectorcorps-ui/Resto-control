// Очередь действий, которые не удалось отправить на сервер из-за обрыва
// связи: отправка заказа на кухню и оплата. Хранится в localStorage
// (переживает перезагрузку страницы), по одной активной записи на стол —
// новая попытка для того же стола заменяет предыдущую.
//
// Печать при этом не работает: агент печати сам ходит в облако за
// заданиями, поэтому при обрыве интернета печать останавливается вместе
// с остальным (см. обсуждение локальной печати без интернета — отдельная
// задача на будущее). Очередь спасает от ПОТЕРИ заказа/оплаты, но не от
// задержки печати чека/тикета на кухню — они распечатаются постфактum,
// когда связь восстановится.
const KEY = "resto_offline_queue";
const EVENT = "resto-offline-queue-changed";

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(q) {
  localStorage.setItem(KEY, JSON.stringify(q));
  window.dispatchEvent(new Event(EVENT));
}

// entry:
//   { kind: "send", tableId, tableName, orderId, items, courseNumber }
//   { kind: "pay",  tableId, tableName, orderId, items, payBody, scEnabled }
export function enqueue(entry) {
  const q = getQueue().filter((e) => e.tableId !== entry.tableId);
  q.push({ ...entry, queuedAt: Date.now() });
  saveQueue(q);
}

export function dequeue(tableId) {
  saveQueue(getQueue().filter((e) => e.tableId !== tableId));
}

export function isQueued(tableId) {
  return getQueue().some((e) => e.tableId === tableId);
}

export function queuedKind(tableId) {
  return getQueue().find((e) => e.tableId === tableId)?.kind || null;
}

export function subscribeQueue(cb) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

// Сетевой сбой (нет ответа от сервера) отличаем от обычной ошибки (сервер
// ответил, но с кодом ошибки — например, стол уже занят другим заказом):
// в очередь ставим только первое, во втором случае повтор не поможет,
// нужно решение официанта на месте.
export function isNetworkError(e) {
  return !e?.response;
}
