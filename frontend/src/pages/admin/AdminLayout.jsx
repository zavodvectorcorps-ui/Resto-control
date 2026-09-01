import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { StatusIndicators } from "@/components/StatusIndicators";
import api from "@/lib/api";
import {
  LayoutDashboard, UtensilsCrossed, Factory, Grid3x3, Warehouse,
  Users, BarChart3, LogOut, ChefHat, Printer, Contact, Gift, CalendarClock, Settings, ChevronDown, Wallet, Sun, Moon,
} from "lucide-react";

// Плоский аккордеон (как у Poster): один открытый раздел — плоский список
// внутри, без дальнейшей вложенности. Отдельно от групп — "Панель управления"
// и "Отчёты" остаются верхнеуровневыми (это основные точки входа, не прячем).
const NAV = [
  { type: "link", to: "/admin", icon: LayoutDashboard, label: "Панель управления", end: true },
  { type: "group", key: "menu", icon: UtensilsCrossed, label: "Меню и склад", items: [
    { to: "/admin/menu", icon: UtensilsCrossed, label: "Меню" },
    { to: "/admin/workshops", icon: Factory, label: "Цеха" },
    { to: "/admin/inventory", icon: Warehouse, label: "Склад" },
  ]},
  { type: "group", key: "hall", icon: Grid3x3, label: "Зал", items: [
    { to: "/admin/tables", icon: Grid3x3, label: "Столы" },
    { to: "/admin/reservations", icon: CalendarClock, label: "Резервы" },
  ]},
  { type: "group", key: "clients", icon: Contact, label: "Клиенты", items: [
    { to: "/admin/clients", icon: Contact, label: "Клиенты" },
    { to: "/admin/loyalty", icon: Gift, label: "Лояльность" },
  ]},
  { type: "group", key: "org", icon: Settings, label: "Заведение", items: [
    { to: "/admin/staff", icon: Users, label: "Сотрудники" },
    { to: "/admin/printers", icon: Printer, label: "Печать" },
    { to: "/admin/settings", icon: Settings, label: "Справочники" },
  ]},
  { type: "link", to: "/admin/finance", icon: Wallet, label: "Финансы" },
  { type: "link", to: "/admin/reports", icon: BarChart3, label: "Отчёты" },
];

const groupOfPath = (pathname) =>
  NAV.find((it) => it.type === "group" && it.items.some((i) => pathname.startsWith(i.to)))?.key || null;

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
      : "text-[var(--ink-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
  }`;

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const nav = useNavigate();
  const location = useLocation();
  const [restaurants, setRestaurants] = useState([]);
  const [currentRid, setCurrentRid] = useState("");
  const [openGroup, setOpenGroup] = useState(() => groupOfPath(location.pathname));
  const [lowStockCount, setLowStockCount] = useState(0);

  useEffect(() => {
    const g = groupOfPath(location.pathname);
    if (g) setOpenGroup(g);
  }, [location.pathname]);

  useEffect(() => {
    api.get("/restaurants").then((r) => setRestaurants(r.data)).catch(() => {});
    api.get("/restaurants/current").then((r) => setCurrentRid(r.data?.id || "")).catch(() => {});
    api.get("/inventory/alerts").then((r) => setLowStockCount(r.data.length)).catch(() => {});
  }, []);

  const switchRestaurant = async (rid) => {
    if (!rid || rid === currentRid) return;
    try {
      const { data } = await api.post(`/restaurants/switch/${rid}`);
      localStorage.setItem("resto_token", data.token);
      window.location.reload();
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <aside className="w-64 fixed left-0 top-0 h-full border-r border-[var(--border)] bg-[var(--bg)] flex flex-col">
        <div className="flex items-center gap-3 px-6 h-16 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0">
            <ChefHat size={20} className="text-white" />
          </div>
          <span className="font-head text-lg font-extrabold text-[var(--ink)]">RestoControl</span>
        </div>
        <div className="px-3 pt-3">
          <StatusIndicators variant="admin" />
        </div>
        {restaurants.length > 1 && (
          <div className="px-3 pt-3">
            <select value={currentRid} onChange={(e) => switchRestaurant(e.target.value)} data-testid="restaurant-switcher"
              className="w-full bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((it) => {
            if (it.type === "link") {
              return (
                <NavLink key={it.to} to={it.to} end={it.end}
                  data-testid={`nav-${it.to.split("/").pop() || "dashboard"}`}
                  className={linkClass}>
                  <it.icon size={18} /> {it.label}
                </NavLink>
              );
            }
            const isOpen = openGroup === it.key;
            const hasActive = it.items.some((i) => location.pathname.startsWith(i.to));
            return (
              <div key={it.key}>
                <button
                  onClick={() => setOpenGroup(isOpen ? null : it.key)}
                  data-testid={`nav-group-${it.key}`}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    hasActive && !isOpen ? "text-[var(--ink)]" : "text-[var(--ink-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                  }`}
                >
                  <it.icon size={18} />
                  <span className="flex-1 text-left">{it.label}</span>
                  {it.key === "menu" && lowStockCount > 0 && (
                    <span data-testid="low-stock-badge" className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--warning)] text-[#1a1400] text-[10px] font-bold flex items-center justify-center">{lowStockCount}</span>
                  )}
                  <ChevronDown size={15} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="ml-4 pl-3 border-l border-[var(--border)] space-y-1 mt-1 mb-1">
                    {it.items.map((sub) => (
                      <NavLink key={sub.to} to={sub.to} data-testid={`nav-${sub.to.split("/").pop()}`} className={linkClass}>
                        <sub.icon size={16} /> {sub.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-[var(--ink-faint)] truncate">{user?.name}</span>
            <button onClick={toggleTheme} data-testid="theme-toggle"
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[var(--ink-dim)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)] transition-colors">
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--ink-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] transition-colors"
          >
            <LogOut size={18} /> Выйти
          </button>
        </div>
      </aside>
      <main className="ml-64 p-8 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
