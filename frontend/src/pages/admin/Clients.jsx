import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

export default function Clients() {
  const qc = useQueryClient();
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients")).data });
  const { data: lgroups = [] } = useQuery({ queryKey: ["loyalty-groups"], queryFn: async () => (await api.get("/loyalty-groups")).data });
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [bonusFor, setBonusFor] = useState(null);
  const [bonusAmt, setBonusAmt] = useState("");

  const shown = clients.filter((c) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return c.name.toLowerCase().includes(s) || (c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, ""));
  });

  const save = async () => {
    try {
      const body = { name: form.name, phone: form.phone, discount_percent: Number(form.discount_percent || 0), loyalty_group_id: form.loyalty_group_id || null };
      if (form.id) await api.put(`/clients/${form.id}`, body);
      else await api.post("/clients", body);
      toast.success("Сохранено"); setModal(false); setForm({});
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => { try { await api.delete(`/clients/${id}`); qc.invalidateQueries({ queryKey: ["clients"] }); } catch (e) { toast.error(apiErr(e)); } };
  const adjustBonus = async () => {
    try { await api.post(`/clients/${bonusFor.id}/bonus`, { amount: Number(bonusAmt || 0), note: "Ручная корректировка" }); toast.success("Баланс обновлён"); setBonusFor(null); setBonusAmt(""); qc.invalidateQueries({ queryKey: ["clients"] }); }
    catch (e) { toast.error(apiErr(e)); }
  };

  return (
    <div>
      <PageHead title="Клиенты" subtitle="Карты гостей и персональные скидки"
        action={<Btn onClick={() => { setForm({ discount_percent: 0 }); setModal(true); }} data-testid="add-client-btn"><Plus size={16} className="inline mr-1" /> Клиент</Btn>} />

      <div className="relative max-w-sm mb-6">
        <Search size={16} className="absolute left-3 top-3 text-[#52525B]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени или телефону" data-testid="client-search"
          className="w-full bg-[#0A0A0A] border border-[#27272A] rounded-lg pl-9 pr-4 py-2.5 outline-none focus:border-[#FF5A00]" />
      </div>

      <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
            <th className="text-left p-4">Имя</th><th className="text-left p-4">Телефон</th><th className="text-right p-4">Скидка</th><th className="text-right p-4">Бонусы</th><th className="text-left p-4">Группа</th><th className="p-4"></th></tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="border-b border-[#1A1A1A] hover:bg-[#161616]" data-testid={`client-row-${c.id}`}>
                <td className="p-4 font-medium">{c.name}</td>
                <td className="p-4 text-[#A1A1AA] tabnum">{c.phone}</td>
                <td className="p-4 text-right tabnum text-[#FF5A00] font-semibold">{c.discount_percent}%</td>
                <td className="p-4 text-right tabnum text-[#00E676]" data-testid={`client-bonus-${c.id}`}>{Number(c.bonus_balance || 0).toFixed(2)}</td>
                <td className="p-4 text-[#A1A1AA] text-xs">{lgroups.find((g) => g.id === c.loyalty_group_id)?.name || "—"}</td>
                <td className="p-4">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setBonusFor(c); setBonusAmt(""); }} className="text-[#00E676] hover:text-white text-xs font-semibold" data-testid={`bonus-client-${c.id}`}>± бонус</button>
                    <button onClick={() => { setForm({ id: c.id, name: c.name, phone: c.phone, discount_percent: c.discount_percent, loyalty_group_id: c.loyalty_group_id }); setModal(true); }} className="text-[#A1A1AA] hover:text-white" data-testid={`edit-client-${c.id}`}><Pencil size={16} /></button>
                    <button onClick={() => del(c.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-client-${c.id}`}><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[#52525B]">Клиентов нет</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? "Изменить клиента" : "Новый клиент"}>
        <div className="space-y-4">
          <Field label="Имя" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="client-name-input" />
          <Field label="Телефон" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="client-phone-field" />
          <Field label="Скидка, %" type="number" value={form.discount_percent ?? 0} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} data-testid="client-discount-input" />
          <SelectField label="Группа лояльности" value={form.loyalty_group_id || ""} onChange={(e) => setForm({ ...form, loyalty_group_id: e.target.value })}
            options={[{ value: "", label: "— нет —" }, ...lgroups.map((g) => ({ value: g.id, label: `${g.name} (${g.type === "bonus" ? "кэшбэк" : "скидка"} ${g.value_percent}%)` }))]} data-testid="client-lgroup-select" />
          <Btn onClick={save} className="w-full" data-testid="save-client-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={!!bonusFor} onClose={() => setBonusFor(null)} title={`Бонусы: ${bonusFor?.name || ""}`}>
        <div className="space-y-4">
          <p className="text-sm text-[#A1A1AA]">Текущий баланс: <span className="text-[#00E676] tabnum font-semibold">{Number(bonusFor?.bonus_balance || 0).toFixed(2)}</span></p>
          <Field label="Изменение (+ начислить / − списать)" type="number" value={bonusAmt} onChange={(e) => setBonusAmt(e.target.value)} data-testid="bonus-amount-input" />
          <Btn onClick={adjustBonus} className="w-full" data-testid="save-bonus-btn">Применить</Btn>
        </div>
      </Modal>
    </div>
  );
}
