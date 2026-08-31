import { useRef, useState } from "react";
import { Trash2, Tag } from "lucide-react";

export const DEFAULT_RECT = { width: 90, height: 68 };
export const DEFAULT_CIRCLE = { width: 68, height: 68 };
const PAD = 40;
const MIN_SIZE = 40;

// Общий холст карты зала. mode="edit" — перетаскивание/ресайз/удаление (админка).
// mode="select" — только клик по столу (POS официанта).
const PALETTE = {
  admin: {
    free: "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--accent)]",
    mine: "border-[var(--accent)] bg-[var(--accent-soft)]",
    others: "border-[#A855F7] bg-[#A855F7]/10",
    serviceFree: "border-dashed border-[var(--ink-faint)] bg-transparent opacity-80 hover:opacity-100",
    serviceOccupied: "border-[var(--warning)] bg-[var(--warning-soft)]",
  },
  pos: {
    free: "border-[#27272A] bg-[#121212] hover:border-[#FF5A00]",
    mine: "border-[#00E5FF] bg-[#06171A]",
    others: "border-[#A855F7] bg-[#1A0F1E]",
    serviceFree: "border-dashed border-[#3F3F46] bg-transparent opacity-80 hover:opacity-100",
    serviceOccupied: "border-[#F59E0B] bg-[#2A1D06]",
  },
};

export function FloorPlan({ hall, tables, mode = "select", variant = "admin", fit = "width", isMine, onMove, onResize, onDelete, onSelect, renderExtra }) {
  const palette = PALETTE[variant];
  const dark = variant === "pos";
  const ref = useRef(null);
  const [drag, setDrag] = useState(null); // { id, kind: 'move'|'resize', x,y,w,h }

  const bboxW = Math.max(600, ...tables.map((t) => (t.pos_x ?? 0) + (t.width ?? DEFAULT_RECT.width) + PAD));
  const bboxH = Math.max(360, ...tables.map((t) => (t.pos_y ?? 0) + (t.height ?? DEFAULT_RECT.height) + PAD));

  const toCanvas = (clientX, clientY) => {
    const rect = ref.current.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * bboxW, y: ((clientY - rect.top) / rect.height) * bboxH };
  };

  const startMove = (e, t) => {
    if (mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    const w = t.width ?? (t.shape === "circle" ? DEFAULT_CIRCLE.width : DEFAULT_RECT.width);
    const h = t.height ?? (t.shape === "circle" ? DEFAULT_CIRCLE.height : DEFAULT_RECT.height);
    setDrag({ id: t.id, kind: "move", x: t.pos_x ?? 40, y: t.pos_y ?? 40, w, h });
    const move = (ev) => {
      const { x, y } = toCanvas(ev.clientX, ev.clientY);
      setDrag((d) => d && ({ ...d, x: Math.max(0, x - d.w / 2), y: Math.max(0, y - d.h / 2) }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag((d) => { if (d) onMove(t, Math.round(d.x), Math.round(d.y)); return null; });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (e, t) => {
    if (mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    const w = t.width ?? (t.shape === "circle" ? DEFAULT_CIRCLE.width : DEFAULT_RECT.width);
    const h = t.height ?? (t.shape === "circle" ? DEFAULT_CIRCLE.height : DEFAULT_RECT.height);
    const x = t.pos_x ?? 40, y = t.pos_y ?? 40;
    setDrag({ id: t.id, kind: "resize", x, y, w, h });
    const move = (ev) => {
      const { x: cx, y: cy } = toCanvas(ev.clientX, ev.clientY);
      let nw = Math.max(MIN_SIZE, cx - x);
      let nh = Math.max(MIN_SIZE, cy - y);
      if (t.shape === "circle") nw = nh = Math.max(nw, nh);
      setDrag((d) => d && ({ ...d, w: nw, h: nh }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag((d) => { if (d) onResize(t, Math.round(d.w), Math.round(d.h)); return null; });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div ref={ref} data-testid={`floorplan-${hall}`}
      className={`relative rounded-2xl border select-none overflow-hidden ${fit === "height" ? "h-full max-w-full" : "w-full"}`}
      style={{
        aspectRatio: `${bboxW} / ${bboxH}`,
        ...(fit === "height" ? { width: "auto" } : {}),
        borderColor: "var(--border)",
        background: dark
          ? "radial-gradient(ellipse at 50% 0%, #1c1c1c 0%, #0e0e0e 70%)"
          : "radial-gradient(ellipse at 50% 0%, var(--surface-2) 0%, var(--surface) 70%)",
        backgroundImage: `${dark ? "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)" : "radial-gradient(var(--border) 1px, transparent 1px)"}`,
        backgroundSize: "26px 26px",
        boxShadow: "inset 0 0 60px rgba(0,0,0,0.15)",
      }}>
      {tables.map((t) => {
        const isDrag = drag?.id === t.id;
        const w = isDrag ? drag.w : (t.width ?? (t.shape === "circle" ? DEFAULT_CIRCLE.width : DEFAULT_RECT.width));
        const h = isDrag ? drag.h : (t.height ?? (t.shape === "circle" ? DEFAULT_CIRCLE.height : DEFAULT_RECT.height));
        const x = isDrag ? drag.x : (t.pos_x ?? 40);
        const y = isDrag ? drag.y : (t.pos_y ?? 40);
        const isCircle = t.shape === "circle";
        const occupied = !!t.open_order;
        const mine = mode === "select" && occupied && (isMine ? isMine(t) : true);
        const others = mode === "select" && occupied && !mine;

        let stateClasses;
        if (t.is_service) {
          stateClasses = occupied ? palette.serviceOccupied : palette.serviceFree;
        } else if (others) {
          stateClasses = palette.others;
        } else if (mine || (mode === "edit" && occupied)) {
          stateClasses = palette.mine;
        } else {
          stateClasses = palette.free;
        }

        return (
          <div key={t.id}
            onMouseDown={(e) => mode === "edit" ? startMove(e, t) : undefined}
            onClick={() => mode === "select" && onSelect && onSelect(t)}
            data-testid={`floor-table-${t.id}`}
            className={`group absolute flex flex-col items-center justify-center border-[1.5px] px-1 text-center transition-shadow ${
              isCircle ? "rounded-full" : "rounded-lg"
            } ${stateClasses} ${mode === "edit" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer active:scale-95"} ${mode === "select" ? "transition-transform" : ""}`}
            style={{
              left: `${(x / bboxW) * 100}%`, top: `${(y / bboxH) * 100}%`,
              width: `${(w / bboxW) * 100}%`, height: `${(h / bboxH) * 100}%`,
              transition: isDrag ? "none" : "left .15s ease, top .15s ease",
              boxShadow: occupied ? "0 0 0 1px currentColor inset" : "0 1px 3px rgba(0,0,0,0.2)",
            }}>
            {mode === "edit" && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(t.id); }} data-testid={`del-floor-table-${t.id}`}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[var(--danger)] text-white items-center justify-center hidden group-hover:flex z-10">
                <Trash2 size={11} />
              </button>
            )}
            {t.is_service && (
              <Tag size={10} className="absolute top-1.5 left-1.5 text-[var(--ink-faint)]" />
            )}
            <div className={`font-head font-bold leading-tight ${t.is_service ? "text-[11px] text-[var(--ink-dim)]" : "text-sm"}`}>{t.name}</div>
            {renderExtra && renderExtra(t)}
            {mode === "edit" && (
              <div onMouseDown={(e) => startResize(e, t)} data-testid={`resize-floor-table-${t.id}`}
                className="absolute bottom-0.5 right-0.5 w-3 h-3 cursor-nwse-resize opacity-0 group-hover:opacity-60 hover:!opacity-100"
                style={{ background: "linear-gradient(135deg, transparent 50%, var(--ink-dim) 50%)", borderRadius: "0 0 4px 0" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function hallsOf(tables) {
  return [...new Set(tables.map((t) => t.hall))];
}
