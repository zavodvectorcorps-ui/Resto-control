import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Factory } from "lucide-react";
import { PageHead, Btn, Field, Modal } from "@/components/admin/ui";

const COLORS = ["var(--accent)", "var(--info)", "var(--success)", "var(--danger)", "var(--purple)", "var(--warning)"];

export default function Workshops() {
  const qc = useQueryClient();
  const { data: workshops = [] } = useQuery({ queryKey: ["workshops"], queryFn: async () => (await api.get("/workshops")).data });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", color: "var(--accent)" });

  const save = async () => {
    try {
      await api.post("/workshops", form);
      toast.success("Цех добавлен");
      setOpen(false);
      setForm({ name: "", color: "var(--accent)" });
      qc.invalidateQueries({ queryKey: ["workshops"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => {
    await api.delete(`/workshops/${id}`);
    qc.invalidateQueries({ queryKey: ["workshops"] });
  };

  return (
    <div>
      <PageHead title="Цеха" subtitle="Точки приготовления — кухня, бар и др. Заказы маршрутизируются по цехам"
        action={<Btn onClick={() => setOpen(true)} data-testid="add-workshop-btn"><Plus size={16} className="inline mr-1" /> Добавить цех</Btn>} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {workshops.map((w) => (
          <div key={w.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 flex items-center justify-between" data-testid={`workshop-${w.id}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${w.color}22`, color: w.color }}>
                <Factory size={20} />
              </div>
              <span className="font-semibold">{w.name}</span>
            </div>
            <button onClick={() => del(w.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-workshop-${w.id}`}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Новый цех">
        <div className="space-y-4">
          <Field label="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="workshop-name-input" />
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">Цвет</label>
            <div className="flex gap-2 mt-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setForm({ ...form, color: c })}
                  className={`w-8 h-8 rounded-lg transition-transform ${form.color === c ? "scale-110 ring-2 ring-white" : ""}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <Btn onClick={save} className="w-full" data-testid="save-workshop-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
