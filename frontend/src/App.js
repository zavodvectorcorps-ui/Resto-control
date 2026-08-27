import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import AdminLayout from "@/pages/admin/AdminLayout";
import Dashboard from "@/pages/admin/Dashboard";
import Menu from "@/pages/admin/Menu";
import Workshops from "@/pages/admin/Workshops";
import Tables from "@/pages/admin/Tables";
import Inventory from "@/pages/admin/Inventory";
import Printers from "@/pages/admin/Printers";
import Staff from "@/pages/admin/Staff";
import Reports from "@/pages/admin/Reports";
import Clients from "@/pages/admin/Clients";
import Loyalty from "@/pages/admin/Loyalty";
import Reservations from "@/pages/admin/Reservations";
import Settings from "@/pages/admin/Settings";
import Pos from "@/pages/pos/Pos";

function Protected({ roles, children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="h-screen flex items-center justify-center text-[#A1A1AA]">Загрузка…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === "manager" ? "/admin" : "/pos"} replace />;
  }
  return children;
}

function Root() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "manager" ? "/admin" : "/pos"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/pos"
          element={
            <Protected roles={["waiter", "admin"]}>
              <Pos />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected roles={["manager"]}>
              <AdminLayout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="menu" element={<Menu />} />
          <Route path="workshops" element={<Workshops />} />
          <Route path="tables" element={<Tables />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="printers" element={<Printers />} />
          <Route path="staff" element={<Staff />} />
          <Route path="clients" element={<Clients />} />
          <Route path="loyalty" element={<Loyalty />} />
          <Route path="reservations" element={<Reservations />} />
          <Route path="settings" element={<Settings />} />
          <Route path="reports" element={<Reports />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
