import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, CreditCard, MessageSquare } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const CTX_LABEL = { dish: "К блюду", order: "К заказу", cancel: "Отмена/сторно" };

export default function Settings() {
  const qc = useQueryClient();
  const { data: methods = [] } = useQuery({ queryKey: ["payment-methods"], queryFn: async () => (await api.get("/payment-methods")).data });
  const { data: comments = [] } = useQuery({ queryKey: ["quick-comments"], queryFn: async () => (await api.get("/quick-comments")).data });

  const [pmModal, setPmModal] = useState(false);
  const [pmForm, setPmForm] = useState({});
  const [qcModal, setQcModal] = useState(false);
  const [qcForm, setQcForm] = useState({ context: "dish" });

  const savePm = async () => {
    try {
      const body = { name: pmForm.name, code: pmForm.code, is_debt: !!pmForm.is_debt, active: pmForm.active ?? true, position: Number(pmForm.position || 0) };
      if (!body.name || !body.code) { toast.error("Заполните название и код"); return; }
      if (pmForm.id) await api.put(`/payment-methods/${pmForm.id}`, body);
      else await api.post("/payment-methods", body);
      toast.success("Сохранено"); setPmModal(false); setPmForm({});
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delPm = async (id) => { try { await api.delete(`/payment-methods/${id}`); qc.invalidateQueries({ queryKey: ["payment-methods"] }); } catch (e) { toast.error(apiErr(e)); } };

  const saveQc = async () => {
    try {
      if (!qcForm.text?.trim()) { toast.error("Введите текст"); return; }
      const body = { text: qcForm.text.trim(), context: qcForm.context || "dish" };
      if (qcForm.id) await api.put(`/quick-comments/${qcForm.id}`, body);
      else await api.post("/quick-comments", body);
      toast.success("Сохранено"); setQcModal(false); setQcForm({ context: "dish" });
      qc.invalidateQueries({ queryKey: ["quick-comments"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delQc = async (id) => { try { await api.delete(`/quick-comments/${id}`); qc.invalidateQueries({ queryKey: ["quick-comments"] }); } catch (e) { toast.error(apiErr(e)); } };

  return (
    <div>
      <PageHead title="Справочники" subtitle="Способы оплаты и быстрые комментарии для кассы" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment methods */}
        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold flex items-center gap-2"><CreditCard size={18} /> Способы оплаты</h3>
            <Btn variant="ghost" onClick={() => { setPmForm({ active: true }); setPmModal(true); }} data-testid="add-pm-btn"><Plus size={16} /></Btn>
          </div>
          <div className="space-y-2">
            {methods.map((m) => (
              <div key={m.id} className="flex items-center justify-between bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3" data-testid={`pm-row-${m.id}`}>
                <div>
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-2 text-xs text-[#52525B]">code: {m.code}</span>
                  {m.is_debt && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#FF3B3011] text-[#FF3B30] font-bold">В ДОЛГ</span>}
                  {!m.active && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#27272A] text-[#A1A1AA] font-bold">выкл</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setPmForm(m); setPmModal(true); }} className="text-[#A1A1AA] hover:text-white text-xs font-semibold" data-testid={`edit-pm-${m.id}`}>изм.</button>
                  <button onClick={() => delPm(m.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-pm-${m.id}`}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            {methods.length === 0 && <p className="text-sm text-[#52525B]">Способов оплаты нет</p>}
          </div>
        </div>

        {/* Quick comments */}
        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold flex items-center gap-2"><MessageSquare size={18} /> Быстрые комментарии</h3>
            <Btn variant="ghost" onClick={() => { setQcForm({ context: "dish" }); setQcModal(true); }} data-testid="add-qc-btn"><Plus size={16} /></Btn>
          </div>
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3" data-testid={`qc-row-${c.id}`}>
                <div>
                  <span className="font-medium">{c.text}</span>
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#A855F711] text-[#A855F7] font-bold">{CTX_LABEL[c.context] || c.context}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setQcForm(c); setQcModal(true); }} className="text-[#A1A1AA] hover:text-white text-xs font-semibold" data-testid={`edit-qc-${c.id}`}>изм.</button>
                  <button onClick={() => delQc(c.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-qc-${c.id}`}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            {comments.length === 0 && <p className="text-sm text-[#52525B]">Комментариев нет</p>}
          </div>
        </div>
      </div>

      <Modal open={pmModal} onClose={() => setPmModal(false)} title={pmForm.id ? "Изменить способ оплаты" : "Новый способ оплаты"}>
        <div className="space-y-4">
          <Field label="Название" value={pmForm.name || ""} onChange={(e) => setPmForm({ ...pmForm, name: e.target.value })} data-testid="pm-name-input" />
          <Field label="Код (латиницей, напр. transfer)" value={pmForm.code || ""} onChange={(e) => setPmForm({ ...pmForm, code: e.target.value })} data-testid="pm-code-input" />
          <label className="flex items-center justify-between bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3 cursor-pointer">
            <span className="text-sm">Оплата «в долг» (записывается на клиента)</span>
            <input type="checkbox" checked={!!pmForm.is_debt} onChange={(e) => setPmForm({ ...pmForm, is_debt: e.target.checked })} className="accent-[#FF5A00] w-4 h-4" data-testid="pm-debt-toggle" />
          </label>
          <label className="flex items-center justify-between bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3 cursor-pointer">
            <span className="text-sm">Активен</span>
            <input type="checkbox" checked={pmForm.active ?? true} onChange={(e) => setPmForm({ ...pmForm, active: e.target.checked })} className="accent-[#FF5A00] w-4 h-4" data-testid="pm-active-toggle" />
          </label>
          <Btn onClick={savePm} className="w-full" data-testid="save-pm-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={qcModal} onClose={() => setQcModal(false)} title={qcForm.id ? "Изменить комментарий" : "Новый комментарий"}>
        <div className="space-y-4">
          <Field label="Текст" value={qcForm.text || ""} onChange={(e) => setQcForm({ ...qcForm, text: e.target.value })} data-testid="qc-text-input" />
          <SelectField label="Контекст" value={qcForm.context || "dish"} onChange={(e) => setQcForm({ ...qcForm, context: e.target.value })} data-testid="qc-context-select"
            options={[{ value: "dish", label: "К блюду" }, { value: "order", label: "К заказу" }, { value: "cancel", label: "Отмена/сторно" }]} />
          <Btn onClick={saveQc} className="w-full" data-testid="save-qc-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
