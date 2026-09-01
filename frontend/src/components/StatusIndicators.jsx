import { Wifi, WifiOff, Printer } from "lucide-react";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { usePrinterStatus } from "@/hooks/usePrinterStatus";

// Иконки сети/принтеров — одинаковая логика в POS и в админке, разный
// набор цветов под тёмную POS-палитру и токены админки.
const PALETTE = {
  pos: {
    ok: "#00E676", okBg: "#00E67611",
    bad: "#FF3B30", badBg: "#FF3B3011",
    warn: "#FACC15", warnBg: "#FACC1511",
  },
  admin: {
    ok: "var(--success)", okBg: "var(--success-soft)",
    bad: "var(--danger)", badBg: "var(--danger-soft)",
    warn: "var(--warning)", warnBg: "var(--warning-soft)",
  },
};

export function StatusIndicators({ variant = "admin", className = "" }) {
  const online = useConnectionStatus();
  const { onlineCount, total } = usePrinterStatus();
  const c = PALETTE[variant];

  const printerColor = total === 0 ? null : onlineCount === total ? c.ok : onlineCount === 0 ? c.bad : c.warn;
  const printerBg = total === 0 ? null : onlineCount === total ? c.okBg : onlineCount === 0 ? c.badBg : c.warnBg;

  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="status-indicators">
      <div
        title={online ? "Есть связь с сервером" : "Нет связи с сервером"}
        data-testid="network-status"
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold shrink-0"
        style={{ color: online ? c.ok : c.bad, background: online ? c.okBg : c.badBg }}
      >
        {online ? <Wifi size={13} /> : <WifiOff size={13} />}
        {!online && "нет сети"}
      </div>
      {total > 0 && (
        <div
          title={`Принтеры: ${onlineCount} из ${total} на связи`}
          data-testid="printer-status"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold shrink-0"
          style={{ color: printerColor, background: printerBg }}
        >
          <Printer size={13} />
          {onlineCount}/{total}
        </div>
      )}
    </div>
  );
}
