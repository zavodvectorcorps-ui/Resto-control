import { useState, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { downloadCSV } from "@/lib/csv";
import { Download, Pencil, Trash2 } from "lucide-react";
import { PageHead, SearchableSelect, Btn, Field, Modal } from "@/components/admin/ui";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDT = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const toISO = (localStr) => (localStr ? new Date(localStr).toISOString() : null);
const hoursBetween = (a, b) => {
  if (!a) return 0;
  const ms = new Date(b || new Date()).getTime() - new Date(a).getTime();
  return Math.max(0, ms / 3600000);
};
const today = () => new Date().toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);

const ExportBtn = ({ onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} data-testid="export-csv-btn"
    className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--ink-dim)] hover:text-[var(--success)] hover:border-[var(--success)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
    <Download size={14} /> Экспорт CSV
  </button>
);

// Отчётов много (как у Caffesta) — прячем их по смыслу в подгруппы,
// а не в один длинный ряд вкладок.
const GROUPS = [
  { key: "sales", label: "Продажи", tabs: [
    ["receipts", "Чеки"], ["summary", "Итоги"], ["sales", "Продажи"],
    ["analytics", "Аналитика"], ["category", "Категории / Цеха"], ["abc", "ABC-анализ"], ["hall", "Залы"],
  ]},
  { key: "warehouse", label: "Склад", tabs: [["warehouse", "Движение склада"]] },
  { key: "marketing", label: "Маркетинг", tabs: [["promo", "Акции"], ["loyalty", "Лояльность"]] },
  { key: "finance", label: "Финансы", tabs: [["pnl", "P&L"], ["cashflow", "Движение денег"], ["refunds", "Возвраты"], ["debts", "Долги"], ["commissions", "Мотивация"], ["worktime", "Рабочее время"]] },
  { key: "audit", label: "Аудит", tabs: [["corrections", "Удаления"], ["risky", "Чеки с риском"]] },
];

const Card = ({ children, className = "", ...rest }) => (
  <div className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 ${className}`} {...rest}>{children}</div>
);

const chartTooltip = {
  contentStyle: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--ink)" },
  labelStyle: { color: "var(--ink-dim)" },
  cursor: { fill: "rgba(128,128,128,0.10)" },
};

export default function Reports() {
  const qc = useQueryClient();
  const [start, setStart] = useState(weekAgo());
  const [end, setEnd] = useState(today());
  const [tab, setTab] = useState("sales");

  const range = `?start=${start}&end=${end}`;
  const [salesGroup, setSalesGroup] = useState("");
  const [waiterFilter, setWaiterFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const filterRange = range
    + (waiterFilter ? `&waiter_id=${waiterFilter}` : "")
    + (categoryFilter ? `&category_id=${categoryFilter}` : "")
    + (productFilter ? `&product_id=${productFilter}` : "");
  const { data: staff = [] } = useQuery({ queryKey: ["staff-list"], queryFn: async () => (await api.get("/staff")).data });
  const { data: allCategories = [] } = useQuery({ queryKey: ["categories-list"], queryFn: async () => (await api.get("/categories")).data });
  const { data: allProducts = [] } = useQuery({ queryKey: ["products-list"], queryFn: async () => (await api.get("/products")).data });
  const { data: allTables = [] } = useQuery({ queryKey: ["tables-list"], queryFn: async () => (await api.get("/tables")).data });

  const [receiptStatus, setReceiptStatus] = useState("");
  const [receiptTable, setReceiptTable] = useState("");
  const [receiptWaiter, setReceiptWaiter] = useState("");
  const [expandedReceipt, setExpandedReceipt] = useState(null);
  const receiptsQuery = range
    + (receiptStatus ? `&status=${receiptStatus}` : "")
    + (receiptTable ? `&table_id=${receiptTable}` : "")
    + (receiptWaiter ? `&waiter_id=${receiptWaiter}` : "");
  const { data: receipts = [] } = useQuery({
    queryKey: ["receipts-journal", start, end, receiptStatus, receiptTable, receiptWaiter],
    queryFn: async () => (await api.get(`/orders${receiptsQuery}`)).data,
    enabled: tab === "receipts",
  });
  const tableName = (id) => allTables.find((t) => t.id === id)?.name || "—";
  const staffName = (id) => staff.find((s) => s.id === id)?.name || "—";
  const statusLabel = { open: "Открыт", sent: "Отправлен", closed: "Закрыт", refunded: "Возврат" };
  const statusColor = { open: "var(--ink-dim)", sent: "var(--info)", closed: "var(--success)", refunded: "var(--danger)" };
  const { data = {} } = useQuery({
    queryKey: ["sales", start, end, waiterFilter, categoryFilter, productFilter],
    queryFn: async () => (await api.get(`/reports/sales${filterRange}`)).data,
  });
  const { data: byClient = {} } = useQuery({
    queryKey: ["sales-client", start, end],
    queryFn: async () => (await api.get(`/reports/sales${range}&group_by=client`)).data,
    enabled: tab === "sales" && salesGroup === "client",
  });
  const { data: summary = {} } = useQuery({
    queryKey: ["summary", start, end],
    queryFn: async () => (await api.get(`/reports/summary${range}`)).data,
    enabled: tab === "summary",
  });
  const { data: commissions = {} } = useQuery({
    queryKey: ["commissions", start, end],
    queryFn: async () => (await api.get(`/reports/commissions${range}`)).data,
    enabled: tab === "commissions",
  });
  const { data: analytics = {} } = useQuery({
    queryKey: ["analytics", start, end],
    queryFn: async () => (await api.get(`/reports/analytics${range}`)).data,
    enabled: tab === "analytics",
  });
  const { data: byCat = {} } = useQuery({
    queryKey: ["by-category", start, end],
    queryFn: async () => (await api.get(`/reports/by-category${range}`)).data,
    enabled: tab === "category",
  });
  const { data: byWs = {} } = useQuery({
    queryKey: ["by-workshop", start, end],
    queryFn: async () => (await api.get(`/reports/by-workshop${range}`)).data,
    enabled: tab === "category",
  });
  const [abcMetric, setAbcMetric] = useState("revenue");
  const { data: abc = {} } = useQuery({
    queryKey: ["abc", start, end, abcMetric],
    queryFn: async () => (await api.get(`/reports/abc${range}&metric=${abcMetric}`)).data,
    enabled: tab === "abc",
  });
  const { data: corrections = [] } = useQuery({
    queryKey: ["corrections", start, end],
    queryFn: async () => (await api.get(`/reports/corrections${range}`)).data,
    enabled: tab === "corrections",
  });
  const { data: risky = {} } = useQuery({
    queryKey: ["risky-receipts", start, end],
    queryFn: async () => (await api.get(`/reports/risky-receipts${range}`)).data,
    enabled: tab === "risky",
  });
  const { data: byHall = {} } = useQuery({
    queryKey: ["by-hall", start, end],
    queryFn: async () => (await api.get(`/reports/by-hall${range}`)).data,
    enabled: tab === "hall",
  });
  const { data: promoRep = {} } = useQuery({
    queryKey: ["rep-promotions", start, end],
    queryFn: async () => (await api.get(`/reports/promotions${range}`)).data,
    enabled: tab === "promo",
  });
  const { data: loyaltyRep = {} } = useQuery({
    queryKey: ["rep-loyalty", start, end],
    queryFn: async () => (await api.get(`/reports/loyalty${range}`)).data,
    enabled: tab === "loyalty",
  });
  const { data: refundsRep = {} } = useQuery({
    queryKey: ["rep-refunds", start, end],
    queryFn: async () => (await api.get(`/reports/refunds${range}`)).data,
    enabled: tab === "refunds",
  });
  const [worktimeStaffFilter, setWorktimeStaffFilter] = useState("");
  const { data: timeEntries = [] } = useQuery({
    queryKey: ["time-entries", start, end, worktimeStaffFilter],
    queryFn: async () => (await api.get(`/time-entries${range}${worktimeStaffFilter ? `&staff_id=${worktimeStaffFilter}` : ""}`)).data,
    enabled: tab === "worktime",
  });
  const [editingEntry, setEditingEntry] = useState(null);
  const saveTimeEntry = async () => {
    try {
      if (!editingEntry.clock_in) { toast.error("Укажите начало смены"); return; }
      await api.put(`/time-entries/${editingEntry.id}`, { clock_in: toISO(editingEntry.clock_in), clock_out: toISO(editingEntry.clock_out) });
      toast.success("Сохранено"); setEditingEntry(null);
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const deleteTimeEntry = async (id) => {
    try { await api.delete(`/time-entries/${id}`); qc.invalidateQueries({ queryKey: ["time-entries"] }); } catch (e) { toast.error(apiErr(e)); }
  };
  const { data: pnl = {} } = useQuery({
    queryKey: ["pnl", start, end],
    queryFn: async () => (await api.get(`/reports/pnl${range}`)).data,
    enabled: tab === "pnl",
  });
  const { data: cashflow = {} } = useQuery({
    queryKey: ["cashflow", start, end],
    queryFn: async () => (await api.get(`/reports/cashflow${range}`)).data,
    enabled: tab === "cashflow",
  });
  const { data: debtsRep = {} } = useQuery({
    queryKey: ["rep-debts"],
    queryFn: async () => (await api.get(`/reports/debts`)).data,
    enabled: tab === "debts",
  });
  const [whFilter, setWhFilter] = useState("");
  const { data: invReport = {} } = useQuery({
    queryKey: ["rep-inventory", whFilter],
    queryFn: async () => (await api.get(`/reports/inventory${whFilter ? `?warehouse_id=${whFilter}` : ""}`)).data,
    enabled: tab === "warehouse",
  });
  const { data: movement = {} } = useQuery({
    queryKey: ["stock-movement", start, end, whFilter],
    queryFn: async () => (await api.get(`/reports/stock-movement${range}${whFilter ? `&warehouse_id=${whFilter}` : ""}`)).data,
    enabled: tab === "warehouse",
  });

  const payData = [
    { name: "Наличные", value: data.cash || 0, color: "var(--success)" },
    { name: "Карта", value: data.card || 0, color: "var(--info)" },
  ];

  return (
    <div>
      <PageHead title="Отчёты" subtitle="Реализация и аналитика за период" />

      <div className="flex gap-8 items-start">
        <aside className="w-52 shrink-0 space-y-5 sticky top-8">
          {GROUPS.map((g) => (
            <div key={g.key}>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-bold px-3 mb-1.5">{g.label}</div>
              <div className="space-y-0.5">
                {g.tabs.map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} data-testid={`report-tab-${k}`}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      tab === k ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--ink-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                    }`}>{label}</button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <div className="flex-1 min-w-0">
          <div className="flex items-end gap-4 mb-6 flex-wrap">
            <div>
              <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">С</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="report-start"
                className="block mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">По</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="report-end"
                className="block mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 outline-none focus:border-[var(--accent)]" />
            </div>
          </div>

          {tab === "receipts" && (
        <div data-testid="report-panel-receipts">
          <div className="flex flex-wrap gap-3 mb-6">
            <select value={receiptStatus} onChange={(e) => setReceiptStatus(e.target.value)} data-testid="receipts-filter-status"
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
              <option value="">Все статусы</option>
              <option value="open">Открыт</option>
              <option value="sent">Отправлен</option>
              <option value="closed">Закрыт</option>
              <option value="refunded">Возврат</option>
            </select>
            <select value={receiptTable} onChange={(e) => setReceiptTable(e.target.value)} data-testid="receipts-filter-table"
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
              <option value="">Все столы</option>
              {allTables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={receiptWaiter} onChange={(e) => setReceiptWaiter(e.target.value)} data-testid="receipts-filter-waiter"
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
              <option value="">Все официанты/кассиры</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                <th className="text-left p-3">Дата</th><th className="text-left p-3">Стол</th><th className="text-left p-3">Официант</th>
                <th className="text-left p-3">Статус</th><th className="text-right p-3">Позиций</th><th className="text-right p-3">Сумма</th></tr></thead>
              <tbody>
                {receipts.map((o) => (
                  <Fragment key={o.id}>
                    <tr className="border-b border-[var(--surface-2)] cursor-pointer hover:bg-[var(--surface-hover)]"
                      onClick={() => setExpandedReceipt(expandedReceipt === o.id ? null : o.id)} data-testid={`receipt-row-${o.id}`}>
                      <td className="p-3 text-[var(--ink-dim)]">{(o.closed_at || o.created_at || "").slice(0, 16).replace("T", " ")}</td>
                      <td className="p-3 font-medium">{tableName(o.table_id)}</td>
                      <td className="p-3 text-[var(--ink-dim)]">{staffName(o.waiter_id)}</td>
                      <td className="p-3"><span style={{ color: statusColor[o.status] }} className="text-xs font-semibold">{statusLabel[o.status] || o.status}</span></td>
                      <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{(o.items || []).length}</td>
                      <td className="p-3 text-right tabnum text-[var(--success)] font-semibold">{money(o.total)}</td>
                    </tr>
                    {expandedReceipt === o.id && (
                      <tr className="bg-[var(--bg)]">
                        <td colSpan="6" className="p-4">
                          <table className="w-full text-xs">
                            <tbody>
                              {(o.items || []).map((it, i) => (
                                <tr key={i} className="border-b border-[var(--surface-2)]">
                                  <td className="py-1.5 text-[var(--ink-dim)]">{it.name} × {it.count}</td>
                                  <td className="py-1.5 text-right tabnum">{money(it.total ?? it.price * it.count)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {receipts.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Чеков за период не найдено</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "summary" && (
        <div data-testid="report-panel-summary">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {[["Сумма", summary.totals?.amount, "var(--accent)"], ["Скидка", summary.totals?.discount, "var(--danger)"],
              ["К оплате", summary.totals?.payment_amount, "var(--success)"], ["Себестоимость", summary.totals?.cost, "var(--purple)"]].map(([l, v, c], i) => (
              <Card key={i}>
                <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] mb-3">{l}</div>
                <div className="font-head text-2xl font-extrabold tabnum" style={{ color: c }}>{money(v)}</div>
              </Card>
            ))}
          </div>
          <Card>
            <h3 className="font-head text-lg font-bold mb-4">Способ оплаты × Цех/отдел</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                <th className="text-left p-3">Способ оплаты</th><th className="text-left p-3">Цех/отдел</th>
                <th className="text-right p-3">Сумма</th><th className="text-right p-3">Скидка</th>
                <th className="text-right p-3">К оплате</th><th className="text-right p-3">Себестоимость</th></tr></thead>
              <tbody>
                {(summary.rows || []).map((r, i) => (
                  <tr key={i} className="border-b border-[var(--surface-2)]">
                    <td className="p-3 font-medium">{r.payment_label}</td>
                    <td className="p-3 text-[var(--ink-dim)]">{r.workshop}</td>
                    <td className="p-3 text-right tabnum">{money(r.amount)}</td>
                    <td className="p-3 text-right tabnum text-[var(--danger)]">{r.discount ? money(r.discount) : "—"}</td>
                    <td className="p-3 text-right tabnum text-[var(--success)]">{money(r.payment_amount)}</td>
                    <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{money(r.cost)}</td>
                  </tr>
                ))}
                {(summary.rows || []).length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Нет продаж за период</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "sales" && (
        <div data-testid="report-panel-sales">
          <div className="flex gap-2 mb-6">
            <button onClick={() => setSalesGroup("")} data-testid="sales-group-none"
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${salesGroup === "" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>Общий</button>
            <button onClick={() => setSalesGroup("client")} data-testid="sales-group-client"
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${salesGroup === "client" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>По клиентам</button>
          </div>
          {salesGroup === "client" ? (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-head text-lg font-bold">Продажи по клиентам</h3>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-[var(--ink-dim)]">Скидок выдано: <span className="text-[var(--danger)] tabnum">{money(byClient.total_discount)}</span></span>
                  <ExportBtn disabled={!(byClient.rows || []).length}
                    onClick={() => downloadCSV(`sales_by_client_${start}_${end}.csv`, ["Клиент", "Заказов", "Скидка", "Выручка"],
                      (byClient.rows || []).map((r) => [r.client_name, r.order_count, Number(r.total_discount || 0).toFixed(2), Number(r.total_revenue || 0).toFixed(2)]))} />
                </div>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                  <th className="text-left p-3">Клиент</th><th className="text-right p-3">Заказов</th><th className="text-right p-3">Скидка</th><th className="text-right p-3">Выручка</th></tr></thead>
                <tbody>
                  {(byClient.rows || []).map((r, i) => (
                    <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`client-sales-row-${i}`}>
                      <td className="p-3 font-medium">{r.client_name}</td>
                      <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.order_count}</td>
                      <td className="p-3 text-right tabnum text-[var(--danger)]">{money(r.total_discount)}</td>
                      <td className="p-3 text-right tabnum text-[var(--success)]">{money(r.total_revenue)}</td>
                    </tr>
                  ))}
                  {(byClient.rows || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[var(--ink-faint)]">Нет продаж по клиентам</td></tr>}
                </tbody>
              </table>
            </Card>
          ) : (
          <>
          <div className="flex flex-wrap gap-3 mb-6">
            <select value={waiterFilter} onChange={(e) => setWaiterFilter(e.target.value)} data-testid="sales-filter-waiter"
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
              <option value="">Все официанты/кассиры</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setProductFilter(""); }} data-testid="sales-filter-category"
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
              <option value="">Все категории</option>
              {allCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="w-56">
              <SearchableSelect value={productFilter} onChange={setProductFilter} placeholder="Все блюда" data-testid="sales-filter-product"
                options={[{ value: "", label: "Все блюда" }, ...allProducts.filter((p) => !categoryFilter || p.category_id === categoryFilter).map((p) => ({ value: p.id, label: p.name }))]} />
            </div>
            {(waiterFilter || categoryFilter || productFilter) && (
              <button onClick={() => { setWaiterFilter(""); setCategoryFilter(""); setProductFilter(""); }} data-testid="sales-filter-reset"
                className="px-3 py-2 text-sm text-[var(--ink-dim)] hover:text-[var(--ink)]">Сбросить фильтры</button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {[["Всего", data.total, "var(--accent)"], ["Наличные", data.cash, "var(--success)"], ["Карта", data.card, "var(--info)"], ["Чеков", data.orders, "var(--purple)"]].map(([l, v, c], i) => (
              <Card key={i}>
                <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] mb-3">{l}</div>
                <div className="font-head text-2xl font-extrabold tabnum" style={{ color: c }}>{l === "Чеков" ? (v || 0) : money(v)}</div>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <h3 className="font-head text-lg font-bold mb-4">Структура оплат</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={payData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {payData.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-head text-lg font-bold">По позициям</h3>
                <ExportBtn disabled={!(data.by_product || []).length}
                  onClick={() => downloadCSV(`sales_by_product_${start}_${end}.csv`, ["Позиция", "Кол-во", "Выручка"],
                    (data.by_product || []).map((p) => [p.name, p.count, Number(p.revenue || 0).toFixed(2)]))} />
              </div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {(data.by_product || []).map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{p.name} <span className="text-[var(--ink-faint)]">×{p.count}</span></span>
                    <span className="tabnum text-[var(--accent)] font-semibold">{money(p.revenue)}</span>
                  </div>
                ))}
                {(data.by_product || []).length === 0 && <p className="text-[var(--ink-faint)] text-sm">Нет данных</p>}
              </div>
            </Card>
            <Card>
              <h3 className="font-head text-lg font-bold mb-4">По администраторам</h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {(data.by_cashier || []).map((c, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{c.name} <span className="text-[var(--ink-faint)]">×{c.count}</span></span>
                    <span className="tabnum text-[var(--success)] font-semibold">{money(c.revenue)}</span>
                  </div>
                ))}
                {(data.by_cashier || []).length === 0 && <p className="text-[var(--ink-faint)] text-sm">Нет данных</p>}
              </div>
            </Card>
          </div>
          </>
          )}
        </div>
      )}

      {tab === "analytics" && (
        <div data-testid="report-panel-analytics">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {[["Выручка", money(analytics.total), "var(--accent)"], ["Чеков", analytics.orders || 0, "var(--purple)"], ["Средний чек", money(analytics.avg_check), "var(--info)"]].map(([l, v, c], i) => (
              <Card key={i}>
                <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] mb-3">{l}</div>
                <div className="font-head text-2xl font-extrabold tabnum" style={{ color: c }}>{v}</div>
              </Card>
            ))}
          </div>
          <Card className="mb-6">
            <h3 className="font-head text-lg font-bold mb-4">Выручка по часам</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.by_hour || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" stroke="var(--ink-faint)" fontSize={12} />
                <YAxis stroke="var(--ink-faint)" fontSize={12} />
                <Tooltip {...chartTooltip} formatter={(v) => money(v)} />
                <Bar dataKey="revenue" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-head text-lg font-bold">Маржинальность по блюдам</h3>
              <ExportBtn disabled={!(analytics.margin_by_product || []).length}
                onClick={() => downloadCSV(`margin_${start}_${end}.csv`, ["Блюдо", "Кол-во", "Выручка", "Себестоимость", "Маржа", "Маржа %"],
                  (analytics.margin_by_product || []).map((m) => [m.name, m.qty, Number(m.revenue || 0).toFixed(2), Number(m.cost || 0).toFixed(2), Number(m.margin || 0).toFixed(2), m.margin_pct]))} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                    <th className="text-left p-3">Блюдо</th>
                    <th className="text-right p-3">Кол-во</th>
                    <th className="text-right p-3">Выручка</th>
                    <th className="text-right p-3">Себест.</th>
                    <th className="text-right p-3">Маржа</th>
                    <th className="text-right p-3">%</th>
                  </tr>
                </thead>
                <tbody>
                  {(analytics.margin_by_product || []).map((m, i) => (
                    <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`margin-row-${i}`}>
                      <td className="p-3 font-medium">{m.name}</td>
                      <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{m.qty}</td>
                      <td className="p-3 text-right tabnum">{money(m.revenue)}</td>
                      <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{money(m.cost)}</td>
                      <td className="p-3 text-right tabnum text-[var(--success)]">{money(m.margin)}</td>
                      <td className="p-3 text-right tabnum text-[var(--accent)]">{m.margin_pct}%</td>
                    </tr>
                  ))}
                  {(analytics.margin_by_product || []).length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Нет данных</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "category" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="report-panel-category">
          {[["По категориям", byCat, "cat"], ["По цехам", byWs, "ws"]].map(([title, src, key]) => (
            <Card key={key}>
              <h3 className="font-head text-lg font-bold mb-4">{title}</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={src.rows || []} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--ink-faint)" fontSize={12} />
                  <YAxis type="category" dataKey="name" stroke="var(--ink-faint)" fontSize={12} width={110} />
                  <Tooltip {...chartTooltip} formatter={(v) => money(v)} />
                  <Bar dataKey="revenue" fill={key === "cat" ? "var(--info)" : "var(--purple)"} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {(src.rows || []).map((r, i) => (
                  <div key={i} className="flex justify-between text-sm" data-testid={`${key}-row-${i}`}>
                    <span>{r.name} <span className="text-[var(--ink-faint)]">×{r.count}</span></span>
                    <span className="tabnum font-semibold">{money(r.revenue)}</span>
                  </div>
                ))}
                {(src.rows || []).length === 0 && <p className="text-[var(--ink-faint)] text-sm">Нет данных</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === "abc" && (
        <Card data-testid="report-panel-abc">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">ABC-анализ товаров</h3>
            <select value={abcMetric} onChange={(e) => setAbcMetric(e.target.value)} data-testid="abc-metric"
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              <option value="revenue">По выручке</option>
              <option value="count">По количеству</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                  <th className="text-left p-3">Товар</th>
                  <th className="text-right p-3">Кол-во</th>
                  <th className="text-right p-3">Выручка</th>
                  <th className="text-right p-3">Накопл. %</th>
                  <th className="text-center p-3">Класс</th>
                </tr>
              </thead>
              <tbody>
                {(abc.rows || []).map((r, i) => {
                  const clr = r.abc === "A" ? "var(--success)" : r.abc === "B" ? "var(--warning)" : "var(--danger)";
                  return (
                    <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`abc-row-${i}`}>
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.count}</td>
                      <td className="p-3 text-right tabnum">{money(r.revenue)}</td>
                      <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.cum_pct}%</td>
                      <td className="p-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: `${clr}22`, color: clr }}>{r.abc}</span>
                      </td>
                    </tr>
                  );
                })}
                {(abc.rows || []).length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "warehouse" && (
        <div data-testid="report-panel-warehouse">
          <div className="mb-6">
            <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} data-testid="rep-wh-filter"
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]">
              <option value="">Все склады</option>
              {(invReport.warehouses || movement.warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-head text-lg font-bold">Остатки по складам</h3>
                <span className="text-sm text-[var(--ink-dim)]">Итого: <span className="text-[var(--success)] tabnum font-semibold">{money(invReport.total_value)}</span></span>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                    <th className="text-left p-3">Позиция</th><th className="text-left p-3">Склад</th><th className="text-right p-3">Кол-во</th><th className="text-right p-3">Сумма</th></tr></thead>
                  <tbody>
                    {(invReport.rows || []).map((r, i) => (
                      <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`inv-report-row-${i}`}>
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-[var(--ink-dim)]">{r.warehouse_name}</td>
                        <td className="p-3 text-right tabnum">{r.quantity} {r.measure}</td>
                        <td className="p-3 text-right tabnum text-[var(--success)]">{money(r.value)}</td>
                      </tr>
                    ))}
                    {(invReport.rows || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[var(--ink-faint)]">Нет остатков</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card>
              <h3 className="font-head text-lg font-bold mb-4">Движение за период</h3>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                    <th className="text-left p-3">Позиция</th><th className="text-right p-3">Приход</th><th className="text-right p-3">Расход</th><th className="text-right p-3">Итого</th></tr></thead>
                  <tbody>
                    {(movement.rows || []).map((r, i) => (
                      <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`movement-row-${i}`}>
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-right tabnum text-[var(--success)]">+{r.in_qty}</td>
                        <td className="p-3 text-right tabnum text-[var(--danger)]">-{r.out_qty}</td>
                        <td className={`p-3 text-right tabnum font-semibold ${r.net >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{r.net}</td>
                      </tr>
                    ))}
                    {(movement.rows || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[var(--ink-faint)]">Нет движений</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "hall" && (
        <Card data-testid="report-panel-hall">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">Продажи по залам</h3>
            <span className="text-sm text-[var(--ink-dim)]">Итого: <span className="text-[var(--success)] tabnum">{money(byHall.total)}</span></span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-3">Зал</th><th className="text-right p-3">Заказов</th><th className="text-right p-3">Выручка</th></tr></thead>
            <tbody>
              {(byHall.rows || []).map((r, i) => (
                <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`hall-row-${i}`}>
                  <td className="p-3 font-medium">{r.hall}</td>
                  <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.order_count}</td>
                  <td className="p-3 text-right tabnum text-[var(--success)]">{money(r.revenue)}</td>
                </tr>
              ))}
              {(byHall.rows || []).length === 0 && <tr><td colSpan="3" className="p-6 text-center text-[var(--ink-faint)]">Нет данных</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "promo" && (
        <Card data-testid="report-panel-promo">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">Эффективность акций</h3>
            <ExportBtn disabled={!(promoRep.rows || []).length}
              onClick={() => downloadCSV(`promotions_${start}_${end}.csv`, ["Акция", "Применений", "Скидка", "Выручка", "ROI"],
                (promoRep.rows || []).map((r) => [r.name, r.times_applied, Number(r.discount_value || 0).toFixed(2), Number(r.revenue || 0).toFixed(2), r.roi != null ? r.roi : ""]))} />
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-3">Акция</th><th className="text-right p-3">Применений</th><th className="text-right p-3">Скидка</th><th className="text-right p-3">Выручка</th><th className="text-right p-3">ROI</th></tr></thead>
            <tbody>
              {(promoRep.rows || []).map((r, i) => (
                <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`promo-row-${i}`}>
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.times_applied}</td>
                  <td className="p-3 text-right tabnum text-[var(--danger)]">{money(r.discount_value)}</td>
                  <td className="p-3 text-right tabnum text-[var(--success)]">{money(r.revenue)}</td>
                  <td className="p-3 text-right tabnum text-[var(--accent)]">{r.roi != null ? `${r.roi}×` : "—"}</td>
                </tr>
              ))}
              {(promoRep.rows || []).length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Акции не применялись</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "loyalty" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="report-panel-loyalty">
          {[["Начислено бонусов", loyaltyRep.total_accrued, "var(--success)"], ["Списано бонусов", loyaltyRep.total_redeemed, "var(--danger)"], ["Остаток на счетах", loyaltyRep.outstanding_balance, "var(--info)"]].map(([l, v, c], i) => (
            <Card key={i}>
              <div className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] mb-3">{l}</div>
              <div className="font-head text-2xl font-extrabold tabnum" style={{ color: c }}>{money(v)}</div>
            </Card>
          ))}
        </div>
      )}

      {tab === "pnl" && (
        <div className="space-y-6" data-testid="report-panel-pnl">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              ["Выручка", pnl.revenue, "var(--success)"],
              ["Себестоимость", pnl.cogs, "var(--danger)"],
              ["Валовая прибыль", pnl.gross_profit, "var(--info)"],
              ["Прочие доходы", pnl.total_other_income, "var(--success)"],
              ["Расходы", pnl.total_expenses, "var(--danger)"],
              ["Чистая прибыль", pnl.net_profit, pnl.net_profit < 0 ? "var(--danger)" : "var(--accent)"],
            ].map(([label, val, color]) => (
              <Card key={label}>
                <div className="text-xs uppercase tracking-[0.1em] text-[var(--ink-dim)] mb-1">{label}</div>
                <div className="text-2xl font-bold tabnum" style={{ color }}>{money(val)}</div>
              </Card>
            ))}
          </div>
          <Card data-testid="pnl-expenses">
            <h3 className="font-head text-lg font-bold mb-4">Расходы по категориям</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                <th className="text-left p-3">Категория</th><th className="text-right p-3">Сумма</th></tr></thead>
              <tbody>
                {(pnl.expenses || []).map((r, i) => (
                  <tr key={i} className="border-b border-[var(--surface-2)]">
                    <td className="p-3">{r.category}</td>
                    <td className="p-3 text-right tabnum text-[var(--danger)]">{money(r.amount)}</td>
                  </tr>
                ))}
                {(pnl.expenses || []).length === 0 && <tr><td colSpan="2" className="p-6 text-center text-[var(--ink-faint)]">Расходов за период нет — заведите их во «Финансы»</td></tr>}
              </tbody>
            </table>
          </Card>
          {(pnl.other_income || []).length > 0 && (
            <Card data-testid="pnl-other-income">
              <h3 className="font-head text-lg font-bold mb-4">Прочие доходы по категориям</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                  <th className="text-left p-3">Категория</th><th className="text-right p-3">Сумма</th></tr></thead>
                <tbody>
                  {pnl.other_income.map((r, i) => (
                    <tr key={i} className="border-b border-[var(--surface-2)]">
                      <td className="p-3">{r.category}</td>
                      <td className="p-3 text-right tabnum text-[var(--success)]">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {tab === "cashflow" && (
        <div className="space-y-6" data-testid="report-panel-cashflow">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(cashflow.accounts || []).map((a) => (
              <Card key={a.account_id}>
                <div className="text-sm text-[var(--ink-dim)] mb-1">{a.account}</div>
                <div className="text-2xl font-bold tabnum mb-2">{money(a.balance)}</div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--success)]">+{money(a.in)}</span>
                  <span className="text-[var(--danger)]">−{money(a.out)}</span>
                </div>
              </Card>
            ))}
            {(cashflow.accounts || []).length === 0 && <p className="text-sm text-[var(--ink-faint)]">Счетов пока нет — создайте их во «Финансы»</p>}
          </div>
          <Card data-testid="cashflow-transactions">
            <h3 className="font-head text-lg font-bold mb-4">Операции за период</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                <th className="text-left p-3">Дата</th><th className="text-left p-3">Счёт</th><th className="text-left p-3">Категория / Описание</th><th className="text-right p-3">Сумма</th></tr></thead>
              <tbody>
                {(cashflow.transactions || []).map((t) => (
                  <tr key={t.id} className="border-b border-[var(--surface-2)]">
                    <td className="p-3 text-[var(--ink-dim)]">{t.date}</td>
                    <td className="p-3">{t.account_name}{t.type === "transfer" && ` → ${t.to_account_name}`}</td>
                    <td className="p-3 text-[var(--ink-dim)]">{t.category_name || t.description || "—"}</td>
                    <td className={`p-3 text-right tabnum font-semibold ${t.type === "income" ? "text-[var(--success)]" : t.type === "expense" ? "text-[var(--danger)]" : "text-[var(--purple)]"}`}>
                      {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}{money(t.amount)}
                    </td>
                  </tr>
                ))}
                {(cashflow.transactions || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[var(--ink-faint)]">Операций за период нет</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "refunds" && (
        <Card data-testid="report-panel-refunds">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">Возвраты</h3>
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--ink-dim)]">Сумма: <span className="text-[var(--danger)] tabnum">{money(refundsRep.total)}</span></span>
              <ExportBtn disabled={!(refundsRep.rows || []).length}
                onClick={() => downloadCSV(`refunds_${start}_${end}.csv`, ["Дата", "Позиции", "Причина", "Кто", "Сумма"],
                  (refundsRep.rows || []).map((r) => [(r.created_at || "").slice(0, 16).replace("T", " "), (r.items || []).map((x) => `${x.name}x${x.qty}`).join(", "), r.reason, r.staff_name, Number(r.amount || 0).toFixed(2)]))} />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-3">Дата</th><th className="text-left p-3">Позиции</th><th className="text-left p-3">Причина</th><th className="text-left p-3">Кто</th><th className="text-right p-3">Сумма</th></tr></thead>
            <tbody>
              {(refundsRep.rows || []).map((r, i) => (
                <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`refund-row-${i}`}>
                  <td className="p-3 text-[var(--ink-dim)]">{(r.created_at || "").slice(0, 16).replace("T", " ")}</td>
                  <td className="p-3">{(r.items || []).map((x) => `${x.name}×${x.qty}`).join(", ")}</td>
                  <td className="p-3 text-[var(--ink-dim)]">{r.reason}</td>
                  <td className="p-3 text-[var(--ink-dim)]">{r.staff_name}</td>
                  <td className="p-3 text-right tabnum text-[var(--danger)]">{money(r.amount)}</td>
                </tr>
              ))}
              {(refundsRep.rows || []).length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Возвратов нет</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "debts" && (
        <Card data-testid="report-panel-debts">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">Долги клиентов</h3>
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--ink-dim)]">Итого: <span className="text-[var(--danger)] tabnum">{money(debtsRep.total)}</span></span>
              <ExportBtn disabled={!(debtsRep.rows || []).length}
                onClick={() => downloadCSV(`debts_${today()}.csv`, ["Клиент", "Телефон", "Долг"],
                  (debtsRep.rows || []).map((r) => [r.name, r.phone, Number(r.debt_balance || 0).toFixed(2)]))} />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-3">Клиент</th><th className="text-left p-3">Телефон</th><th className="text-right p-3">Долг</th></tr></thead>
            <tbody>
              {(debtsRep.rows || []).map((r, i) => (
                <tr key={i} className="border-b border-[var(--surface-2)]" data-testid={`debt-row-${i}`}>
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-[var(--ink-dim)] tabnum">{r.phone}</td>
                  <td className="p-3 text-right tabnum text-[var(--danger)]">{money(r.debt_balance)}</td>
                </tr>
              ))}
              {(debtsRep.rows || []).length === 0 && <tr><td colSpan="3" className="p-6 text-center text-[var(--ink-faint)]">Задолженностей нет</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "commissions" && (
        <Card data-testid="report-panel-commissions">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">Мотивация — % от продаж</h3>
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--ink-dim)]">Начислено всего: <span className="text-[var(--success)] tabnum">{money(commissions.total_commission)}</span></span>
              <ExportBtn disabled={!(commissions.rows || []).length}
                onClick={() => downloadCSV(`commissions_${start}_${end}.csv`, ["Сотрудник", "Режим", "Ставки", "База, ₽", "Начислено, ₽", "Заказов"],
                  (commissions.rows || []).map((r) => [r.staff_name, r.commission_mode === "shift" ? "на смену" : "личные", r.rates_label, Number(r.sales_base).toFixed(2), Number(r.commission_amount).toFixed(2), r.orders_count]))} />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-3">Сотрудник</th><th className="text-left p-3">Режим</th><th className="text-left p-3">Ставки</th>
              <th className="text-right p-3">База продаж</th><th className="text-right p-3">Заказов</th><th className="text-right p-3">Начислено</th></tr></thead>
            <tbody>
              {(commissions.rows || []).map((r) => (
                <tr key={r.staff_id} className="border-b border-[var(--surface-2)]" data-testid={`commission-row-${r.staff_id}`}>
                  <td className="p-3 font-medium">{r.staff_name}</td>
                  <td className="p-3 text-[var(--ink-dim)]">{r.commission_mode === "shift" ? "поровну на смену" : "личные продажи"}</td>
                  <td className="p-3 text-[var(--ink-dim)]">{r.rates_label}</td>
                  <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{money(r.sales_base)}</td>
                  <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.orders_count}</td>
                  <td className="p-3 text-right tabnum text-[var(--success)] font-semibold">{money(r.commission_amount)}</td>
                </tr>
              ))}
              {(commissions.rows || []).length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Ни у одного сотрудника не настроен % мотивации</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "worktime" && (() => {
        const byStaff = {};
        for (const e of timeEntries) {
          byStaff[e.staff_id] = byStaff[e.staff_id] || { name: e.staff_name, hours: 0, shifts: 0 };
          byStaff[e.staff_id].hours += hoursBetween(e.clock_in, e.clock_out);
          byStaff[e.staff_id].shifts += 1;
        }
        const summaryRows = Object.values(byStaff).sort((a, b) => b.hours - a.hours);
        return (
        <div data-testid="report-panel-worktime">
          <div className="flex flex-wrap gap-3 mb-6">
            <select value={worktimeStaffFilter} onChange={(e) => setWorktimeStaffFilter(e.target.value)} data-testid="worktime-filter-staff"
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--ink)]">
              <option value="">Все сотрудники</option>
              {staff.filter((s) => s.role !== "manager").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Card className="mb-6">
            <h3 className="font-head text-lg font-bold mb-4">Итого по сотрудникам</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                <th className="text-left p-3">Сотрудник</th><th className="text-right p-3">Смен</th><th className="text-right p-3">Часов</th></tr></thead>
              <tbody>
                {summaryRows.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--surface-2)]">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 text-right tabnum text-[var(--ink-dim)]">{r.shifts}</td>
                    <td className="p-3 text-right tabnum text-[var(--success)] font-semibold">{r.hours.toFixed(1)}</td>
                  </tr>
                ))}
                {summaryRows.length === 0 && <tr><td colSpan="3" className="p-6 text-center text-[var(--ink-faint)]">Нет записей за период</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card>
            <h3 className="font-head text-lg font-bold mb-4">Смены</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                <th className="text-left p-3">Сотрудник</th><th className="text-left p-3">Начало</th><th className="text-left p-3">Конец</th>
                <th className="text-right p-3">Часов</th><th className="p-3"></th></tr></thead>
              <tbody>
                {timeEntries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--surface-2)]" data-testid={`worktime-row-${e.id}`}>
                    <td className="p-3 font-medium">{e.staff_name}</td>
                    <td className="p-3 text-[var(--ink-dim)] tabnum">{fmtDT(e.clock_in)}</td>
                    <td className="p-3 tabnum">
                      {e.clock_out ? <span className="text-[var(--ink-dim)]">{fmtDT(e.clock_out)}</span>
                        : <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--success-soft)] text-[var(--success)]">СЕЙЧАС</span>}
                    </td>
                    <td className="p-3 text-right tabnum">{hoursBetween(e.clock_in, e.clock_out).toFixed(1)}</td>
                    <td className="p-3 text-right">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => setEditingEntry({ id: e.id, clock_in: toLocalInput(e.clock_in), clock_out: toLocalInput(e.clock_out) })}
                          className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid={`edit-worktime-${e.id}`}><Pencil size={15} /></button>
                        <button onClick={() => deleteTimeEntry(e.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-worktime-${e.id}`}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {timeEntries.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Нет смен за период</td></tr>}
              </tbody>
            </table>
          </Card>

          <Modal open={!!editingEntry} onClose={() => setEditingEntry(null)} title="Исправить смену">
            {editingEntry && (
              <div className="space-y-4">
                <Field label="Начало" type="datetime-local" value={editingEntry.clock_in}
                  onChange={(e) => setEditingEntry({ ...editingEntry, clock_in: e.target.value })} data-testid="worktime-edit-clockin" />
                <Field label="Конец (пусто = смена ещё открыта)" type="datetime-local" value={editingEntry.clock_out}
                  onChange={(e) => setEditingEntry({ ...editingEntry, clock_out: e.target.value })} data-testid="worktime-edit-clockout" />
                <Btn onClick={saveTimeEntry} className="w-full" data-testid="save-worktime-btn">Сохранить</Btn>
              </div>
            )}
          </Modal>
        </div>
        );
      })()}

      {tab === "corrections" && (
        <Card data-testid="report-panel-corrections">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-head text-lg font-bold">Удаления позиций (контроль)</h3>
            <ExportBtn disabled={!corrections.length}
              onClick={() => downloadCSV(`corrections_${start}_${end}.csv`, ["Дата", "Позиция", "Причина", "Подтвердил", "Сумма"],
                corrections.map((c) => [(c.created_at || "").slice(0, 16).replace("T", " "), c.item_name, c.reason, c.staff_name, Number(c.item_price || 0).toFixed(2)]))} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
                  <th className="text-left p-3">Дата</th>
                  <th className="text-left p-3">Позиция</th>
                  <th className="text-left p-3">Причина</th>
                  <th className="text-left p-3">Подтвердил</th>
                  <th className="text-right p-3">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--surface-2)]" data-testid={`correction-${c.id}`}>
                    <td className="p-3 text-[var(--ink-dim)]">{(c.created_at || "").slice(0, 16).replace("T", " ")}</td>
                    <td className="p-3 font-medium">{c.item_name}</td>
                    <td className="p-3 text-[var(--ink-dim)]">{c.reason}</td>
                    <td className="p-3 text-[var(--ink-dim)]">{c.staff_name}</td>
                    <td className="p-3 text-right tabnum text-[var(--danger)]">{money(c.item_price)}</td>
                  </tr>
                ))}
                {corrections.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[var(--ink-faint)]">Удалений за период нет</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "risky" && (
        <div data-testid="report-panel-risky">
          <p className="text-sm text-[var(--ink-dim)] mb-4">
            Автоматически помечает чек, если пречек печатали повторно, скидку поставили после печати пречека,
            или удалили позицию после того, как пречек уже был напечатан — гость к тому моменту видел другую сумму.
          </p>
          <div className="space-y-3">
            {(risky.rows || []).map((r) => (
              <Card key={r.order_id} data-testid={`risky-row-${r.order_id}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-xs text-[var(--ink-dim)]">{(r.closed_at || "").slice(0, 16).replace("T", " ")} · Кассир: {r.cashier_name || "—"}</div>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {r.reasons.map((rs, i) => (
                        <span key={i} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-soft)]">🙀 {rs}</span>
                      ))}
                    </div>
                  </div>
                  <span className="font-head text-lg font-bold tabnum">{money(r.total)}</span>
                </div>
                {r.corrections.length > 0 && (
                  <div className="border-t border-[var(--border)] pt-2 mt-2 space-y-1">
                    {r.corrections.map((c, i) => (
                      <div key={i} className="text-xs text-[var(--ink-dim)] flex justify-between">
                        <span>{c.item_name} — {c.reason}</span>
                        <span>{c.staff_name} · {(c.created_at || "").slice(0, 16).replace("T", " ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
            {(risky.rows || []).length === 0 && (
              <Card><p className="text-center text-[var(--ink-faint)] py-6">Рискованных чеков за период нет</p></Card>
            )}
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
