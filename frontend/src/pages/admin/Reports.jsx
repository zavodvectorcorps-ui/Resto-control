import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { PageHead } from "@/components/admin/ui";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;
const today = () => new Date().toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);

export default function Reports() {
  const [start, setStart] = useState(weekAgo());
  const [end, setEnd] = useState(today());

  const { data } = useQuery({
    queryKey: ["sales", start, end],
    queryFn: async () => (await api.get(`/reports/sales?start=${start}&end=${end}`)).data,
  });
  const d = data || {};
  const payData = [
    { name: "Наличные", value: d.cash || 0, color: "#00E676" },
    { name: "Карта", value: d.card || 0, color: "#00E5FF" },
  ];

  return (
    <div>
      <PageHead title="Отчёты" subtitle="Реализация за период" />

      <div className="flex items-end gap-4 mb-6">
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[["Всего", d.total, "#FF5A00"], ["Наличные", d.cash, "#00E676"], ["Карта", d.card, "#00E5FF"], ["Чеков", d.orders, "#A855F7"]].map(([l, v, c], i) => (
          <div key={i} className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
            <div className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA] mb-3">{l}</div>
            <div className="font-head text-2xl font-extrabold tabnum" style={{ color: c }}>{l === "Чеков" ? (v || 0) : money(v)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-4">Структура оплат</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={payData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {payData.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
              </Pie>
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-4">По позициям</h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {(d.by_product || []).map((p, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{p.name} <span className="text-[#52525B]">×{p.count}</span></span>
                <span className="tabnum text-[#FF5A00] font-semibold">{money(p.revenue)}</span>
              </div>
            ))}
            {(d.by_product || []).length === 0 && <p className="text-[#52525B] text-sm">Нет данных</p>}
          </div>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-4">По кассирам</h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {(d.by_cashier || []).map((c, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{c.name} <span className="text-[#52525B]">×{c.count}</span></span>
                <span className="tabnum text-[#00E676] font-semibold">{money(c.revenue)}</span>
              </div>
            ))}
            {(d.by_cashier || []).length === 0 && <p className="text-[#52525B] text-sm">Нет данных</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
