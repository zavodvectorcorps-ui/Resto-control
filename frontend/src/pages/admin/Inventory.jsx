import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, PackageMinus, FileText, ArrowLeftRight, Warehouse, ClipboardList, TrendingUp, Factory, Search, SlidersHorizontal } from "lucide-react";
import { PageHead, Btn, Field, SelectField, SearchableSelectField, Modal, ActionMenu } from "@/components/admin/ui";
import RecipeEditor, { hydrateRecipeNetto } from "@/components/admin/RecipeEditor";

const measureLabel = { kg: "кг", l: "л", pcs: "шт" };
const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export default function Inventory() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ["inventory"], queryFn: async () => (await api.get("/inventory")).data });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get("/invoices")).data });
  const { data: writeoffs = [] } = useQuery({ queryKey: ["writeoffs"], queryFn: async () => (await api.get("/writeoffs")).data });
  const { data: warehouses = [] } = useQuery({ queryKey: ["warehouses"], queryFn: async () => (await api.get("/warehouses")).data });
  const { data: stocktakes = [] } = useQuery({ queryKey: ["stocktakes"], queryFn: async () => (await api.get("/stocktakes")).data });
  const { data: revaluations = [] } = useQuery({ queryKey: ["revaluations"], queryFn: async () => (await api.get("/revaluations")).data });
  const { data: productions = [] } = useQuery({ queryKey: ["production"], queryFn: async () => (await api.get("/production")).data });
  const [activeStocktake, setActiveStocktake] = useState(null);
  const [countInputs, setCountInputs] = useState({});

  const { data: workshops = [] } = useQuery({ queryKey: ["workshops"], queryFn: async () => (await api.get("/workshops")).data });

  const [tab, setTab] = useState("stock");
  const [whFilter, setWhFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [stockSearch, setStockSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || "—";
  const semiItems = items.filter((i) => i.kind === "semi");

  const refresh = () => {
    ["inventory", "invoices", "writeoffs", "warehouses", "stocktakes", "revaluations", "production"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const saveRevaluation = async () => {
    try {
      await api.post("/revaluations", {
        inventory_id: form.inventory_id || items[0]?.id,
        new_cost: Number(form.new_cost || 0),
        reason: form.reason || "",
      });
      toast.success("Себестоимость пересчитана"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const startStocktake = async (warehouseId) => {
    try {
      const doc = (await api.post("/stocktakes", { warehouse_id: warehouseId || warehouses[0]?.id })).data;
      setActiveStocktake(doc);
      setCountInputs({});
      setModal("stocktake");
      refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const saveStocktakeCounts = async () => {
    try {
      const payload = Object.entries(countInputs)
        .filter(([, v]) => v !== "" && v != null)
        .map(([inventory_id, v]) => ({ inventory_id, counted_amount: Number(v) }));
      const doc = (await api.put(`/stocktakes/${activeStocktake.id}`, { items: payload })).data;
      setActiveStocktake(doc);
      toast.success("Фактические остатки сохранены");
    } catch (e) { toast.error(apiErr(e)); }
  };

  const postStocktakeNow = async () => {
    try {
      await saveStocktakeCounts();
      await api.post(`/stocktakes/${activeStocktake.id}/post`);
      toast.success("Переучёт проведён, остаток скорректирован");
      setModal(null); setActiveStocktake(null); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const openStocktake = (st) => { setActiveStocktake(st); setCountInputs({}); setModal("stocktake"); };
  const delStocktake = async (id) => {
    try { await api.delete(`/stocktakes/${id}`); toast.success("Переучёт удалён"); refresh(); } catch (e) { toast.error(apiErr(e)); }
  };

  const saveItem = async () => {
    try {
      const kind = form.kind || "ingredient";
      const body = {
        name: form.name, measure: form.measure || "kg", balance: Number(form.balance || 0), cost: Number(form.cost || 0),
        warehouse_id: form.warehouse_id || warehouses[0]?.id, processing_loss: form.processing_loss || null,
        kind, cost_source: form.cost_source || "manual", cost_method: form.cost_method || "last",
        min_balance: form.min_balance === "" || form.min_balance == null ? null : Number(form.min_balance),
        recipe: kind === "semi" ? (form.recipe || []).map((r) => ({ inventory_id: r.inventory_id, name: r.name, amount: Number(r.amount), unit: r.unit || null, processing_method: r.processing_method || null })) : [],
      };
      if (form.id) await api.put(`/inventory/${form.id}`, body);
      else await api.post("/inventory", body);
      toast.success(form.id ? "Позиция обновлена" : "Позиция добавлена"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delItem = async (id) => { await api.delete(`/inventory/${id}`); refresh(); };

  const saveProduction = async () => {
    try {
      await api.post("/production", {
        inventory_id: form.inventory_id || semiItems[0]?.id,
        amount: Number(form.amount || 0),
        warehouse_id: form.warehouse_id || warehouses[0]?.id,
      });
      toast.success("Производство проведено, остатки обновлены"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

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
      toast.success("Накладная создана черновиком — остаток пока не изменился. Проверьте и нажмите «Провести»."); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const postInvoice = async (id) => {
    try {
      await api.post(`/invoices/${id}/post`);
      toast.success("Накладная проведена, остаток обновлён"); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const delInvoice = async (id) => {
    try { await api.delete(`/invoices/${id}`); toast.success("Черновик удалён"); refresh(); } catch (e) { toast.error(apiErr(e)); }
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
            <ActionMenu label="Действия" icon={SlidersHorizontal} data-testid="inventory-actions-menu" items={[
              { label: "Приход", icon: FileText, testId: "add-invoice-btn",
                onClick: () => { setForm({ inventory_id: items[0]?.id, warehouse_id: warehouses[0]?.id }); setModal("invoice"); } },
              { label: "Произвести", icon: Factory, testId: "add-production-btn",
                onClick: () => { if (!semiItems.length) { toast.error("Сначала создайте полуфабрикат"); return; } setForm({ inventory_id: semiItems[0]?.id, warehouse_id: warehouses[0]?.id }); setModal("production"); } },
              { label: "Переучёт", icon: ClipboardList, testId: "add-stocktake-btn", onClick: () => startStocktake(warehouses[0]?.id) },
              { label: "Переоценка", icon: TrendingUp, testId: "add-revalue-btn",
                onClick: () => { setForm({ inventory_id: items[0]?.id, new_cost: items[0]?.cost }); setModal("revalue"); } },
              { label: "Перемещение", icon: ArrowLeftRight, testId: "add-transfer-btn",
                onClick: () => { setForm({ inventory_id: items[0]?.id, from_warehouse_id: warehouses[0]?.id, to_warehouse_id: warehouses[1]?.id }); setModal("transfer"); } },
              { divider: true },
              { label: "Списать", icon: PackageMinus, testId: "add-writeoff-btn",
                onClick: () => { setForm({ inventory_id: items[0]?.id, warehouse_id: warehouses[0]?.id }); setModal("writeoff"); } },
            ]} />
            <Btn onClick={() => { setForm({ measure: "kg", warehouse_id: warehouses[0]?.id, kind: "ingredient", cost_source: "manual", cost_method: "last" }); setModal("item"); }} data-testid="add-inventory-btn"><Plus size={16} /> Позиция</Btn>
          </div>
        } />

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {[["stock", "Остатки"], ["warehouses", "Склады"], ["invoices", "Накладные"], ["production", "Производство"], ["stocktakes", "Переучёты"], ["revaluations", "Переоценки"], ["writeoffs", "Движения"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`inv-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>{l}</button>
        ))}
        {tab === "stock" && (
          <div className="flex gap-2 ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="Поиск…" data-testid="stock-search-input"
                className="bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:border-[var(--accent)] w-40" />
            </div>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} data-testid="stock-kind-filter"
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              <option value="all">Все типы</option>
              <option value="ingredient">Ингредиенты</option>
              <option value="semi">Полуфабрикаты</option>
            </select>
            <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} data-testid="stock-wh-filter"
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              <option value="all">Все склады</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {tab === "warehouses" && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="flex justify-end p-4 border-b border-[var(--border)]">
            <Btn onClick={() => { setForm({}); setModal("warehouse"); }} data-testid="add-warehouse-btn"><Plus size={16} /> Склад</Btn>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Склад</th><th className="text-left p-4">Цех (авто-списание)</th><th className="p-4"></th></tr></thead>
            <tbody>{warehouses.map((w) => (
              <tr key={w.id} className="border-b border-[var(--surface-2)]" data-testid={`wh-row-${w.id}`}>
                <td className="p-4 font-medium"><Warehouse size={14} className="inline mr-2 text-[var(--accent)]" />{w.name}{w.is_default && <span className="ml-2 text-xs text-[var(--success)]">(по умолчанию)</span>}</td>
                <td className="p-4 text-[var(--ink-dim)]">{workshops.find((s) => s.id === w.workshop_id)?.name || "—"}</td>
                <td className="p-4 text-right">
                  <button onClick={() => { setForm({ id: w.id, name: w.name, workshop_id: w.workshop_id }); setModal("warehouse"); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)] mr-3 text-xs" data-testid={`edit-wh-${w.id}`}>Изм.</button>
                  {!w.is_default && <button onClick={() => delWarehouse(w.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-wh-${w.id}`}><Trash2 size={16} /></button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {tab !== "warehouses" && (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          {tab === "stock" && <>
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Позиция</th><th className="text-left p-4">Тип</th><th className="text-left p-4">По складам</th><th className="text-right p-4">{whFilter === "all" ? "Всего" : whName(whFilter)}</th><th className="text-right p-4">Себест.</th><th className="p-4"></th></tr></thead>
            <tbody>{(() => {
              const filteredItems = items.filter((i) =>
                (kindFilter === "all" || (i.kind || "ingredient") === kindFilter)
                && (!stockSearch.trim() || i.name.toLowerCase().includes(stockSearch.trim().toLowerCase()))
              );
              if (filteredItems.length === 0) return <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Ничего не найдено</td></tr>;
              return filteredItems.map((i) => {
              const q = stockOnFilter(i);
              return (
              <tr key={i.id} className={`border-b border-[var(--surface-2)] ${q <= 0 ? "bg-[var(--danger-soft)]" : i.low_stock ? "bg-[var(--warning-soft)]" : ""}`} data-testid={`inv-row-${i.id}`}>
                <td className="p-4 font-medium">
                  {i.name}
                  {i.low_stock && q > 0 && <span title={`Меньше порога ${i.min_balance} ${measureLabel[i.measure]}`} className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-[var(--warning-soft)] text-[var(--warning)] align-middle">⚠ мало</span>}
                </td>
                <td className="p-4">
                  {i.kind === "semi"
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--info-soft)] text-[var(--info)]">П/Ф</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--border)] text-[var(--ink-dim)]">сырьё</span>}
                </td>
                <td className="p-4 text-xs text-[var(--ink-dim)]">
                  {(i.stocks || []).length ? (i.stocks || []).map((s) => (
                    <span key={s.warehouse_id} className="inline-block mr-3">{s.warehouse_name}: <span className="text-[var(--ink)] tabnum">{Number(s.quantity).toFixed(2)}</span></span>
                  )) : <span className="text-[var(--ink-faint)]">нет остатков</span>}
                </td>
                <td className={`p-4 text-right tabnum font-semibold ${q <= 0 ? "text-[var(--danger)]" : i.low_stock ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>{Number(q).toFixed(2)} {measureLabel[i.measure]}</td>
                <td className="p-4 text-right tabnum text-[var(--ink-dim)]">{money(i.cost)}</td>
                <td className="p-4 text-right"><div className="flex gap-3 justify-end">
                  <button onClick={() => { setForm({ id: i.id, name: i.name, measure: i.measure, cost: i.cost, processing_loss: i.processing_loss || {}, kind: i.kind || "ingredient", cost_source: i.cost_source || "manual", cost_method: i.cost_method || "last", min_balance: i.min_balance ?? "", recipe: hydrateRecipeNetto(i.recipe, items.filter((x) => x.id !== i.id)) }); setModal("item"); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)] text-xs" data-testid={`edit-inv-${i.id}`}>Изм.</button>
                  <button onClick={() => delItem(i.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-inv-${i.id}`}><Trash2 size={16} /></button>
                </div></td>
              </tr>);
              });
            })()}</tbody>
          </>}
          {tab === "production" && <>
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Полуфабрикат</th><th className="text-left p-4">Склад</th><th className="text-left p-4">Дата</th><th className="text-left p-4">Автор</th><th className="text-right p-4">Произведено</th></tr></thead>
            <tbody>{productions.map((p) => (
              <tr key={p.id} className="border-b border-[var(--surface-2)]" data-testid={`production-row-${p.id}`}>
                <td className="p-4 font-medium">{p.name}</td>
                <td className="p-4 text-[var(--ink-dim)]">{whName(p.warehouse_id)}</td>
                <td className="p-4 text-[var(--ink-dim)]">{(p.created_at || "").slice(0, 16).replace("T", " ")}</td>
                <td className="p-4 text-[var(--ink-dim)]">{p.created_by}</td>
                <td className="p-4 text-right tabnum text-[var(--success)] font-semibold">+{Number(p.amount).toFixed(2)}</td>
              </tr>))}
              {productions.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Производств ещё не было</td></tr>}</tbody>
          </>}
          {tab === "invoices" && <>
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Номер</th><th className="text-left p-4">Склад</th><th className="text-left p-4">Поставщик</th><th className="text-left p-4">Дата</th><th className="text-left p-4">Статус</th><th className="text-right p-4">Сумма</th><th></th></tr></thead>
            <tbody>{invoices.map((v) => (
              <tr key={v.id} className="border-b border-[var(--surface-2)]">
                <td className="p-4 font-medium">{v.number}</td><td className="p-4 text-[var(--ink-dim)]">{whName(v.warehouse_id)}</td><td className="p-4 text-[var(--ink-dim)]">{v.supplier_name || "—"}</td>
                <td className="p-4 text-[var(--ink-dim)]">{(v.created_at || "").slice(0, 10)}</td>
                <td className="p-4">
                  {v.status === "posted"
                    ? <span className="text-[var(--success)] text-xs font-semibold">Проведена</span>
                    : <span className="text-[var(--warning)] text-xs font-semibold">Черновик</span>}
                </td>
                <td className="p-4 text-right tabnum text-[var(--success)] font-semibold">{money(v.total)}</td>
                <td className="p-4 text-right">
                  {v.status !== "posted" && <div className="flex gap-3 justify-end">
                    <button onClick={() => postInvoice(v.id)} className="text-[var(--success)] text-xs font-semibold hover:text-[var(--ink)]" data-testid={`post-invoice-${v.id}`}>Провести</button>
                    <button onClick={() => delInvoice(v.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-invoice-${v.id}`}><Trash2 size={16} /></button>
                  </div>}
                </td>
              </tr>))}
              {invoices.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-[var(--ink-faint)]">Нет накладных</td></tr>}</tbody>
          </>}
          {tab === "stocktakes" && <>
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Склад</th><th className="text-left p-4">Ответственный</th><th className="text-left p-4">Дата</th><th className="text-left p-4">Статус</th><th className="text-right p-4">Недостача</th><th className="text-right p-4">Перевес</th><th></th></tr></thead>
            <tbody>{stocktakes.map((s) => {
              const shortage = (s.items || []).filter((i) => i.diff < 0).reduce((a, i) => a - i.diff, 0);
              const surplus = (s.items || []).filter((i) => i.diff > 0).reduce((a, i) => a + i.diff, 0);
              return (
              <tr key={s.id} className="border-b border-[var(--surface-2)] cursor-pointer hover:bg-[var(--surface-hover)]" onClick={() => openStocktake(s)}>
                <td className="p-4 font-medium">{whName(s.warehouse_id)}</td>
                <td className="p-4 text-[var(--ink-dim)]">{s.responsible || "—"}</td>
                <td className="p-4 text-[var(--ink-dim)]">{(s.created_at || "").slice(0, 10)}</td>
                <td className="p-4">
                  {s.status === "posted"
                    ? <span className="text-[var(--success)] text-xs font-semibold">Проведён</span>
                    : <span className="text-[var(--warning)] text-xs font-semibold">Черновик</span>}
                </td>
                <td className="p-4 text-right tabnum text-[var(--danger)]">{shortage ? `−${shortage.toFixed(2)}` : "—"}</td>
                <td className="p-4 text-right tabnum text-[var(--success)]">{surplus ? `+${surplus.toFixed(2)}` : "—"}</td>
                <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                  {s.status !== "posted" && <button onClick={() => delStocktake(s.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-stocktake-${s.id}`}><Trash2 size={16} /></button>}
                </td>
              </tr>);
            })}
              {stocktakes.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-[var(--ink-faint)]">Переучётов ещё не было</td></tr>}</tbody>
          </>}
          {tab === "revaluations" && <>
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Позиция</th><th className="text-left p-4">Причина</th><th className="text-left p-4">Дата</th><th className="text-right p-4">Себест. было</th><th className="text-right p-4">Себест. стало</th><th className="text-right p-4">Стоимость остатка, разница</th></tr></thead>
            <tbody>{revaluations.map((r) => {
              const delta = round2(r.value_after - r.value_before);
              return (
              <tr key={r.id} className="border-b border-[var(--surface-2)]">
                <td className="p-4 font-medium">{r.name}</td>
                <td className="p-4 text-[var(--ink-dim)]">{r.reason || "—"}</td>
                <td className="p-4 text-[var(--ink-dim)]">{(r.created_at || "").slice(0, 10)}</td>
                <td className="p-4 text-right tabnum text-[var(--ink-dim)]">{money(r.old_cost)}</td>
                <td className="p-4 text-right tabnum">{money(r.new_cost)}</td>
                <td className={`p-4 text-right tabnum font-semibold ${delta < 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{delta > 0 ? "+" : ""}{money(delta)}</td>
              </tr>);
            })}
              {revaluations.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Переоценок ещё не было</td></tr>}</tbody>
          </>}
          {tab === "writeoffs" && <>
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Позиция</th><th className="text-left p-4">Склад</th><th className="text-left p-4">Причина</th><th className="text-left p-4">Дата</th><th className="text-right p-4">Кол-во</th></tr></thead>
            <tbody>{writeoffs.map((w) => (
              <tr key={w.id} className="border-b border-[var(--surface-2)]">
                <td className="p-4 font-medium">{w.name}</td><td className="p-4 text-[var(--ink-dim)]">{whName(w.warehouse_id)}{w.kind === "transfer" && ` → ${whName(w.to_warehouse_id)}`}</td><td className="p-4 text-[var(--ink-dim)]">{w.reason}</td>
                <td className="p-4 text-[var(--ink-dim)]">{(w.created_at || "").slice(0, 10)}</td>
                <td className={`p-4 text-right tabnum font-semibold ${w.kind === "transfer" ? "text-[var(--info)]" : "text-[var(--danger)]"}`}>{w.kind === "transfer" ? "" : "-"}{Number(w.amount).toFixed(2)}</td>
              </tr>))}
              {writeoffs.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Нет движений</td></tr>}</tbody>
          </>}
        </table>
      </div>
      )}

      <Modal open={modal === "item"} onClose={() => setModal(null)} title={form.id ? "Изменить позицию склада" : "Новая позиция склада"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="inv-name-input" />
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Тип</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm({ ...form, kind: "ingredient" })} data-testid="inv-kind-ingredient"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${form.kind !== "semi" ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                Ингредиент (сырьё)
              </button>
              <button type="button" onClick={() => setForm({ ...form, kind: "semi" })} data-testid="inv-kind-semi"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${form.kind === "semi" ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                Полуфабрикат
              </button>
            </div>
            <p className="text-xs text-[var(--ink-faint)] mt-2">
              {form.kind === "semi"
                ? "Приходуется через «Произвести» — по рецепту ниже списывается сырьё и пополняется остаток самого полуфабриката."
                : "Приходуется накладными (Приход). Себестоимость задаётся вручную или обновляется при проведении накладной."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {!form.id && <Field label="Начальный остаток" type="number" value={form.balance || ""} onChange={(e) => setForm({ ...form, balance: e.target.value })} data-testid="inv-balance-input" />}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">Себестоимость</label>
                {form.kind === "semi" && (
                  <button type="button" data-testid="inv-cost-source-toggle"
                    onClick={() => setForm({ ...form, cost_source: form.cost_source === "auto" ? "manual" : "auto" })}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${form.cost_source === "auto" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--border)] text-[var(--ink-dim)]"}`}>
                    {form.cost_source === "auto" ? "АВТО" : "РУЧ."}
                  </button>
                )}
              </div>
              <input type="number" disabled={form.kind === "semi" && form.cost_source === "auto"} value={form.cost ?? 0}
                onChange={(e) => setForm({ ...form, cost: e.target.value })} data-testid="inv-cost-input"
                className={`w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 outline-none focus:border-[var(--accent)] ${form.kind === "semi" && form.cost_source === "auto" ? "opacity-50 cursor-not-allowed" : ""}`} />
              {form.kind === "semi" && form.cost_source === "auto" && <p className="text-[10px] text-[var(--ink-faint)] mt-1">Считается из рецепта при сохранении</p>}
            </div>
          </div>
          {form.kind !== "semi" && (
            <div>
              <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Себестоимость при приходе накладной</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setForm({ ...form, cost_method: "last" })} data-testid="inv-cost-method-last"
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${form.cost_method !== "average" ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                  Последняя цена
                </button>
                <button type="button" onClick={() => setForm({ ...form, cost_method: "average" })} data-testid="inv-cost-method-average"
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${form.cost_method === "average" ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                  Средневзвешенная
                </button>
              </div>
              <p className="text-xs text-[var(--ink-faint)] mt-2">
                {form.cost_method === "average"
                  ? "При проведении накладной себестоимость пересчитывается с учётом остатка и цены прихода."
                  : "При проведении накладной себестоимость заменяется ценой последнего прихода."}
              </p>
            </div>
          )}
          {!form.id && (
            <SelectField label="Склад для остатка" value={form.warehouse_id || ""} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="inv-warehouse-select" />
          )}
          <SelectField label="Ед. измерения" value={form.measure || "kg"} onChange={(e) => setForm({ ...form, measure: e.target.value })}
            options={[{ value: "kg", label: "кг" }, { value: "l", label: "л" }, { value: "pcs", label: "шт" }]} />
          <div>
            <Field label="Мин. остаток для уведомления (пусто = не следить)" type="number" step="0.001" value={form.min_balance ?? ""}
              onChange={(e) => setForm({ ...form, min_balance: e.target.value })} data-testid="inv-min-balance-input" />
            <p className="text-xs text-[var(--ink-faint)] mt-1">Когда остаток опустится ниже этого значения, позиция подсветится на складе и попадёт в уведомления на панели управления.</p>
          </div>
          {form.kind === "semi" && (
            <div className="border-t border-[var(--border)] pt-4">
              <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Рецепт (из чего произвести 1 ед.)</label>
              <RecipeEditor recipe={form.recipe} onChange={(recipe) => setForm({ ...form, recipe })} inventory={items.filter((x) => x.id !== form.id)} testPrefix="semi-ingredient" emptyText="Рецепт производства не задан" />
            </div>
          )}
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Потери при обработке, % (брутто→нетто)</label>
            <div className="grid grid-cols-5 gap-2">
              {[["cold", "Хол."], ["boil", "Вар."], ["fry", "Жар."], ["stew", "Туш."], ["bake", "Зап."]].map(([k, l]) => (
                <div key={k}>
                  <div className="text-[10px] text-[var(--ink-faint)] text-center mb-1">{l}</div>
                  <input type="number" value={(form.processing_loss || {})[k] ?? ""} data-testid={`loss-${k}-input`}
                    onChange={(e) => setForm({ ...form, processing_loss: { ...(form.processing_loss || {}), [k]: Number(e.target.value) } })}
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm text-center outline-none focus:border-[var(--accent)]" />
                </div>
              ))}
            </div>
          </div>
          <Btn onClick={saveItem} className="w-full" data-testid="save-inv-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "production"} onClose={() => setModal(null)} title="Произвести полуфабрикат">
        <div className="space-y-4">
          <SearchableSelectField label="Полуфабрикат" value={form.inventory_id || ""} onChange={(v) => setForm({ ...form, inventory_id: v })}
            options={semiItems.map((i) => ({ value: i.id, label: i.name }))} data-testid="production-item-select" />
          <SelectField label="Склад" value={form.warehouse_id || ""} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} data-testid="production-warehouse-select" />
          <Field label="Сколько произвести" type="number" step="0.001" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="production-amount-input" />
          {(() => {
            const semi = semiItems.find((i) => i.id === (form.inventory_id || semiItems[0]?.id));
            if (!semi?.recipe?.length) return null;
            const amt = Number(form.amount || 0);
            return (
              <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-xs space-y-1">
                <div className="text-[var(--ink-faint)] uppercase tracking-[0.1em] mb-1">Спишется со склада</div>
                {semi.recipe.map((r, i) => (
                  <div key={i} className="flex justify-between text-[var(--ink-dim)]">
                    <span>{r.name}</span>
                    <span className="tabnum text-[var(--ink)]">{(r.amount * amt).toFixed(3)} {measureLabel[items.find((x) => x.id === r.inventory_id)?.measure] || ""}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <Btn onClick={saveProduction} className="w-full" data-testid="save-production-btn">Произвести</Btn>
        </div>
      </Modal>

      <Modal open={modal === "writeoff"} onClose={() => setModal(null)} title="Списание">
        <div className="space-y-4">
          <SearchableSelectField label="Позиция" value={form.inventory_id || ""} onChange={(v) => setForm({ ...form, inventory_id: v })}
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
          <SearchableSelectField label="Позиция" value={form.inventory_id || ""} onChange={(v) => setForm({ ...form, inventory_id: v })}
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
          <SearchableSelectField label="Позиция" value={form.inventory_id || ""} onChange={(v) => setForm({ ...form, inventory_id: v })}
            options={items.map((i) => ({ value: i.id, label: i.name }))} data-testid="invoice-item-select" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Количество" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="invoice-amount-input" />
            <Field label="Цена" type="number" value={form.price || ""} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="invoice-price-input" />
          </div>
          <Btn onClick={saveInvoice} className="w-full" data-testid="save-invoice-btn">Создать черновик</Btn>
          <p className="text-xs text-[var(--ink-dim)] text-center">Остаток изменится только после нажатия «Провести» в списке накладных — так можно проверить накладную перед проведением.</p>
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

      <Modal open={modal === "revalue"} onClose={() => setModal(null)} title="Переоценка себестоимости">
        <div className="space-y-4">
          <SearchableSelectField label="Позиция" value={form.inventory_id || ""}
            onChange={(v) => setForm({ ...form, inventory_id: v, new_cost: items.find((i) => i.id === v)?.cost })}
            options={items.map((i) => ({ value: i.id, label: `${i.name} (сейчас ${money(i.cost)})` }))} data-testid="revalue-item-select" />
          <Field label="Новая себестоимость" type="number" value={form.new_cost ?? ""} onChange={(e) => setForm({ ...form, new_cost: e.target.value })} data-testid="revalue-cost-input" />
          <Field label="Причина" value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="revalue-reason-input" />
          <p className="text-xs text-[var(--ink-dim)]">Количество на складе не меняется — только себестоимость. Себестоимость авто-блюд на этом ингредиенте пересчитается сразу.</p>
          <Btn onClick={saveRevaluation} className="w-full" data-testid="save-revalue-btn">Применить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "stocktake"} onClose={() => { setModal(null); setActiveStocktake(null); }}
        title={`Переучёт · ${whName(activeStocktake?.warehouse_id)}`}>
        {activeStocktake && <div className="space-y-4">
          {activeStocktake.status === "posted" && (
            <p className="text-xs text-[var(--success)]">Проведён {(activeStocktake.posted_at || "").slice(0, 16).replace("T", " ")} · {activeStocktake.posted_by}</p>
          )}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {(activeStocktake.items || []).map((it) => {
              const val = countInputs[it.inventory_id] ?? (it.counted_amount ?? "");
              const diff = countInputs[it.inventory_id] !== undefined && countInputs[it.inventory_id] !== ""
                ? Number(countInputs[it.inventory_id]) - it.system_amount
                : it.diff;
              return (
                <div key={it.inventory_id} className="flex items-center gap-3 py-2 border-b border-[var(--surface-2)]">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.name}</div>
                    <div className="text-xs text-[var(--ink-dim)]">по системе: {it.system_amount} {measureLabel[it.measure] || it.measure}</div>
                  </div>
                  <input type="number" placeholder="факт." value={val} disabled={activeStocktake.status === "posted"}
                    onChange={(e) => setCountInputs((c) => ({ ...c, [it.inventory_id]: e.target.value }))}
                    data-testid={`stocktake-count-${it.inventory_id}`}
                    className="w-24 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-right disabled:opacity-50" />
                  {diff != null && diff !== 0 && (
                    <span className={`text-xs font-semibold w-14 text-right ${diff < 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{diff > 0 ? "+" : ""}{diff}</span>
                  )}
                </div>
              );
            })}
          </div>
          {activeStocktake.status !== "posted" && (
            <div className="flex gap-3">
              <Btn variant="ghost" onClick={saveStocktakeCounts} className="flex-1" data-testid="save-stocktake-counts-btn">Сохранить факт</Btn>
              <Btn onClick={postStocktakeNow} className="flex-1" data-testid="post-stocktake-btn">Провести</Btn>
            </div>
          )}
        </div>}
      </Modal>
    </div>
  );
}
