import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, ShieldCheck, User } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const roleLabel = { admin: "Администратор", waiter: "Официант", cashier: "Кассир" };
const roleColor = { admin: "#FF5A00", waiter: "#00E5FF", cashier: "#00E676" };

export default function Staff() {
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery({ queryKey: ["staff"], queryFn: async () => (await api.get("/staff")).data });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ role: "waiter" });

  const save = async () => {
    try {
      await api.post("/staff", form);
      toast.success("Сотрудник добавлен");
      setOpen(false); setForm({ role: "waiter" });
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => {
    try {
      await api.delete(`/staff/${id}`);
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  return (
    <div>
      <PageHead title="Сотрудники" subtitle="Роли и доступ. Официанты/кассиры входят по PIN"
        action={<Btn onClick={() => { setForm({ role: "waiter" }); setOpen(true); }} data-testid="add-staff-btn"><Plus size={16} className="inline mr-1" /> Добавить</Btn>} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map((s) => (
          <div key={s.id} className="bg-[#121212] border border-[#27272A] rounded-xl p-5 flex items-center justify-between" data-testid={`staff-${s.id}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${roleColor[s.role]}22`, color: roleColor[s.role] }}>
                {s.role === "admin" ? <ShieldCheck size={20} /> : <User size={20} />}
              </div>
              <div>
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-[#A1A1AA]">{roleLabel[s.role]}{s.pin ? ` · PIN ${s.pin}` : ""}{s.email ? ` · ${s.email}` : ""}</div>
              </div>
            </div>
            <button onClick={() => del(s.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-staff-${s.id}`}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Новый сотрудник">
        <div className="space-y-4">
          <Field label="Имя" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="staff-name-input" />
          <SelectField label="Роль" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={[{ value: "waiter", label: "Официант" }, { value: "cashier", label: "Кассир" }, { value: "admin", label: "Администратор" }]} />
          {form.role === "admin" ? (
            <>
              <Field label="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="staff-email-input" />
              <Field label="Пароль" type="password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="staff-pass-input" />
            </>
          ) : (
            <Field label="PIN-код (4-6 цифр)" value={form.pin || ""} onChange={(e) => setForm({ ...form, pin: e.target.value })} data-testid="staff-pin-input" />
          )}
          <Btn onClick={save} className="w-full" data-testid="save-staff-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
