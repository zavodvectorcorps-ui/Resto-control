import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Delete, ChefHat, ShieldCheck, Users } from "lucide-react";

const BG = "https://images.pexels.com/photos/13343442/pexels-photo-13343442.jpeg";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState("staff"); // staff | admin
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("admin@resto.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

  const doPin = async (value) => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/pin-login", { pin: value });
      login(data.token, data.user);
      toast.success(`Добро пожаловать, ${data.user.name}`);
      nav(data.user.role === "manager" ? "/admin" : "/pos");
    } catch (e) {
      toast.error(apiErr(e));
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const press = (d) => {
    if (loading) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length >= 4) {
      // auto-submit at 4; allow up to 6 by delaying
      if (next.length === 4) setTimeout(() => doPin(next), 150);
    }
  };

  const doAdmin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      login(data.token, data.user);
      toast.success("Вход выполнен");
      nav("/admin");
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex w-1/2 relative">
        <img src={BG} alt="kitchen" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0A0A0A] via-[#0A0A0A]/70 to-transparent" />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#FF5A00] flex items-center justify-center">
              <ChefHat size={22} />
            </div>
            <span className="font-head text-2xl font-extrabold">RestoControl</span>
          </div>
          <div>
            <h1 className="font-head text-5xl font-extrabold leading-tight">
              Учёт и контроль<br />вашего заведения
            </h1>
            <p className="text-[#A1A1AA] mt-4 max-w-md text-lg">
              Касса, склад, меню и аналитика — в одной системе. Отдельные рабочие места для официантов, кассиров и администраторов.
            </p>
          </div>
          <div className="text-[#52525B] text-sm">© 2026 RestoControl</div>
        </div>
      </div>

      {/* Right auth panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm fade-up">
          <div className="flex gap-2 mb-8 p-1 bg-[#121212] border border-[#27272A] rounded-lg">
            <button
              data-testid="mode-staff-btn"
              onClick={() => setMode("staff")}
              className={`flex-1 py-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                mode === "staff" ? "bg-[#FF5A00] text-white" : "text-[#A1A1AA] hover:text-white"
              }`}
            >
              <Users size={16} /> Официант / Администратор
            </button>
            <button
              data-testid="mode-admin-btn"
              onClick={() => setMode("admin")}
              className={`flex-1 py-3 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                mode === "admin" ? "bg-[#FF5A00] text-white" : "text-[#A1A1AA] hover:text-white"
              }`}
            >
              <ShieldCheck size={16} /> Менеджер
            </button>
          </div>

          {mode === "staff" ? (
            <div>
              <h2 className="font-head text-2xl font-bold mb-1">Введите PIN-код</h2>
              <p className="text-[#A1A1AA] text-sm mb-6">Демо: официант 1111, администратор 2222</p>
              <div className="flex justify-center gap-3 mb-8" data-testid="pin-dots">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full transition-colors ${
                      i < pin.length ? "bg-[#FF5A00]" : "bg-[#27272A]"
                    } ${i >= 4 && pin.length < 5 ? "opacity-30" : ""}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    data-testid={`pin-key-${n}`}
                    onClick={() => press(String(n))}
                    className="bg-[#1A1A1A] border border-[#27272A] rounded-lg text-2xl font-medium h-16 flex items-center justify-center hover:bg-[#27272A] active:scale-95 transition-transform"
                  >
                    {n}
                  </button>
                ))}
                <button
                  data-testid="pin-submit"
                  onClick={() => pin.length >= 4 && doPin(pin)}
                  className="bg-[#1A1A1A] border border-[#27272A] rounded-lg text-sm font-medium h-16 flex items-center justify-center hover:bg-[#27272A] active:scale-95 transition-transform text-[#00E676]"
                >
                  OK
                </button>
                <button
                  data-testid="pin-key-0"
                  onClick={() => press("0")}
                  className="bg-[#1A1A1A] border border-[#27272A] rounded-lg text-2xl font-medium h-16 flex items-center justify-center hover:bg-[#27272A] active:scale-95 transition-transform"
                >
                  0
                </button>
                <button
                  data-testid="pin-clear"
                  onClick={() => setPin(pin.slice(0, -1))}
                  className="bg-[#1A1A1A] border border-[#27272A] rounded-lg h-16 flex items-center justify-center hover:bg-[#27272A] active:scale-95 transition-transform"
                >
                  <Delete size={22} />
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={doAdmin}>
              <h2 className="font-head text-2xl font-bold mb-1">Вход менеджера</h2>
              <p className="text-[#A1A1AA] text-sm mb-6">Демо: admin@resto.com / admin123</p>
              <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Email</label>
              <input
                data-testid="admin-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 mb-4 bg-[#121212] border border-[#27272A] rounded-lg px-4 py-3 focus:border-[#FF5A00] outline-none"
              />
              <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Пароль</label>
              <input
                data-testid="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full mt-1 mb-6 bg-[#121212] border border-[#27272A] rounded-lg px-4 py-3 focus:border-[#FF5A00] outline-none"
              />
              <button
                data-testid="admin-login-btn"
                disabled={loading}
                className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3.5 font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                {loading ? "Вход…" : "Войти"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
