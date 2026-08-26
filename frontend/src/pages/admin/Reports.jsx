import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { PageHead } from "@/components/admin/ui";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;
const today = () => new Date().toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);

const TABS = [
  ["sales", "Продажи"],
  ["analytics", "Аналитика"],
  ["category", "Категории / Цеха"],
  ["abc", "ABC-анализ"],
  ["warehouse", "Склад"],
  ["corrections", "Удаления"],
];

const Card = ({ children, className = "", ...rest }) => (
  <div className={`bg-[#121212] border border-[#27272A] rounded-xl p-6 ${className}`} {...rest}>{children}</div>
);

const chartTooltip = {
  contentStyle: { background: "#0A0A0A", border: "1px solid #27272A", borderRadius: 8, color: "#fff" },
  labelStyle: { color: "#A1A1AA" },
  cursor: { fill: "#ffffff10" },
};

export default function Reports() {
  const [start, setStart] = useState(weekAgo());
  const [end, setEnd] = useState(today());
  const [tab, setTab] = useState("sales");

  const range = `?start=${start}&end=${end}`;
  const [salesGroup, setSalesGroup] = useState("");
  const { data = {} } = useQuery({
    queryKey: ["sales", start, end],
    queryFn: async () => (await api.get(`/reports/sales${range}`)).data,
  });
  const { data: byClient = {} } = useQuery({
    queryKey: ["sales-client", start, end],
    queryFn: async () => (await api.get(`/reports/sales${range}&group_by=client`)).data,
    enabled: tab === "sales" && salesGroup === "client",
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
    { name: "Наличные", value: data.cash || 0, color: "#00E676" },
    { name: "Карта", value: data.card || 0, color: "#00E5FF" },
  ];

  return (
    <div>
      <PageHead title="Отчёты" subtitle="Реализация и аналитика за период" />

      <div className="flex items-end gap-4 mb-6 flex-wrap">
        <div>
          <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">С</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="report-start"
            className="block mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">По</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="report-end"
            className="block mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap border-b border-[#27272A] pb-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`report-tab-${k}`}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
              tab === k ? "bg-[#121212] text-[#FF5A00] border-b-2 border-[#FF5A00]" : "text-[#A1A1AA] hover:text-white"
            }`}>{label}</button>
        ))}
      </div>

      {tab === "sales" && (
        <div data-testid="report-panel-sales">
          <div className="flex gap-2 mb-6">
            <button onClick={() => setSalesGroup("")} data-testid="sales-group-none"
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${salesGroup === "" ? "bg-[#FF5A00] text-white" : "bg-[#121212] border border-[#27272A] text-[#A1A1AA]"}`}>Общий</button>
            <button onClick={() => setSalesGroup("client")} data-testid="sales-group-client"
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${salesGroup === "client" ? "bg-[#FF5A00] text-white" : "bg-[#121212] border border-[#27272A] text-[#A1A1AA]"}`}>По клиентам</button>
          </div>
          {salesGroup === "client" ? (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-head text-lg font-bold">Продажи по клиентам</h3>
                <span className="text-sm text-[#A1A1AA]">Скидок выдано: <span className="text-[#FF3B30] tabnum">{money(byClient.total_discount)}</span></span>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
                  <th className="text-left p-3">Клиент</th><th className="text-right p-3">Заказов</th><th className="text-right p-3">Скидка</th><th className="text-right p-3">Выручка</th></tr></thead>
                <tbody>
                  {(byClient.rows || []).map((r, i) => (
                    <tr key={i} className="border-b border-[#1A1A1A]" data-testid={`client-sales-row-${i}`}>
                      <td className="p-3 font-medium">{r.client_name}</td>
                      <td className="p-3 text-right tabnum text-[#A1A1AA]">{r.order_count}</td>
                      <td className="p-3 text-right tabnum text-[#FF3B30]">{money(r.total_discount)}</td>
                      <td className="p-3 text-right tabnum text-[#00E676]">{money(r.total_revenue)}</td>
                    </tr>
                  ))}
                  {(byClient.rows || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[#52525B]">Нет продаж по клиентам</td></tr>}
                </tbody>
              </table>
            </Card>
          ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {[["Всего", data.total, "#FF5A00"], ["Наличные", data.cash, "#00E676"], ["Карта", data.card, "#00E5FF"], ["Чеков", data.orders, "#A855F7"]].map(([l, v, c], i) => (
              <Card key={i}>
                <div className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA] mb-3">{l}</div>
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
              <h3 className="font-head text-lg font-bold mb-4">По позициям</h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {(data.by_product || []).map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{p.name} <span className="text-[#52525B]">×{p.count}</span></span>
                    <span className="tabnum text-[#FF5A00] font-semibold">{money(p.revenue)}</span>
                  </div>
                ))}
                {(data.by_product || []).length === 0 && <p className="text-[#52525B] text-sm">Нет данных</p>}
              </div>
            </Card>
            <Card>
              <h3 className="font-head text-lg font-bold mb-4">По администраторам</h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {(data.by_cashier || []).map((c, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{c.name} <span className="text-[#52525B]">×{c.count}</span></span>
                    <span className="tabnum text-[#00E676] font-semibold">{money(c.revenue)}</span>
                  </div>
                ))}
                {(data.by_cashier || []).length === 0 && <p className="text-[#52525B] text-sm">Нет данных</p>}
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
            {[["Выручка", money(analytics.total), "#FF5A00"], ["Чеков", analytics.orders || 0, "#A855F7"], ["Средний чек", money(analytics.avg_check), "#00E5FF"]].map(([l, v, c], i) => (
              <Card key={i}>
                <div className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA] mb-3">{l}</div>
                <div className="font-head text-2xl font-extrabold tabnum" style={{ color: c }}>{v}</div>
              </Card>
            ))}
          </div>
          <Card className="mb-6">
            <h3 className="font-head text-lg font-bold mb-4">Выручка по часам</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.by_hour || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                <XAxis dataKey="hour" stroke="#52525B" fontSize={12} />
                <YAxis stroke="#52525B" fontSize={12} />
                <Tooltip {...chartTooltip} formatter={(v) => money(v)} />
                <Bar dataKey="revenue" fill="#FF5A00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <h3 className="font-head text-lg font-bold mb-4">Маржинальность по блюдам</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
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
                    <tr key={i} className="border-b border-[#1A1A1A]" data-testid={`margin-row-${i}`}>
                      <td className="p-3 font-medium">{m.name}</td>
                      <td className="p-3 text-right tabnum text-[#A1A1AA]">{m.qty}</td>
                      <td className="p-3 text-right tabnum">{money(m.revenue)}</td>
                      <td className="p-3 text-right tabnum text-[#A1A1AA]">{money(m.cost)}</td>
                      <td className="p-3 text-right tabnum text-[#00E676]">{money(m.margin)}</td>
                      <td className="p-3 text-right tabnum text-[#FF5A00]">{m.margin_pct}%</td>
                    </tr>
                  ))}
                  {(analytics.margin_by_product || []).length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[#52525B]">Нет данных</td></tr>}
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" horizontal={false} />
                  <XAxis type="number" stroke="#52525B" fontSize={12} />
                  <YAxis type="category" dataKey="name" stroke="#52525B" fontSize={12} width={110} />
                  <Tooltip {...chartTooltip} formatter={(v) => money(v)} />
                  <Bar dataKey="revenue" fill={key === "cat" ? "#00E5FF" : "#A855F7"} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {(src.rows || []).map((r, i) => (
                  <div key={i} className="flex justify-between text-sm" data-testid={`${key}-row-${i}`}>
                    <span>{r.name} <span className="text-[#52525B]">×{r.count}</span></span>
                    <span className="tabnum font-semibold">{money(r.revenue)}</span>
                  </div>
                ))}
                {(src.rows || []).length === 0 && <p className="text-[#52525B] text-sm">Нет данных</p>}
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
              className="bg-[#0A0A0A] border border-[#27272A] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FF5A00]">
              <option value="revenue">По выручке</option>
              <option value="count">По количеству</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
                  <th className="text-left p-3">Товар</th>
                  <th className="text-right p-3">Кол-во</th>
                  <th className="text-right p-3">Выручка</th>
                  <th className="text-right p-3">Накопл. %</th>
                  <th className="text-center p-3">Класс</th>
                </tr>
              </thead>
              <tbody>
                {(abc.rows || []).map((r, i) => {
                  const clr = r.abc === "A" ? "#00E676" : r.abc === "B" ? "#FFB020" : "#FF3B30";
                  return (
                    <tr key={i} className="border-b border-[#1A1A1A]" data-testid={`abc-row-${i}`}>
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3 text-right tabnum text-[#A1A1AA]">{r.count}</td>
                      <td className="p-3 text-right tabnum">{money(r.revenue)}</td>
                      <td className="p-3 text-right tabnum text-[#A1A1AA]">{r.cum_pct}%</td>
                      <td className="p-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: `${clr}22`, color: clr }}>{r.abc}</span>
                      </td>
                    </tr>
                  );
                })}
                {(abc.rows || []).length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[#52525B]">Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "warehouse" && (
        <div data-testid="report-panel-warehouse">
          <div className="mb-6">
            <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} data-testid="rep-wh-filter"
              className="bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#FF5A00]">
              <option value="">Все склады</option>
              {(invReport.warehouses || movement.warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-head text-lg font-bold">Остатки по складам</h3>
                <span className="text-sm text-[#A1A1AA]">Итого: <span className="text-[#00E676] tabnum font-semibold">{money(invReport.total_value)}</span></span>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
                    <th className="text-left p-3">Позиция</th><th className="text-left p-3">Склад</th><th className="text-right p-3">Кол-во</th><th className="text-right p-3">Сумма</th></tr></thead>
                  <tbody>
                    {(invReport.rows || []).map((r, i) => (
                      <tr key={i} className="border-b border-[#1A1A1A]" data-testid={`inv-report-row-${i}`}>
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-[#A1A1AA]">{r.warehouse_name}</td>
                        <td className="p-3 text-right tabnum">{r.quantity} {r.measure}</td>
                        <td className="p-3 text-right tabnum text-[#00E676]">{money(r.value)}</td>
                      </tr>
                    ))}
                    {(invReport.rows || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[#52525B]">Нет остатков</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card>
              <h3 className="font-head text-lg font-bold mb-4">Движение за период</h3>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm">
                  <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
                    <th className="text-left p-3">Позиция</th><th className="text-right p-3">Приход</th><th className="text-right p-3">Расход</th><th className="text-right p-3">Итого</th></tr></thead>
                  <tbody>
                    {(movement.rows || []).map((r, i) => (
                      <tr key={i} className="border-b border-[#1A1A1A]" data-testid={`movement-row-${i}`}>
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-right tabnum text-[#00E676]">+{r.in_qty}</td>
                        <td className="p-3 text-right tabnum text-[#FF3B30]">-{r.out_qty}</td>
                        <td className={`p-3 text-right tabnum font-semibold ${r.net >= 0 ? "text-[#00E676]" : "text-[#FF3B30]"}`}>{r.net}</td>
                      </tr>
                    ))}
                    {(movement.rows || []).length === 0 && <tr><td colSpan="4" className="p-6 text-center text-[#52525B]">Нет движений</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "corrections" && (
        <Card data-testid="report-panel-corrections">
          <h3 className="font-head text-lg font-bold mb-4">Удаления позиций (контроль)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
                  <th className="text-left p-3">Дата</th>
                  <th className="text-left p-3">Позиция</th>
                  <th className="text-left p-3">Причина</th>
                  <th className="text-left p-3">Подтвердил</th>
                  <th className="text-right p-3">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => (
                  <tr key={c.id} className="border-b border-[#1A1A1A]" data-testid={`correction-${c.id}`}>
                    <td className="p-3 text-[#A1A1AA]">{(c.created_at || "").slice(0, 16).replace("T", " ")}</td>
                    <td className="p-3 font-medium">{c.item_name}</td>
                    <td className="p-3 text-[#A1A1AA]">{c.reason}</td>
                    <td className="p-3 text-[#A1A1AA]">{c.staff_name}</td>
                    <td className="p-3 text-right tabnum text-[#FF3B30]">{money(c.item_price)}</td>
                  </tr>
                ))}
                {corrections.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-[#52525B]">Удалений за период нет</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
