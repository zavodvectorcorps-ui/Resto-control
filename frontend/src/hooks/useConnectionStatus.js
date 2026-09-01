import { useEffect, useState } from "react";
import api from "@/lib/api";

const CHECK_INTERVAL_MS = 15000;
const TIMEOUT_MS = 5000;

// Реальная проверка связи с сервером, не только navigator.onLine (он
// показывает лишь то, что сетевой интерфейс поднят — Wi-Fi может быть
// подключён к роутеру, у которого при этом нет интернета).
export function useConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        await api.get("/health", { timeout: TIMEOUT_MS });
        if (!cancelled) setOnline(true);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const onOnline = () => check();
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
