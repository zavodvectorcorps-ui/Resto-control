import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function Loyalty() {
  const qc = useQueryClient();
  const { data: groups = [] } = useQuery({ queryKey: ["loyalty-groups"], queryFn: async () => (await api.get("/loyalty-groups")).data });
  const { data: promos = [] } = useQuery({ queryKey: ["promotions"], queryFn: async () => (await api.get("/promotions")).data });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data });

  const [tab, setTab] = useState("groups");
  const [gModal, setGModal] = useState(false);
  const [gForm, setGForm] = useState({});
  const [pModal, setPModal] = useState(false);
  const [pForm, setPForm] = useState({});
  const [maxBonus, setMaxBonus] = useState(50);
  const [scPct, setScPct] = useState(0);
  const [scDefault, setScDefault] = useState(false);
  useEffect(() => {
    if (settings?.max_bonus_payment_percent != null) setMaxBonus(settings.max_bonus_payment_percent);
    if (settings?.service_charge_percent != null) setScPct(settings.service_charge_percent);
    if (settings?.service_charge_default_enabled != null) setScDefault(settings.service_charge_default_enabled);
  }, [settings]);

  const refresh = (k) => qc.invalidateQueries({ queryKey: [k] });

  const saveGroup = async () => {
    try {
      const body = { name: gForm.name, type: gForm.type || "bonus", value_percent: Number(gForm.value_percent || 0) };
      if (gForm.id) await api.put(`/loyalty-groups/${gForm.id}`, body); else await api.post("/loyalty-groups", body);
      toast.success("Сохранено"); setGModal(false); setGForm({}); refresh("loyalty-groups");
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delGroup = async (id) => { try { await api.delete(`/loyalty-groups/${id}`); refresh("loyalty-groups"); } catch (e) { toast.error(apiErr(e)); } };

  const savePromo = async () => {
    try {
      const body = {
        name: pForm.name, active: pForm.active !== false, weekdays: pForm.weekdays || [],
        time_from: pForm.time_from || null, time_to: pForm.time_to || null,
        result_type: pForm.result_type || "discount_percent", result_value: Number(pForm.result_value || 0),
        auto_apply: pForm.auto_apply !== false, stackable: !!pForm.stackable, condition_items: [],
      };
      if (pForm.id) await api.put(`/promotions/${pForm.id}`, body); else await api.post("/promotions", body);
      toast.success("Сохранено"); setPModal(false); setPForm({}); refresh("promotions");
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delPromo = async (id) => { try { await api.delete(`/promotions/${id}`); refresh("promotions"); } catch (e) { toast.error(apiErr(e)); } };

  const saveMaxBonus = async () => {
    try { await api.put("/settings/receipt", { max_bonus_payment_percent: Number(maxBonus) }); toast.success("Лимит сохранён"); refresh("settings"); }
    catch (e) { toast.error(apiErr(e)); }
  };
  const saveServiceCharge = async () => {
    try { await api.put("/settings/service-charge", { service_charge_percent: Number(scPct), service_charge_default_enabled: scDefault }); toast.success("Сервисный сбор сохранён"); refresh("settings"); }
    catch (e) { toast.error(apiErr(e)); }
  };
  const toggleWd = (d) => setPForm((f) => { const w = f.weekdays || []; return { ...f, weekdays: w.includes(d) ? w.filter((x) => x !== d) : [...w, d] }; });

  return (
    <div>
      <PageHead title="Лояльность" subtitle="Бонусные группы, акции и лимит оплаты бонусами" />
      <div className="flex gap-2 mb-6">
        {[["groups", "Группы"], ["promos", "Акции"], ["settings", "Настройки"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`loyalty-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>{l}</button>
        ))}
      </div>

      {tab === "groups" && (
        <div>
          <div className="flex justify-end mb-4"><Btn onClick={() => { setGForm({ type: "bonus" }); setGModal(true); }} data-testid="add-lgroup-btn"><Plus size={16} className="inline mr-1" /> Группа</Btn></div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]"><th className="text-left p-4">Название</th><th className="text-left p-4">Тип</th><th className="text-right p-4">%</th><th className="p-4"></th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b border-[var(--surface-2)]" data-testid={`lgroup-row-${g.id}`}>
                    <td className="p-4 font-medium">{g.name}</td>
                    <td className="p-4 text-[var(--ink-dim)]">{g.type === "bonus" ? "Бонусы (кэшбэк)" : "Скидка"}</td>
                    <td className="p-4 text-right tabnum text-[var(--accent)]">{g.value_percent}%</td>
                    <td className="p-4"><div className="flex gap-2 justify-end">
                      <button onClick={() => { setGForm(g); setGModal(true); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid={`edit-lgroup-${g.id}`}><Pencil size={16} /></button>
                      <button onClick={() => delGroup(g.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-lgroup-${g.id}`}><Trash2 size={16} /></button>
                    </div></td>
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[var(--ink-faint)]">Групп нет</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "promos" && (
        <div>
          <div className="flex justify-end mb-4"><Btn onClick={() => { setPForm({ result_type: "discount_percent", auto_apply: true, active: true, weekdays: [] }); setPModal(true); }} data-testid="add-promo-btn"><Plus size={16} className="inline mr-1" /> Акция</Btn></div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]"><th className="text-left p-4">Акция</th><th className="text-left p-4">Окно</th><th className="text-left p-4">Результат</th><th className="text-center p-4">Статус</th><th className="p-4"></th></tr></thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--surface-2)]" data-testid={`promo-adm-${p.id}`}>
                    <td className="p-4 font-medium">{p.name}</td>
                    <td className="p-4 text-[var(--ink-dim)] text-xs">{p.weekdays?.length ? p.weekdays.map((d) => WEEKDAYS[d]).join(",") : "все дни"} {p.time_from || "00:00"}–{p.time_to || "24:00"}</td>
                    <td className="p-4 text-[var(--ink-dim)]">{p.result_type === "discount_percent" ? `−${p.result_value}%` : p.result_type}</td>
                    <td className="p-4 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--border)] text-[var(--ink-faint)]"}`}>{p.active ? "активна" : "выкл"}</span></td>
                    <td className="p-4"><div className="flex gap-2 justify-end">
                      <button onClick={() => { setPForm(p); setPModal(true); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid={`edit-promo-${p.id}`}><Pencil size={16} /></button>
                      <button onClick={() => delPromo(p.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-promo-${p.id}`}><Trash2 size={16} /></button>
                    </div></td>
                  </tr>
                ))}
                {promos.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Акций нет</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="max-w-md space-y-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4">
            <Field label="Макс. оплата бонусами (% от чека)" type="number" value={maxBonus} onChange={(e) => setMaxBonus(e.target.value)} data-testid="max-bonus-input" />
            <Btn onClick={saveMaxBonus} data-testid="save-max-bonus-btn">Сохранить лимит</Btn>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4">
            <h3 className="font-head font-bold">Сервисный сбор</h3>
            <Field label="Процент, %" type="number" value={scPct} onChange={(e) => setScPct(e.target.value)} data-testid="sc-percent-input" />
            <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)] cursor-pointer">
              <input type="checkbox" checked={scDefault} onChange={(e) => setScDefault(e.target.checked)} className="accent-[var(--accent)] w-4 h-4" data-testid="sc-default-check" />
              Включать по умолчанию на новых заказах
            </label>
            <Btn onClick={saveServiceCharge} data-testid="save-sc-btn">Сохранить сервисный сбор</Btn>
          </div>
        </div>
      )}

      <Modal open={gModal} onClose={() => setGModal(false)} title={gForm.id ? "Изменить группу" : "Новая группа лояльности"}>
        <div className="space-y-4">
          <Field label="Название" value={gForm.name || ""} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} data-testid="lgroup-name-input" />
          <SelectField label="Тип" value={gForm.type || "bonus"} onChange={(e) => setGForm({ ...gForm, type: e.target.value })}
            options={[{ value: "bonus", label: "Бонусы (кэшбэк)" }, { value: "discount", label: "Постоянная скидка" }]} data-testid="lgroup-type-select" />
          <Field label={gForm.type === "discount" ? "Скидка, %" : "Кэшбэк, %"} type="number" value={gForm.value_percent ?? 0} onChange={(e) => setGForm({ ...gForm, value_percent: e.target.value })} data-testid="lgroup-value-input" />
          <Btn onClick={saveGroup} className="w-full" data-testid="save-lgroup-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={pModal} onClose={() => setPModal(false)} title={pForm.id ? "Изменить акцию" : "Новая акция"}>
        <div className="space-y-4">
          <Field label="Название" value={pForm.name || ""} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} data-testid="promo-name-input" />
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Дни недели (пусто = все)</label>
            <div className="flex gap-1.5">
              {WEEKDAYS.map((w, d) => (
                <button key={d} type="button" onClick={() => toggleWd(d)} data-testid={`promo-wd-${d}`}
                  className={`w-9 h-9 rounded-lg text-xs font-semibold ${(pForm.weekdays || []).includes(d) ? "bg-[var(--accent)] text-white" : "bg-[var(--bg)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>{w}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Время с" value={pForm.time_from || ""} onChange={(e) => setPForm({ ...pForm, time_from: e.target.value })} placeholder="14:00" data-testid="promo-timefrom-input" />
            <Field label="Время по" value={pForm.time_to || ""} onChange={(e) => setPForm({ ...pForm, time_to: e.target.value })} placeholder="17:00" data-testid="promo-timeto-input" />
          </div>
          <SelectField label="Результат" value={pForm.result_type || "discount_percent"} onChange={(e) => setPForm({ ...pForm, result_type: e.target.value })}
            options={[{ value: "discount_percent", label: "Скидка %" }, { value: "free_item", label: "Бесплатное блюдо" }, { value: "bonus_item", label: "Бонусное блюдо" }]} data-testid="promo-resulttype-select" />
          <Field label={pForm.result_type === "discount_percent" ? "Скидка, %" : "Значение"} type="number" value={pForm.result_value ?? 0} onChange={(e) => setPForm({ ...pForm, result_value: e.target.value })} data-testid="promo-resultvalue-input" />
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)]"><input type="checkbox" checked={pForm.auto_apply !== false} onChange={(e) => setPForm({ ...pForm, auto_apply: e.target.checked })} className="accent-[var(--accent)] w-4 h-4" data-testid="promo-autoapply-check" /> Авто-применение</label>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)]"><input type="checkbox" checked={pForm.active !== false} onChange={(e) => setPForm({ ...pForm, active: e.target.checked })} className="accent-[var(--accent)] w-4 h-4" data-testid="promo-active-check" /> Активна</label>
          </div>
          <Btn onClick={savePromo} className="w-full" data-testid="save-promo-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
