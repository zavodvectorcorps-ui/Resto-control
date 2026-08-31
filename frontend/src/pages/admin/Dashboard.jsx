import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { TrendingUp, ShoppingBag, Receipt, Wallet, AlertTriangle } from "lucide-react";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

function Stat({ icon: Icon, label, value, color, testId }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 fade-up" data-testid={testId}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">{label}</span>
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

  const { data: lowStock = [] } = useQuery({
    queryKey: ["inventory-alerts"],
    queryFn: async () => (await api.get("/inventory/alerts")).data,
  });

  const d = data || {};
  return (
    <div>
      <h1 className="font-head text-3xl font-extrabold mb-1">Панель управления</h1>
      <p className="text-[var(--ink-dim)] mb-8">Обзор показателей заведения</p>

      {lowStock.length > 0 && (
        <Link to="/admin/inventory" data-testid="low-stock-widget"
          className="flex items-center gap-4 bg-[var(--warning-soft)] border border-[var(--warning)]/40 rounded-xl p-5 mb-8 hover:border-[var(--warning)] transition-colors">
          <div className="w-10 h-10 rounded-lg bg-[var(--warning)]/20 text-[var(--warning)] flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[var(--ink)]">Заканчивается на складе: {lowStock.length} {lowStock.length === 1 ? "позиция" : "позиций"}</div>
            <div className="text-sm text-[var(--ink-dim)] truncate">
              {lowStock.slice(0, 4).map((s) => `${s.name} (${s.balance} ${s.measure})`).join(", ")}
              {lowStock.length > 4 ? ` и ещё ${lowStock.length - 4}` : ""}
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Stat icon={Wallet} label="Выручка сегодня" value={money(d.revenue_today)} color="var(--accent)" testId="stat-revenue-today" />
        <Stat icon={ShoppingBag} label="Заказов сегодня" value={d.orders_today ?? 0} color="var(--info)" testId="stat-orders-today" />
        <Stat icon={Receipt} label="Средний чек" value={money(d.avg_check)} color="var(--success)" testId="stat-avg-check" />
        <Stat icon={TrendingUp} label="Выручка всего" value={money(d.total_revenue)} color="var(--accent)" testId="stat-total-revenue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-6">Выручка за 7 дней</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.revenue_7days || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => v?.slice(5)} stroke="var(--ink-faint)" fontSize={12} />
              <YAxis stroke="var(--ink-faint)" fontSize={12} />
              <Tooltip
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--ink)" }}
                cursor={{ fill: "rgba(128,128,128,0.08)" }}
              />
              <Bar dataKey="revenue" fill="var(--accent)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
          <h3 className="font-head text-lg font-bold mb-6">Топ позиций</h3>
          <div className="space-y-4">
            {(d.top_products || []).length === 0 && (
              <p className="text-[var(--ink-faint)] text-sm">Пока нет продаж</p>
            )}
            {(d.top_products || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--ink-dim)]">
                    {i + 1}
                  </span>
                  <span className="text-sm">{p.name}</span>
                </div>
                <span className="text-sm font-semibold tabnum text-[var(--accent)]">{money(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
