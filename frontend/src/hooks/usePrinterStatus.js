import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

// Агент печати шлёт heartbeat раз в ~30с (см. print-agent/README) — если
// last_seen_at старше этого порога, считаем принтер оффлайн, даже если в
// базе последний зафиксированный статус был "online".
const STALE_MS = 90 * 1000;

export function usePrinterStatus() {
  const { data: printers = [] } = useQuery({
    queryKey: ["printers-status"],
    queryFn: async () => (await api.get("/printers")).data,
    refetchInterval: 30000,
  });

  const now = Date.now();
  const withStatus = printers.map((p) => {
    const lastSeen = p.last_seen_at ? new Date(p.last_seen_at).getTime() : null;
    const fresh = !!lastSeen && now - lastSeen < STALE_MS;
    return { ...p, isOnline: p.status === "online" && fresh };
  });

  return {
    printers: withStatus,
    onlineCount: withStatus.filter((p) => p.isOnline).length,
    total: withStatus.length,
  };
}
