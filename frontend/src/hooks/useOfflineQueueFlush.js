import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { getQueue, dequeue, subscribeQueue, isNetworkError } from "@/lib/offlineQueue";

async function flushSend(entry) {
  let orderId = entry.orderId;
  if (orderId) {
    await api.put(`/orders/${orderId}`, { items: entry.items });
  } else {
    const { data } = await api.post("/orders", { table_id: entry.tableId, items: entry.items });
    orderId = data.id;
  }
  const suffix = entry.courseNumber ? `?course=${entry.courseNumber}` : "";
  await api.post(`/orders/${orderId}/send${suffix}`);
}

async function flushPay(entry) {
  let orderId = entry.orderId;
  if (orderId) {
    await api.put(`/orders/${orderId}`, { items: entry.items });
  } else {
    const { data } = await api.post("/orders", { table_id: entry.tableId, items: entry.items });
    orderId = data.id;
  }
  await api.patch(`/orders/${orderId}/service-charge`, { enabled: !!entry.scEnabled });
  await api.post(`/orders/${orderId}/pay`, entry.payBody);
}

// Отправляет накопленную офлайн-очередь на сервер, когда появляется связь.
// Не привязан к конкретному открытому столу — синхронизирует всё, что
// накопилось, независимо от того, что сейчас на экране у официанта.
export function useOfflineQueueFlush(online, onSynced) {
  const [pendingCount, setPendingCount] = useState(() => getQueue().length);
  const flushingRef = useRef(false);

  useEffect(() => {
    const unsub = subscribeQueue(() => setPendingCount(getQueue().length));
    return unsub;
  }, []);

  useEffect(() => {
    if (!online) return;
    if (flushingRef.current) return;
    const queue = getQueue();
    if (queue.length === 0) return;

    flushingRef.current = true;
    (async () => {
      let ok = 0, failed = 0;
      for (const entry of queue) {
        try {
          if (entry.kind === "pay") await flushPay(entry);
          else await flushSend(entry);
          dequeue(entry.tableId);
          ok++;
        } catch (e) {
          if (isNetworkError(e)) {
            // связь пропала посреди синхронизации — прервёмся, доделаем
            // в следующий раз, когда online снова станет true
            break;
          }
          // сервер ответил ошибкой (не сетевой сбой) — повтор не поможет,
          // убираем из очереди и просим проверить вручную
          dequeue(entry.tableId);
          failed++;
          console.error("offline queue sync failed", entry, e);
        }
      }
      flushingRef.current = false;
      if (ok > 0) {
        toast.success(`Синхронизировано после восстановления связи: ${ok}`);
        onSynced && onSynced();
      }
      if (failed > 0) {
        toast.error(`Не удалось синхронизировать ${failed} — нужна ручная проверка (см. консоль)`, { duration: 10000 });
      }
    })();
  }, [online, onSynced]);

  return pendingCount;
}
