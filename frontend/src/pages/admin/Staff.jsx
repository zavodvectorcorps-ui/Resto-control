import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, ShieldCheck, User, Pencil, Percent } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const roleLabel = { manager: "Менеджер", admin: "Администратор", waiter: "Официант" };
const roleColor = { manager: "var(--accent)", admin: "var(--success)", waiter: "var(--info)" };
const modeLabel = { personal: "по личным продажам", shift: "поровну на смену" };

export default function Staff() {
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery({ queryKey: ["staff"], queryFn: async () => (await api.get("/staff")).data });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ role: "waiter" });

  const openNew = () => setForm({ role: "waiter", commission_mode: "personal", commission_rates: [] });
  const openEdit = (s) => setForm({
    id: s.id, name: s.name, role: s.role, pin: s.pin || "", email: s.email || "",
    commission_mode: s.commission_mode || "personal",
    commission_rates: (s.commission_rates || []).map((r) => ({ ...r })),
  });

  const save = async () => {
    try {
      const body = {
        name: form.name, role: form.role, pin: form.pin || undefined,
        email: form.email || undefined, password: form.password || undefined,
        commission_mode: form.commission_mode || "personal",
        commission_rates: (form.commission_rates || [])
          .filter((r) => Number(r.percent) > 0)
          .map((r) => ({ category_id: r.category_id || null, percent: Number(r.percent) })),
      };
      if (form.id) await api.put(`/staff/${form.id}`, body);
      else await api.post("/staff", body);
      toast.success(form.id ? "Сотрудник сохранён" : "Сотрудник добавлен");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => {
    try {
      await api.delete(`/staff/${id}`);
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  const addRate = () => {
    setForm((f) => {
      const used = new Set((f.commission_rates || []).map((r) => r.category_id || ""));
      const firstFree = categories.find((c) => !used.has(c.id));
      const category_id = !used.has("") ? null : (firstFree ? firstFree.id : null);
      return { ...f, commission_rates: [...(f.commission_rates || []), { category_id, percent: 0 }] };
    });
  };
  const updateRate = (i, patch) => {
    setForm((f) => {
      const rates = [...(f.commission_rates || [])];
      rates[i] = { ...rates[i], ...patch };
      return { ...f, commission_rates: rates };
    });
  };
  const removeRate = (i) => setForm((f) => ({ ...f, commission_rates: (f.commission_rates || []).filter((_, idx) => idx !== i) }));

  const rateSummary = (s) => (s.commission_rates || [])
    .map((r) => `${r.category_id ? (categories.find((c) => c.id === r.category_id)?.name || "?") : "по умолч."} ${r.percent}%`)
    .join(", ");

  return (
    <div>
      <PageHead title="Сотрудники" subtitle="Роли, доступ и мотивация. Официанты и администраторы входят по PIN, менеджеры — по email"
        action={<Btn onClick={() => { openNew(); setOpen(true); }} data-testid="add-staff-btn"><Plus size={16} className="inline mr-1" /> Добавить</Btn>} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map((s) => (
          <div key={s.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-center justify-between" data-testid={`staff-${s.id}`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${roleColor[s.role]}22`, color: roleColor[s.role] }}>
                {s.role === "manager" ? <ShieldCheck size={20} /> : <User size={20} />}
              </div>
              <div className="min-w-0">
                <div className="font-semibold truncate">{s.name}</div>
                <div className="text-xs text-[var(--ink-dim)] truncate">{roleLabel[s.role]}{s.pin ? ` · PIN ${s.pin}` : ""}{s.email ? ` · ${s.email}` : ""}</div>
                {(s.commission_rates || []).length > 0 && (
                  <div className="text-xs text-[var(--success)] flex items-center gap-1 mt-0.5 truncate" title={rateSummary(s)}>
                    <Percent size={11} className="shrink-0" /> {rateSummary(s)} · {modeLabel[s.commission_mode] || modeLabel.personal}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => { openEdit(s); setOpen(true); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid={`edit-staff-${s.id}`}><Pencil size={16} /></button>
              <button onClick={() => del(s.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-staff-${s.id}`}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? "Сотрудник" : "Новый сотрудник"}>
        <div className="space-y-4">
          <Field label="Имя" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="staff-name-input" />
          <SelectField label="Роль" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="staff-role-select"
            options={[{ value: "waiter", label: "Официант" }, { value: "admin", label: "Администратор (касса)" }, { value: "manager", label: "Менеджер (бэк-офис)" }]} />
          {form.role === "manager" ? (
            <>
              <Field label="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="staff-email-input" />
              <Field label="Пароль" type="password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={form.id ? "Оставьте пустым, если не меняете" : ""} data-testid="staff-pass-input" />
            </>
          ) : (
            <Field label="PIN-код (4-6 цифр)" value={form.pin || ""} onChange={(e) => setForm({ ...form, pin: e.target.value })} data-testid="staff-pin-input" />
          )}

          {form.role !== "manager" && (
            <div className="border-t border-[var(--border)] pt-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">Мотивация — % от продаж</div>
              <SelectField label="Как считать" value={form.commission_mode || "personal"}
                onChange={(e) => setForm({ ...form, commission_mode: e.target.value })} data-testid="staff-commission-mode-select"
                options={[
                  { value: "personal", label: "По личным продажам (свои заказы)" },
                  { value: "shift", label: "Поровну между всеми в смене" },
                ]} />
              <p className="text-xs text-[var(--ink-faint)]">
                {form.commission_mode === "shift"
                  ? "Общий пул продаж смены делится поровну между всеми сотрудниками с этим режимом, кто в этой смене принял хотя бы один заказ."
                  : "Считается только по заказам, которые сотрудник сам принял (открыл), независимо от того, кто их закрыл на кассе."}
              </p>

              <div className="space-y-2">
                {(form.commission_rates || []).map((r, i) => (
                  <div key={i} className="flex items-center gap-2" data-testid={`commission-rate-row-${i}`}>
                    <select value={r.category_id || ""} onChange={(e) => updateRate(i, { category_id: e.target.value || null })}
                      data-testid={`commission-rate-category-${i}`}
                      className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
                      <option value="">По умолчанию (все остальные категории)</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="number" value={r.percent} onChange={(e) => updateRate(i, { percent: e.target.value })}
                      data-testid={`commission-rate-percent-${i}`} placeholder="%"
                      className="w-20 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm text-right" />
                    <button onClick={() => removeRate(i)} className="text-[var(--ink-dim)] hover:text-[var(--danger)] shrink-0" data-testid={`remove-commission-rate-${i}`}><Trash2 size={15} /></button>
                  </div>
                ))}
                <button onClick={addRate} type="button" data-testid="add-commission-rate-btn"
                  className="text-xs font-semibold text-[var(--success)] hover:text-[var(--ink)] flex items-center gap-1">
                  <Plus size={13} /> Добавить ставку
                </button>
                {(form.commission_rates || []).length === 0 && <p className="text-xs text-[var(--ink-faint)]">Без ставок мотивация не начисляется.</p>}
              </div>
            </div>
          )}

          <Btn onClick={save} className="w-full" data-testid="save-staff-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
