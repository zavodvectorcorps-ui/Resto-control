import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Grid3x3, Users } from "lucide-react";
import { PageHead, Btn, Field, Modal } from "@/components/admin/ui";

export default function Tables() {
  const qc = useQueryClient();
  const { data: tables = [] } = useQuery({ queryKey: ["tables"], queryFn: async () => (await api.get("/tables")).data });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", hall: "Основной зал", seats: 4 });

  const save = async () => {
    try {
      await api.post("/tables", { ...form, seats: Number(form.seats) });
      toast.success("Стол добавлен");
      setOpen(false);
      setForm({ name: "", hall: "Основной зал", seats: 4 });
      qc.invalidateQueries({ queryKey: ["tables"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => {
    await api.delete(`/tables/${id}`);
    qc.invalidateQueries({ queryKey: ["tables"] });
  };

  return (
    <div>
      <PageHead title="Столы" subtitle="Схема зала для официантов"
        action={<Btn onClick={() => setOpen(true)} data-testid="add-table-btn"><Plus size={16} className="inline mr-1" /> Добавить стол</Btn>} />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {tables.map((t) => (
          <div key={t.id} className={`rounded-xl p-5 border relative ${t.open_order ? "border-[#FF5A00] bg-[#1A1206]" : "border-[#27272A] bg-[#121212]"}`} data-testid={`table-${t.id}`}>
            <button onClick={() => del(t.id)} className="absolute top-2 right-2 text-[#52525B] hover:text-[#FF3B30]" data-testid={`del-table-${t.id}`}><Trash2 size={14} /></button>
            <Grid3x3 size={20} className="text-[#A1A1AA] mb-2" />
            <div className="font-head font-bold">{t.name}</div>
            <div className="flex items-center gap-1 text-xs text-[#A1A1AA] mt-1"><Users size={12} /> {t.seats}</div>
            {t.open_order && <div className="text-xs text-[#FF5A00] font-semibold mt-2">Занят</div>}
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Новый стол">
        <div className="space-y-4">
          <Field label="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="table-name-input" />
          <Field label="Зал" value={form.hall} onChange={(e) => setForm({ ...form, hall: e.target.value })} />
          <Field label="Мест" type="number" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
          <Btn onClick={save} className="w-full" data-testid="save-table-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
