import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, CalendarClock } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const today = () => new Date().toISOString().slice(0, 10);
const STATUS = { pending: ["Ожидает", "#FFB020"], confirmed: ["Подтверждена", "#00E5FF"], seated: ["Гость за столом", "#00E676"], cancelled: ["Отменена", "#FF3B30"], done: ["Завершена", "#52525B"] };

export default function Reservations() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const { data: list = [] } = useQuery({ queryKey: ["reservations", date], queryFn: async () => (await api.get(`/reservations?date=${date}`)).data });
  const { data: tables = [] } = useQuery({ queryKey: ["tables"], queryFn: async () => (await api.get("/tables")).data });
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});

  const refresh = () => qc.invalidateQueries({ queryKey: ["reservations"] });
  const save = async () => {
    try {
      await api.post("/reservations", { table_id: form.table_id || null, date: form.date || date, time_from: form.time_from, time_to: form.time_to || null, guest_name: form.guest_name, guest_phone: form.guest_phone || "", guests_count: Number(form.guests_count || 1), deposit_amount: Number(form.deposit_amount || 0) });
      toast.success("Бронь создана"); setModal(false); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const setStatus = async (id, status) => { try { await api.patch(`/reservations/${id}`, { status }); refresh(); } catch (e) { toast.error(apiErr(e)); } };
  const del = async (id) => { try { await api.delete(`/reservations/${id}`); refresh(); } catch (e) { toast.error(apiErr(e)); } };

  return (
    <div>
      <PageHead title="Резервы" subtitle="Бронирование столов и депозиты"
        action={<Btn onClick={() => { setForm({ date, guests_count: 1 }); setModal(true); }} data-testid="add-reservation-btn"><Plus size={16} className="inline mr-1" /> Бронь</Btn>} />
      <div className="mb-6">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="reservation-date-filter"
          className="bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
      </div>
      <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
            <th className="text-left p-4">Время</th><th className="text-left p-4">Гость</th><th className="text-left p-4">Стол</th><th className="text-right p-4">Гостей</th><th className="text-right p-4">Депозит</th><th className="text-left p-4">Статус</th><th className="p-4"></th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b border-[#1A1A1A]" data-testid={`reservation-row-${r.id}`}>
                <td className="p-4 tabnum"><CalendarClock size={13} className="inline mr-1 text-[#FF5A00]" />{r.time_from}{r.time_to ? `–${r.time_to}` : ""}</td>
                <td className="p-4 font-medium">{r.guest_name}<div className="text-xs text-[#52525B]">{r.guest_phone}</div></td>
                <td className="p-4 text-[#A1A1AA]">{tables.find((t) => t.id === r.table_id)?.name || r.hall || "—"}</td>
                <td className="p-4 text-right tabnum">{r.guests_count}</td>
                <td className="p-4 text-right tabnum text-[#00E676]">{Number(r.deposit_amount || 0).toFixed(2)} ₽</td>
                <td className="p-4">
                  <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} data-testid={`reservation-status-${r.id}`}
                    className="bg-[#0A0A0A] border border-[#27272A] rounded-lg px-2 py-1 text-xs outline-none" style={{ color: STATUS[r.status]?.[1] }}>
                    {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
                  </select>
                </td>
                <td className="p-4 text-right"><button onClick={() => del(r.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-reservation-${r.id}`}><Trash2 size={16} /></button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-[#52525B]">Броней на эту дату нет</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Новая бронь">
        <div className="space-y-4">
          <Field label="Имя гостя" value={form.guest_name || ""} onChange={(e) => setForm({ ...form, guest_name: e.target.value })} data-testid="reservation-name-input" />
          <Field label="Телефон" value={form.guest_phone || ""} onChange={(e) => setForm({ ...form, guest_phone: e.target.value })} data-testid="reservation-phone-input" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Дата" type="date" value={form.date || date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="reservation-date-input" />
            <Field label="Время с" value={form.time_from || ""} onChange={(e) => setForm({ ...form, time_from: e.target.value })} placeholder="19:00" data-testid="reservation-timefrom-input" />
          </div>
          <SelectField label="Стол" value={form.table_id || ""} onChange={(e) => setForm({ ...form, table_id: e.target.value })}
            options={[{ value: "", label: "— любой —" }, ...tables.map((t) => ({ value: t.id, label: `${t.name}${t.hall ? ` (${t.hall})` : ""}` }))]} data-testid="reservation-table-select" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Гостей" type="number" value={form.guests_count ?? 1} onChange={(e) => setForm({ ...form, guests_count: e.target.value })} data-testid="reservation-guests-input" />
            <Field label="Депозит, ₽" type="number" value={form.deposit_amount ?? 0} onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })} data-testid="reservation-deposit-input" />
          </div>
          <Btn onClick={save} className="w-full" data-testid="save-reservation-btn">Создать бронь</Btn>
        </div>
      </Modal>
    </div>
  );
}
