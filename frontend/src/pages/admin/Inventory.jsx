import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, PackageMinus, FileText, ArrowLeftRight, Warehouse } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const measureLabel = { kg: "кг", l: "л", pcs: "шт" };
const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

export default function Inventory() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ["inventory"], queryFn: async () => (await api.get("/inventory")).data });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get("/invoices")).data });
  const { data: writeoffs = [] } = useQuery({ queryKey: ["writeoffs"], queryFn: async () => (await api.get("/writeoffs")).data });
  const { data: warehouses = [] } = useQuery({ queryKey: ["warehouses"], queryFn: async () => (await api.get("/warehouses")).data });

  const { data: workshops = [] } = useQuery({ queryKey: ["workshops"], queryFn: async () => (await api.get("/workshops")).data });

  const [tab, setTab] = useState("stock");
  const [whFilter, setWhFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || "—";

  const refresh = () => {
    ["inventory", "invoices", "writeoffs", "warehouses"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const saveItem = async () => {
    try {
      await api.post("/inventory", { name: form.name, measure: form.measure || "kg", balance: Number(form.balance || 0), cost: Number(form.cost || 0), warehouse_id: form.warehouse_id || warehouses[0]?.id });
      toast.success("Позиция добавлена"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delItem = async (id) => { await api.delete(`/inventory/${id}`); refresh(); };

  const saveWriteoff = async () => {
    try {
      await api.post("/writeoffs", { inventory_id: form.inventory_id || items[0]?.id, amount: Number(form.amount || 0), reason: form.reason || "Списание", warehouse_id: form.warehouse_id || warehouses[0]?.id });
      toast.success("Списание проведено"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const saveInvoice = async () => {
    try {
      const it = items.find((x) => x.id === (form.inventory_id || items[0]?.id));
      await api.post("/invoices", {
        number: form.number, supplier_name: form.supplier_name || "", warehouse_id: form.warehouse_id || warehouses[0]?.id,
        items: [{ inventory_id: it.id, name: it.name, amount: Number(form.amount || 0), price: Number(form.price || 0) }],
      });
      toast.success("Накладная проведена, остаток обновлён"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const saveTransfer = async () => {
    try {
      await api.post("/stock/transfer", {
        inventory_id: form.inventory_id || items[0]?.id,
        from_warehouse_id: form.from_warehouse_id || warehouses[0]?.id,
        to_warehouse_id: form.to_warehouse_id || warehouses[1]?.id,
        amount: Number(form.amount || 0),
      });
      toast.success("Перемещение выполнено"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const saveWarehouse = async () => {
    try {
      if (form.id) await api.put(`/warehouses/${form.id}`, { name: form.name, workshop_id: form.workshop_id || null });
      else await api.post("/warehouses", { name: form.name, workshop_id: form.workshop_id || null });
      toast.success("Склад сохранён"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delWarehouse = async (id) => { try { await api.delete(`/warehouses/${id}`); refresh(); } catch (e) { toast.error(apiErr(e)); } };

  const stockOnFilter = (it) => {
    if (whFilter === "all") return it.balance;
    return (it.stocks || []).find((s) => s.warehouse_id === whFilter)?.quantity || 0;
  };

  return (
    <div>
      <PageHead title="Склад" subtitle="Остатки по складам, приход, списания и перемещения"
        action={
          <div className="flex gap-2 flex-wrap">
            <Btn variant="ghost" onClick={() => { setForm({ inventory_id: items[0]?.id, warehouse_id: warehouses[0]?.id }); setModal("invoice"); }} data-testid="add-invoice-btn"><FileText size={16} className="inline mr-1" /> Приход</Btn>
            <Btn variant="ghost" onClick={() => { setForm({ inventory_id: items[0]?.id, from_warehouse_id: warehouses[0]?.id, to_warehouse_id: warehouses[1]?.id }); setModal("transfer"); }} data-testid="add-transfer-btn"><ArrowLeftRight size={16} className="inline mr-1" /> Перемещение</Btn>
            <Btn variant="danger" onClick={() => { setForm({ inventory_id: items[0]?.id, warehouse_id: warehouses[0]?.id }); setModal("writeoff"); }} data-testid="add-writeoff-btn"><PackageMinus size={16} className="inline mr-1" /> Списать</Btn>
            <Btn onClick={() => { setForm({ measure: "kg", warehouse_id: warehouses[0]?.id }); setModal("item"); }} data-testid="add-inventory-btn"><Plus size={16} className="inline mr-1" /> Позиция</Btn>
          </div>
        } />

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {[["stock", "Остатки"], ["warehouses", "Склады"], ["invoices", "Накладные"], ["writeoffs", "Движения"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`inv-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[#FF5A00] text-white" : "bg-[#121212] border border-[#27272A] text-[#A1A1AA]"}`}>{l}</button>
        ))}
        {tab === "stock" && (
          <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} data-testid="stock-wh-filter"
            className="ml-auto bg-[#0A0A0A] border border-[#27272A] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FF5A00]">
            <option value="all">Все склады</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>

      {tab === "warehouses" && (
        <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
          <div className="flex justify-end p-4 border-b border-[#27272A]">
            <Btn onClick={() => { setForm({}); setModal("warehouse"); }} data-testid="add-warehouse-btn"><Plus size={16} className="inline mr-1" /> Склад</Btn>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Склад</th><th className="text-left p-4">Цех (авто-списание)</th><th className="p-4"></th></tr></thead>
            <tbody>{warehouses.map((w) => (
              <tr key={w.id} className="border-b border-[#1A1A1A]" data-testid={`wh-row-${w.id}`}>
                <td className="p-4 font-medium"><Warehouse size={14} className="inline mr-2 text-[#FF5A00]" />{w.name}{w.is_default && <span className="ml-2 text-xs text-[#00E676]">(по умолчанию)</span>}</td>
                <td className="p-4 text-[#A1A1AA]">{workshops.find((s) => s.id === w.workshop_id)?.name || "—"}</td>
                <td className="p-4 text-right">
                  <button onClick={() => { setForm({ id: w.id, name: w.name, workshop_id: w.workshop_id }); setModal("warehouse"); }} className="text-[#A1A1AA] hover:text-white mr-3 text-xs" data-testid={`edit-wh-${w.id}`}>Изм.</button>
                  {!w.is_default && <button onClick={() => delWarehouse(w.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-wh-${w.id}`}><Trash2 size={16} /></button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {tab !== "warehouses" && (
      <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          {tab === "stock" && <>
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Позиция</th><th className="text-left p-4">По складам</th><th className="text-right p-4">{whFilter === "all" ? "Всего" : whName(whFilter)}</th><th className="text-right p-4">Себест.</th><th className="p-4"></th></tr></thead>
            <tbody>{items.map((i) => {
              const q = stockOnFilter(i);
              return (
              <tr key={i.id} className={`border-b border-[#1A1A1A] ${q <= 0 ? "bg-[#1A0806]" : ""}`} data-testid={`inv-row-${i.id}`}>
                <td className="p-4 font-medium">{i.name}</td>
                <td className="p-4 text-xs text-[#A1A1AA]">
                  {(i.stocks || []).length ? (i.stocks || []).map((s) => (
                    <span key={s.warehouse_id} className="inline-block mr-3">{s.warehouse_name}: <span className="text-white tabnum">{Number(s.quantity).toFixed(2)}</span></span>
                  )) : <span className="text-[#52525B]">нет остатков</span>}
                </td>
                <td className={`p-4 text-right tabnum font-semibold ${q <= 0 ? "text-[#FF3B30]" : "text-white"}`}>{Number(q).toFixed(2)} {measureLabel[i.measure]}</td>
                <td className="p-4 text-right tabnum text-[#A1A1AA]">{money(i.cost)}</td>
                <td className="p-4 text-right"><button onClick={() => delItem(i.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-inv-${i.id}`}><Trash2 size={16} /></button></td>
              </tr>);
            })}</tbody>
          </>}
          {tab === "invoices" && <>
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Номер</th><th className="text-left p-4">Склад</th><th className="text-left p-4">Поставщик</th><th className="text-left p-4">Дата</th><th className="text-right p-4">Сумма</th></tr></thead>
            <tbody>{invoices.map((v) => (
              <tr key={v.id} className="border-b border-[#1A1A1A]">
                <td className="p-4 font-medium">{v.number}</td><td className="p-4 text-[#A1A1AA]">{whName(v.warehouse_id)}</td><td className="p-4 text-[#A1A1AA]">{v.supplier_name || "—"}</td>
                <td className="p-4 text-[#A1A1AA]">{(v.created_at || "").slice(0, 10)}</td>
                <td className="p-4 text-right tabnum text-[#00E676] font-semibold">{money(v.total)}</td>
              </tr>))}
              {invoices.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[#52525B]">Нет накладных</td></tr>}</tbody>
          </>}
          {tab === "writeoffs" && <>
            <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
              <th className="text-left p-4">Позиция</th><th className="text-left p-4">Склад</th><th className="text-left p-4">Причина</th><th className="text-left p-4">Дата</th><th className="text-right p-4">Кол-во</th></tr></thead>
            <tbody>{writeoffs.map((w) => (
              <tr key={w.id} className="border-b border-[#1A1A1A]">
                <td className="p-4 font-medium">{w.name}</td><td className="p-4 text-[#A1A1AA]">{whName(w.warehouse_id)}{w.kind === "transfer" && ` → ${whName(w.to_warehouse_id)}`}</td><td className="p-4 text-[#A1A1AA]">{w.reason}</td>
                <td className="p-4 text-[#A1A1AA]">{(w.created_at || "").slice(0, 10)}</td>
                <td className={`p-4 text-right tabnum font-semibold ${w.kind === "transfer" ? "text-[#00E5FF]" : "text-[#FF3B30]"}`}>{w.kind === "transfer" ? "" : "-"}{Number(w.amount).toFixed(2)}</td>
              </tr>))}
              {writeoffs.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[#52525B]">Нет движений</td></tr>}</tbody>
          </>}
        </table>
      </div>
      )}

      <Modal open={modal === "item"} onClose={() => setModal(null)} title="Новая позиция склада">
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="inv-name-input" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Начальный остаток" type="number" value={form.balance || ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} data-testid="inv-balance-input" />
            <Field label="Себестоимость" type="number" value={form.cost || ""} onChange={(e) => setForm({ ...form, cost: e.target.value })} data-testid="inv-cost-input" />
          </div>
          <SelectField label="Склад для остатка" value={form.warehouse_id || ""} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="inv-warehouse-select" />
          <SelectField label="Ед. измерения" value={form.measure || "kg"} onChange={(e) => setForm({ ...form, measure: e.target.value })}
            options={[{ value: "kg", label: "кг" }, { value: "l", label: "л" }, { value: "pcs", label: "шт" }]} />
          <Btn onClick={saveItem} className="w-full" data-testid="save-inv-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "writeoff"} onClose={() => setModal(null)} title="Списание">
        <div className="space-y-4">
          <SelectField label="Позиция" value={form.inventory_id || ""} onChange={(e) => setForm({ ...form, inventory_id: e.target.value })}
            options={items.map((i) => ({ value: i.id, label: i.name }))} data-testid="writeoff-item-select" />
          <SelectField label="Склад списания" value={form.warehouse_id || ""} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="writeoff-warehouse-select" />
          <Field label="Количество" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="writeoff-amount-input" />
          <Field label="Причина" value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Btn variant="danger" onClick={saveWriteoff} className="w-full" data-testid="save-writeoff-btn">Провести списание</Btn>
        </div>
      </Modal>

      <Modal open={modal === "transfer"} onClose={() => setModal(null)} title="Перемещение между складами">
        <div className="space-y-4">
          <SelectField label="Позиция" value={form.inventory_id || ""} onChange={(e) => setForm({ ...form, inventory_id: e.target.value })}
            options={items.map((i) => ({ value: i.id, label: i.name }))} data-testid="transfer-item-select" />
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Со склада" value={form.from_warehouse_id || ""} onChange={(e) => setForm({ ...form, from_warehouse_id: e.target.value })}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="transfer-from-select" />
            <SelectField label="На склад" value={form.to_warehouse_id || ""} onChange={(e) => setForm({ ...form, to_warehouse_id: e.target.value })}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="transfer-to-select" />
          </div>
          <Field label="Количество" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="transfer-amount-input" />
          <Btn onClick={saveTransfer} className="w-full" data-testid="save-transfer-btn">Переместить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "invoice"} onClose={() => setModal(null)} title="Приходная накладная">
        <div className="space-y-4">
          <Field label="Номер накладной" value={form.number || ""} onChange={(e) => setForm({ ...form, number: e.target.value })} data-testid="invoice-number-input" />
          <Field label="Поставщик" value={form.supplier_name || ""} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} />
          <SelectField label="Склад прихода" value={form.warehouse_id || ""} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="invoice-warehouse-select" />
          <SelectField label="Позиция" value={form.inventory_id || ""} onChange={(e) => setForm({ ...form, inventory_id: e.target.value })}
            options={items.map((i) => ({ value: i.id, label: i.name }))} data-testid="invoice-item-select" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Количество" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="invoice-amount-input" />
            <Field label="Цена" type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="invoice-price-input" />
          </div>
          <Btn onClick={saveInvoice} className="w-full" data-testid="save-invoice-btn">Провести приход</Btn>
        </div>
      </Modal>

      <Modal open={modal === "warehouse"} onClose={() => setModal(null)} title={form.id ? "Изменить склад" : "Новый склад"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="warehouse-name-input" />
          <SelectField label="Цех для авто-списания (необязательно)" value={form.workshop_id || ""} onChange={(e) => setForm({ ...form, workshop_id: e.target.value })}
            options={[{ value: "", label: "— не привязан —" }, ...workshops.map((w) => ({ value: w.id, label: w.name }))]} data-testid="warehouse-workshop-select" />
          <Btn onClick={saveWarehouse} className="w-full" data-testid="save-warehouse-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
