import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Grid3x3, Users, List, Map, Tag } from "lucide-react";
import { PageHead, Btn, Field, Modal } from "@/components/admin/ui";
import { FloorPlan, hallsOf, DEFAULT_RECT, DEFAULT_CIRCLE } from "@/components/admin/FloorPlan";

export default function Tables() {
  const qc = useQueryClient();
  const { data: tables = [] } = useQuery({ queryKey: ["tables"], queryFn: async () => (await api.get("/tables")).data });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("map"); // map | list
  const [form, setForm] = useState({ name: "", hall: "Основной", seats: 4, shape: "rect", is_service: false });

  const save = async () => {
    try {
      await api.post("/tables", { ...form, seats: Number(form.seats) });
      toast.success(form.is_service ? "Служебный стол добавлен" : "Стол добавлен");
      setOpen(false);
      setForm({ name: "", hall: "Основной", seats: 4, shape: "rect", is_service: false });
      qc.invalidateQueries({ queryKey: ["tables"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => {
    await api.delete(`/tables/${id}`);
    qc.invalidateQueries({ queryKey: ["tables"] });
  };
  const putFull = async (t, patch) => {
    try {
      await api.put(`/tables/${t.id}`, {
        name: t.name, hall: t.hall, seats: t.seats, shape: t.shape || "rect", is_service: !!t.is_service,
        pos_x: t.pos_x, pos_y: t.pos_y, width: t.width, height: t.height,
        ...patch,
      });
      qc.invalidateQueries({ queryKey: ["tables"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const move = (t, pos_x, pos_y) => putFull(t, { pos_x, pos_y });
  const resize = (t, width, height) => putFull(t, { width, height });

  const halls = hallsOf(tables);

  return (
    <div>
      <PageHead title="Столы" subtitle="Схема зала для официантов"
        action={
          <div className="flex items-center gap-2">
            <div className="flex bg-[var(--surface)] border border-[var(--border)] rounded-lg p-1">
              <button onClick={() => setView("map")} data-testid="view-map-btn"
                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${view === "map" ? "bg-[var(--accent)] text-white" : "text-[var(--ink-dim)] hover:text-[var(--ink)]"}`}>
                <Map size={14} /> Карта зала
              </button>
              <button onClick={() => setView("list")} data-testid="view-list-btn"
                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-[var(--accent)] text-white" : "text-[var(--ink-dim)] hover:text-[var(--ink)]"}`}>
                <List size={14} /> Список
              </button>
            </div>
            <Btn onClick={() => setOpen(true)} data-testid="add-table-btn"><Plus size={16} /> Добавить стол</Btn>
          </div>
        } />

      {view === "list" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {tables.map((t) => (
            <div key={t.id}
              className={`rounded-xl p-5 border relative ${
                t.is_service ? "border-dashed border-[var(--border)] bg-transparent" :
                t.open_order ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
              }`} data-testid={`table-${t.id}`}>
              <button onClick={() => del(t.id)} className="absolute top-2 right-2 text-[var(--ink-faint)] hover:text-[var(--danger)]" data-testid={`del-table-${t.id}`}><Trash2 size={14} /></button>
              {t.is_service ? <Tag size={20} className="text-[var(--ink-faint)] mb-2" /> : <Grid3x3 size={20} className="text-[var(--ink-dim)] mb-2" />}
              <div className="font-head font-bold">{t.name}</div>
              <div className="text-xs text-[var(--ink-faint)] mt-0.5">{t.hall}</div>
              {t.is_service ? (
                <div className="text-xs text-[var(--ink-faint)] mt-1">Служебный</div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-[var(--ink-dim)] mt-1"><Users size={12} /> {t.seats}</div>
              )}
              {t.open_order && <div className="text-xs text-[var(--accent)] font-semibold mt-2">Занят</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {halls.length === 0 && (
            <p className="text-[var(--ink-faint)]">Пока нет столов. Добавьте первый стол.</p>
          )}
          {halls.map((hall) => (
            <div key={hall}>
              <h3 className="font-head text-lg font-bold mb-3">{hall}</h3>
              <FloorPlan hall={hall} tables={tables.filter((t) => t.hall === hall)} mode="edit"
                onMove={move} onResize={resize} onDelete={del} />
            </div>
          ))}
          <p className="text-xs text-[var(--ink-faint)] flex items-center gap-1.5">
            <Tag size={12} /> Пунктиром отмечены служебные столы (учредители, партнёры, списания) — не показываются гостям, но заказы по ним учитываются в отчётах.
          </p>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Новый стол">
        <div className="space-y-4">
          <Field label="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="table-name-input" />
          <Field label="Зал" value={form.hall} onChange={(e) => setForm({ ...form, hall: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)]">
            <input type="checkbox" checked={form.is_service} data-testid="table-service-checkbox"
              onChange={(e) => setForm({ ...form, is_service: e.target.checked, seats: e.target.checked ? 0 : (form.seats || 4) })}
              className="rounded border-[var(--border)]" />
            Служебный стол (не для гостей — учредители, партнёры, списания)
          </label>
          {!form.is_service && (
            <Field label="Мест" type="number" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
          )}
          <div>
            <label className="text-xs uppercase tracking-[0.1em] text-[var(--ink-faint)] mb-1.5 block">Форма</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm({ ...form, shape: "rect" })}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium ${form.shape === "rect" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--ink-dim)]"}`}>Прямоугольный</button>
              <button type="button" onClick={() => setForm({ ...form, shape: "circle" })}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium ${form.shape === "circle" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--ink-dim)]"}`}>Круглый</button>
            </div>
          </div>
          <p className="text-xs text-[var(--ink-faint)]">Новый стол появится в углу карты зала — перетащите его на нужное место, потяните за уголок, чтобы изменить размер.</p>
          <Btn onClick={save} className="w-full" data-testid="save-table-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
