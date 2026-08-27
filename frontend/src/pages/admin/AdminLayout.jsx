import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  LayoutDashboard, UtensilsCrossed, Factory, Grid3x3, Warehouse,
  Users, BarChart3, LogOut, ChefHat, Monitor, Printer, Contact, Gift, CalendarClock, Settings,
} from "lucide-react";

const items = [
  { to: "/admin", icon: LayoutDashboard, label: "Панель управления", end: true },
  { to: "/admin/menu", icon: UtensilsCrossed, label: "Меню" },
  { to: "/admin/workshops", icon: Factory, label: "Цеха" },
  { to: "/admin/tables", icon: Grid3x3, label: "Столы" },
  { to: "/admin/inventory", icon: Warehouse, label: "Склад" },
  { to: "/admin/printers", icon: Printer, label: "Печать" },
  { to: "/admin/staff", icon: Users, label: "Сотрудники" },
  { to: "/admin/clients", icon: Contact, label: "Клиенты" },
  { to: "/admin/loyalty", icon: Gift, label: "Лояльность" },
  { to: "/admin/reservations", icon: CalendarClock, label: "Резервы" },
  { to: "/admin/settings", icon: Settings, label: "Справочники" },
  { to: "/admin/reports", icon: BarChart3, label: "Отчёты" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [restaurants, setRestaurants] = useState([]);
  const [currentRid, setCurrentRid] = useState("");

  useEffect(() => {
    api.get("/restaurants").then((r) => setRestaurants(r.data)).catch(() => {});
    api.get("/restaurants/current").then((r) => setCurrentRid(r.data?.id || "")).catch(() => {});
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
    <div className="min-h-screen bg-[#0A0A0A]">
      <aside className="w-64 fixed left-0 top-0 h-full border-r border-[#27272A] bg-[#0A0A0A] flex flex-col">
        <div className="flex items-center gap-3 px-6 h-16 border-b border-[#27272A]">
          <div className="w-9 h-9 rounded-lg bg-[#FF5A00] flex items-center justify-center">
            <ChefHat size={20} />
          </div>
          <span className="font-head text-lg font-extrabold">RestoControl</span>
        </div>
        {restaurants.length > 1 && (
          <div className="px-3 pt-3">
            <select value={currentRid} onChange={(e) => switchRestaurant(e.target.value)} data-testid="restaurant-switcher"
              className="w-full bg-[#121212] border border-[#27272A] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FF5A00]">
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={`nav-${it.to.split("/").pop() || "dashboard"}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#1A1A1A] text-white border-l-2 border-[#FF5A00]"
                    : "text-[#A1A1AA] hover:bg-[#121212] hover:text-white"
                }`
              }
            >
              <it.icon size={18} /> {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[#27272A] space-y-1">
          <div className="px-3 py-2 text-xs text-[#52525B]">{user?.name}</div>
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[#A1A1AA] hover:bg-[#121212] hover:text-[#FF3B30] transition-colors"
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
