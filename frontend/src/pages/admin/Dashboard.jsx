import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { TrendingUp, ShoppingBag, Receipt, Wallet } from "lucide-react";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

function Stat({ icon: Icon, label, value, color, testId }) {
  return (
    <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" data-testid={testId}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">{label}</span>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}22`, color }}>
          <Icon size={18} />
        </div>
      </div>
      <div className="font-head text-3xl font-extrabold tabnum" data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/reports/dashboard")).data,
  });

  const d = data || {};
  return (
    <div>
      <h1 className="font-head text-3xl font-extrabold mb-1">Панель управления</h1>
      <p className="text-[#A1A1AA] mb-8">Обзор показателей заведения</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Stat icon={Wallet} label="Выручка сегодня" value={money(d.revenue_today)} color="#FF5A00" testId="stat-revenue-today" />
        <Stat icon={ShoppingBag} label="Заказов сегодня" value={d.orders_today ?? 0} color="#00E5FF" testId="stat-orders-today" />
        <Stat icon={Receipt} label="Средний чек" value={money(d.avg_check)} color="#00E676" testId="stat-avg-check" />
        <Stat icon={TrendingUp} label="Выручка всего" value={money(d.total_revenue)} color="#FF5A00" testId="stat-total-revenue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-6">Выручка за 7 дней</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.revenue_7days || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => v?.slice(5)} stroke="#52525B" fontSize={12} />
              <YAxis stroke="#52525B" fontSize={12} />
              <Tooltip
                contentStyle={{ background: "#1A1A1A", border: "1px solid #27272A", borderRadius: 8, color: "#fff" }}
                cursor={{ fill: "#ffffff08" }}
              />
              <Bar dataKey="revenue" fill="#FF5A00" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-6">Топ позиций</h3>
          <div className="space-y-4">
            {(d.top_products || []).length === 0 && (
              <p className="text-[#52525B] text-sm">Пока нет продаж</p>
            )}
            {(d.top_products || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-[#1A1A1A] border border-[#27272A] flex items-center justify-center text-xs text-[#A1A1AA]">
                    {i + 1}
                  </span>
                  <span className="text-sm">{p.name}</span>
                </div>
                <span className="text-sm font-semibold tabnum text-[#FF5A00]">{money(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
