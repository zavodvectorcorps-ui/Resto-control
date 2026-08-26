import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, PackageMinus, FileText } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const measureLabel = { kg: "кг", l: "л", pcs: "шт" };
const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

export default function Inventory() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ["inventory"], queryFn: async () => (await api.get("/inventory")).data });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get("/invoices")).data });
  const { data: writeoffs = [] } = useQuery({ queryKey: ["writeoffs"], queryFn: async () => (await api.get("/writeoffs")).data });

  const [tab, setTab] = useState("stock");
  const [modal, setModal] = useState(null); // item | writeoff | invoice
  const [form, setForm] = useState({});

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["writeoffs"] });
  };

  const saveItem = async () => {
    try {
      await api.post("/inventory", { name: form.name, measure: form.measure || "kg", balance: Number(form.balance || 0), cost: Number(form.cost || 0) });
      toast.success("Позиция добавлена"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delItem = async (id) => { await api.delete(`/inventory/${id}`); refresh(); };

  const saveWriteoff = async () => {
    try {
      await api.post("/writeoffs", { inventory_id: form.inventory_id || items[0]?.id, amount: Number(form.amount || 0), reason: form.reason || "Списание" });
      toast.success("Списание проведено"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const saveInvoice = async () => {
    try {
      const it = items.find((x) => x.id === (form.inventory_id || items[0]?.id));
      await api.post("/invoices", {
        number: form.number, supplier_name: form.supplier_name || "",
        items: [{ inventory_id: it.id, name: it.name, amount: Number(form.amount || 0), price: Number(form.price || 0) }],
      });
      toast.success("Накладная проведена, остаток обновлён"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  return (
    <div>
      <PageHead title="Склад" subtitle="Остатки, приходные накладные и списания"
        action={
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => { setForm({ inventory_id: items[0]?.id }); setModal("invoice"); }} data-testid="add-invoice-btn"><FileText size={16} className="inline mr-1" /> Приход</Btn>
            <Btn variant="danger" onClick={() => { setForm({ inventory_id: items[0]?.id }); setModal("writeoff"); }} data-testid="add-writeoff-btn"><PackageMinus size={16} className="inline mr-1" /> Списать</Btn>
            <Btn onClick={() => { setForm({ measure: "kg" }); setModal("item"); }} data-testid="add-inventory-btn"><Plus size={16} className="inline mr-1" /> Позиция</Btn>
          </div>
        } />

      <div className="flex gap-2 mb-6">
        {[["stock", "Остатки"], ["invoices", "Накладные"], ["writeoffs", "Списания"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`inv-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[#FF5A00] text-white" : "bg-[#121212] border border-[#27272A] text-[#A1A1AA]"}`}>{l}</button>
        ))}
      </div>

      <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          {tab === "stock" && <>
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Позиция</th><th className="text-right p-4">Остаток</th><th className="text-right p-4">Себест.</th><th className="p-4"></th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} className={`border-b border-[#1A1A1A] ${i.balance <= 0 ? "bg-[#1A0806]" : ""}`} data-testid={`inv-row-${i.id}`}>
                <td className="p-4 font-medium">{i.name}</td>
                <td className={`p-4 text-right tabnum font-semibold ${i.balance <= 0 ? "text-[#FF3B30]" : "text-white"}`}>{Number(i.balance).toFixed(2)} {measureLabel[i.measure]}</td>
                <td className="p-4 text-right tabnum text-[#A1A1AA]">{money(i.cost)}</td>
                <td className="p-4 text-right"><button onClick={() => delItem(i.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-inv-${i.id}`}><Trash2 size={16} /></button></td>
              </tr>))}</tbody>
          </>}
          {tab === "invoices" && <>
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Номер</th><th className="text-left p-4">Поставщик</th><th className="text-left p-4">Дата</th><th className="text-right p-4">Сумма</th></tr></thead>
            <tbody>{invoices.map((v) => (
              <tr key={v.id} className="border-b border-[#1A1A1A]">
                <td className="p-4 font-medium">{v.number}</td><td className="p-4 text-[#A1A1AA]">{v.supplier_name || "—"}</td>
                <td className="p-4 text-[#A1A1AA]">{(v.created_at || "").slice(0, 10)}</td>
                <td className="p-4 text-right tabnum text-[#00E676] font-semibold">{money(v.total)}</td>
              </tr>))}
              {invoices.length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[#52525B]">Нет накладных</td></tr>}</tbody>
          </>}
          {tab === "writeoffs" && <>
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Позиция</th><th className="text-left p-4">Причина</th><th className="text-left p-4">Дата</th><th className="text-right p-4">Кол-во</th></tr></thead>
            <tbody>{writeoffs.map((w) => (
              <tr key={w.id} className="border-b border-[#1A1A1A]">
                <td className="p-4 font-medium">{w.name}</td><td className="p-4 text-[#A1A1AA]">{w.reason}</td>
                <td className="p-4 text-[#A1A1AA]">{(w.created_at || "").slice(0, 10)}</td>
                <td className="p-4 text-right tabnum text-[#FF3B30] font-semibold">-{Number(w.amount).toFixed(2)}</td>
              </tr>))}
              {writeoffs.length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[#52525B]">Нет списаний</td></tr>}</tbody>
          </>}
        </table>
      </div>

      <Modal open={modal === "item"} onClose={() => setModal(null)} title="Новая позиция склада">
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="inv-name-input" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Остаток" type="number" value={form.balance || ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} data-testid="inv-balance-input" />
            <Field label="Себестоимость" type="number" value={form.cost || ""} onChange={(e) => setForm({ ...form, cost: e.target.value })} data-testid="inv-cost-input" />
          </div>
          <SelectField label="Ед. измерения" value={form.measure || "kg"} onChange={(e) => setForm({ ...form, measure: e.target.value })}
            options={[{ value: "kg", label: "кг" }, { value: "l", label: "л" }, { value: "pcs", label: "шт" }]} />
          <Btn onClick={saveItem} className="w-full" data-testid="save-inv-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "writeoff"} onClose={() => setModal(null)} title="Списание">
        <div className="space-y-4">
          <SelectField label="Позиция" value={form.inventory_id || ""} onChange={(e) => setForm({ ...form, inventory_id: e.target.value })}
            options={items.map((i) => ({ value: i.id, label: i.name }))} />
          <Field label="Количество" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="writeoff-amount-input" />
          <Field label="Причина" value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Btn variant="danger" onClick={saveWriteoff} className="w-full" data-testid="save-writeoff-btn">Провести списание</Btn>
        </div>
      </Modal>

      <Modal open={modal === "invoice"} onClose={() => setModal(null)} title="Приходная накладная">
        <div className="space-y-4">
          <Field label="Номер накладной" value={form.number || ""} onChange={(e) => setForm({ ...form, number: e.target.value })} data-testid="invoice-number-input" />
          <Field label="Поставщик" value={form.supplier_name || ""} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} />
          <SelectField label="Позиция" value={form.inventory_id || ""} onChange={(e) => setForm({ ...form, inventory_id: e.target.value })}
            options={items.map((i) => ({ value: i.id, label: i.name }))} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Количество" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="invoice-amount-input" />
            <Field label="Цена" type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="invoice-price-input" />
          </div>
          <Btn onClick={saveInvoice} className="w-full" data-testid="save-invoice-btn">Провести приход</Btn>
        </div>
      </Modal>
    </div>
  );
}
