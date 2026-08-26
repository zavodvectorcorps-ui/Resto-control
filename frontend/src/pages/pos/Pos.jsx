import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api, { apiErr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { usePosStore } from "@/store/posStore";
import { toast } from "sonner";
import {
  ChefHat, LogOut, Plus, Minus, Trash2, Send, CreditCard, Grid3x3,
  ArrowLeft, Power, Printer, Banknote, X, Utensils,
} from "lucide-react";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

export default function Pos() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const store = usePosStore();

  const [view, setView] = useState("tables"); // tables | order
  const [activeCat, setActiveCat] = useState(null);
  const [checkout, setCheckout] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [pay, setPay] = useState("cash");
  const [tickets, setTickets] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const { data: shift, refetch: refetchShift } = useQuery({ queryKey: ["shift"], queryFn: async () => (await api.get("/shifts/current")).data });
  const { data: tables = [], refetch: refetchTables } = useQuery({ queryKey: ["pos-tables"], queryFn: async () => (await api.get("/tables")).data });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: async () => (await api.get("/products")).data });

  const cat = activeCat || categories[0]?.id;
  const shownProducts = useMemo(
    () => products.filter((p) => p.for_sale !== false && (!cat || p.category_id === cat)),
    [products, cat]
  );

  const openShift = async () => { await api.post("/shifts/open"); refetchShift(); toast.success("Смена открыта"); };
  const closeShift = async () => {
    try {
      const { data } = await api.post("/shifts/close");
      refetchShift();
      toast.success(`Смена закрыта. Выручка: ${money(data.total_sales)}`);
    } catch (e) { toast.error(apiErr(e)); }
  };

  const selectTable = async (t) => {
    if (t.open_order) {
      store.loadCart(t.open_order.items, t.open_order.id, t.id, t.name);
    } else {
      store.loadCart([], null, t.id, t.name);
    }
    setView("order");
  };

  const saveOrder = async () => {
    const items = store.cart;
    if (items.length === 0) { toast.error("Добавьте позиции"); return null; }
    try {
      if (store.orderId) {
        await api.put(`/orders/${store.orderId}`, { items });
        return store.orderId;
      } else {
        const { data } = await api.post("/orders", { table_id: store.tableId, items });
        store.setOrder(data.id);
        return data.id;
      }
    } catch (e) { toast.error(apiErr(e)); return null; }
  };

  const sendKitchen = async () => {
    const id = await saveOrder();
    if (!id) return;
    const { data } = await api.post(`/orders/${id}/send`);
    setTickets(data.tickets);
    refetchTables();
    toast.success("Заказ отправлен на кухню");
  };

  const doPay = async () => {
    const id = await saveOrder();
    if (!id) return;
    try {
      const { data } = await api.post(`/orders/${id}/pay`, { payment_method: pay, discount: Number(discount) });
      setReceipt(data);
      setCheckout(false);
      setDiscount(0);
      store.clear();
      setView("tables");
      refetchTables();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Оплачено");
    } catch (e) { toast.error(apiErr(e)); }
  };

  const backToTables = () => { store.clear(); setView("tables"); refetchTables(); };

  const subtotal = store.subtotal();
  const canPay = user.role === "cashier" || user.role === "admin";

  // ---- No shift open ----
  if (shift === null) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0A0A0A]">
        <PosTopBar user={user} shift={shift} onLogout={() => { logout(); nav("/login"); }} onCloseShift={closeShift} floating />
        <div className="text-center fade-up">
          <div className="w-16 h-16 rounded-2xl bg-[#FF5A00] flex items-center justify-center mx-auto mb-6">
            <Power size={30} />
          </div>
          <h1 className="font-head text-3xl font-extrabold mb-2">Смена не открыта</h1>
          <p className="text-[#A1A1AA] mb-8">Откройте смену, чтобы принимать заказы</p>
          <button onClick={openShift} data-testid="open-shift-btn"
            className="bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg px-8 py-4 font-semibold text-lg active:scale-95 transition-transform">
            Открыть смену
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0A0A0A] overflow-hidden">
      <PosTopBar user={user} shift={shift} onLogout={() => { logout(); nav("/login"); }} onCloseShift={closeShift} />

      {view === "tables" ? (
        <div className="flex-1 overflow-y-auto p-8">
          <h2 className="font-head text-2xl font-bold mb-6">Выберите стол</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {tables.map((t) => (
              <button key={t.id} onClick={() => selectTable(t)} data-testid={`pos-table-${t.id}`}
                className={`rounded-xl p-6 border text-left active:scale-95 transition-transform ${
                  t.open_order ? "border-[#FF5A00] bg-[#1A1206]" : "border-[#27272A] bg-[#121212] hover:border-[#FF5A00]"
                }`}>
                <Grid3x3 size={22} className="text-[#A1A1AA] mb-3" />
                <div className="font-head font-bold text-lg">{t.name}</div>
                {t.open_order ? (
                  <div className="text-sm text-[#FF5A00] font-semibold mt-1 tabnum">{money(t.open_order.total)}</div>
                ) : (
                  <div className="text-sm text-[#52525B] mt-1">Свободен</div>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: categories */}
          <div className="w-[18%] min-w-[160px] border-r border-[#27272A] flex flex-col">
            <button onClick={backToTables} data-testid="pos-back-btn"
              className="flex items-center gap-2 px-4 py-4 text-[#A1A1AA] hover:text-white border-b border-[#27272A]">
              <ArrowLeft size={18} /> {store.tableName}
            </button>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {categories.map((c) => (
                <button key={c.id} onClick={() => setActiveCat(c.id)} data-testid={`pos-cat-${c.id}`}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    cat === c.id ? "bg-[#1A1A1A] text-white border-l-2 border-[#FF5A00]" : "text-[#A1A1AA] hover:bg-[#121212]"
                  }`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Center: products */}
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {shownProducts.map((p) => (
                <button key={p.id} onClick={() => store.addItem(p)} data-testid={`pos-product-${p.id}`}
                  className="bg-[#1A1A1A] border border-[#27272A] rounded-lg p-4 flex flex-col items-start gap-2 hover:border-[#FF5A00] active:scale-95 transition-all text-left min-h-[100px]">
                  <Utensils size={16} className="text-[#52525B]" />
                  <span className="font-medium text-sm leading-tight">{p.name}</span>
                  <span className="text-[#FF5A00] font-bold tabnum mt-auto">{money(p.price)}</span>
                </button>
              ))}
              {shownProducts.length === 0 && <p className="text-[#52525B] col-span-full">Нет позиций в категории</p>}
            </div>
          </div>

          {/* Right: order ticket */}
          <div className="w-[30%] min-w-[300px] border-l border-[#27272A] bg-[#121212] flex flex-col">
            <div className="px-5 py-4 border-b border-[#27272A]">
              <h3 className="font-head font-bold text-lg">Заказ · {store.tableName}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {store.cart.length === 0 && <p className="text-[#52525B] text-sm text-center mt-8">Добавьте позиции из меню</p>}
              {store.cart.map((it) => (
                <div key={it.product_id} className="bg-[#1A1A1A] border border-[#27272A] rounded-lg p-3" data-testid={`cart-item-${it.product_id}`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium">{it.name}</span>
                    <button onClick={() => store.removeItem(it.product_id)} className="text-[#52525B] hover:text-[#FF3B30]"><Trash2 size={14} /></button>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <button onClick={() => store.changeCount(it.product_id, -1)} data-testid={`dec-${it.product_id}`}
                        className="w-7 h-7 rounded-md bg-[#0A0A0A] border border-[#27272A] flex items-center justify-center hover:border-[#FF5A00]"><Minus size={14} /></button>
                      <span className="w-6 text-center tabnum">{it.count}</span>
                      <button onClick={() => store.changeCount(it.product_id, 1)} data-testid={`inc-${it.product_id}`}
                        className="w-7 h-7 rounded-md bg-[#0A0A0A] border border-[#27272A] flex items-center justify-center hover:border-[#FF5A00]"><Plus size={14} /></button>
                    </div>
                    <span className="tabnum font-semibold text-[#FF5A00]">{money(it.price * it.count)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-[#27272A] p-4 space-y-3">
              <div className="flex justify-between text-lg font-head font-bold">
                <span>Итого</span>
                <span className="tabnum text-[#FF5A00]" data-testid="cart-total">{money(subtotal)}</span>
              </div>
              <button onClick={sendKitchen} disabled={store.cart.length === 0} data-testid="send-kitchen-btn"
                className="w-full bg-[#1A1A1A] border border-[#27272A] hover:border-[#00E5FF] text-[#00E5FF] rounded-lg py-3 font-semibold active:scale-95 transition-transform disabled:opacity-40 flex items-center justify-center gap-2">
                <Send size={18} /> Отправить на кухню
              </button>
              {canPay && (
                <button onClick={() => setCheckout(true)} disabled={store.cart.length === 0} data-testid="checkout-btn"
                  className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3.5 font-semibold active:scale-95 transition-transform disabled:opacity-40 flex items-center justify-center gap-2">
                  <CreditCard size={18} /> Оплатить
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkout && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setCheckout(false)}>
          <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-head text-xl font-bold">Оплата</h3>
              <button onClick={() => setCheckout(false)} data-testid="checkout-close-btn"><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between text-[#A1A1AA]"><span>Сумма</span><span className="tabnum">{money(subtotal)}</span></div>
              <div>
                <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Скидка (₽)</label>
                <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="discount-input"
                  className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPay("cash")} data-testid="pay-cash"
                  className={`rounded-lg py-4 flex flex-col items-center gap-2 border ${pay === "cash" ? "border-[#00E676] bg-[#00E67611] text-[#00E676]" : "border-[#27272A] text-[#A1A1AA]"}`}>
                  <Banknote size={22} /> Наличные
                </button>
                <button onClick={() => setPay("card")} data-testid="pay-card"
                  className={`rounded-lg py-4 flex flex-col items-center gap-2 border ${pay === "card" ? "border-[#00E5FF] bg-[#00E5FF11] text-[#00E5FF]" : "border-[#27272A] text-[#A1A1AA]"}`}>
                  <CreditCard size={22} /> Карта
                </button>
              </div>
              <div className="flex justify-between text-2xl font-head font-extrabold pt-2 border-t border-[#27272A]">
                <span>К оплате</span>
                <span className="tabnum text-[#FF5A00]">{money(Math.max(0, subtotal - Number(discount)))}</span>
              </div>
              <button onClick={doPay} data-testid="confirm-pay-btn"
                className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-4 font-semibold text-lg active:scale-95 transition-transform">
                Принять оплату
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kitchen tickets modal */}
      {tickets && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setTickets(null)}>
          <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-head text-xl font-bold flex items-center gap-2"><Printer size={20} /> Печать на цеха</h3>
              <button onClick={() => { setTickets(null); backToTables(); }} data-testid="tickets-close-btn"><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="space-y-4">
              {Object.entries(tickets).map(([ws, items]) => (
                <div key={ws} className="bg-white text-black rounded-lg p-4 font-mono text-sm">
                  <div className="font-bold border-b border-dashed border-black pb-1 mb-2">ЦЕХ: {ws}</div>
                  {items.map((it, i) => (
                    <div key={i} className="flex justify-between"><span>{it.name}</span><span>×{it.count}</span></div>
                  ))}
                </div>
              ))}
              <button onClick={() => window.print()} data-testid="print-tickets-btn" className="w-full bg-[#1A1A1A] border border-[#27272A] hover:border-[#00E5FF] text-[#00E5FF] rounded-lg py-3 font-semibold flex items-center justify-center gap-2">
                <Printer size={18} /> Печать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {receipt && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setReceipt(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-head text-xl font-bold mb-4">Чек оплачен</h3>
            <div className="bg-white text-black rounded-lg p-5 font-mono text-sm">
              <div className="text-center font-bold mb-2">RESTOCONTROL</div>
              <div className="border-b border-dashed border-black mb-2 pb-2 text-center text-xs">Чек · {(receipt.closed_at || "").slice(0, 16).replace("T", " ")}</div>
              {receipt.items.map((it, i) => (
                <div key={i} className="flex justify-between"><span>{it.name} ×{it.count}</span><span>{it.total.toFixed(2)}</span></div>
              ))}
              {receipt.discount > 0 && <div className="flex justify-between mt-2"><span>Скидка</span><span>-{receipt.discount.toFixed(2)}</span></div>}
              <div className="flex justify-between font-bold border-t border-dashed border-black mt-2 pt-2">
                <span>ИТОГО</span><span>{receipt.total.toFixed(2)} ₽</span>
              </div>
              <div className="text-center text-xs mt-2">Оплата: {receipt.payment_method === "cash" ? "наличные" : "карта"}</div>
            </div>
            <button onClick={() => setReceipt(null)} data-testid="receipt-close-btn"
              className="w-full mt-4 bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PosTopBar({ user, shift, onLogout, onCloseShift, floating }) {
  return (
    <div className={`h-16 border-b border-[#27272A] bg-[#0A0A0A] flex items-center justify-between px-6 ${floating ? "w-full absolute top-0" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#FF5A00] flex items-center justify-center"><ChefHat size={20} /></div>
        <span className="font-head text-lg font-extrabold">RestoControl</span>
        {shift && <span className="ml-3 text-xs px-2 py-1 rounded-md bg-[#00E67611] text-[#00E676] font-semibold">Смена открыта</span>}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-[#A1A1AA]">{user.name}</span>
        {shift && (user.role === "cashier" || user.role === "admin") && (
          <button onClick={onCloseShift} data-testid="close-shift-btn" className="text-sm text-[#A1A1AA] hover:text-[#FF3B30] flex items-center gap-1">
            <Power size={16} /> Закрыть смену
          </button>
        )}
        <button onClick={onLogout} data-testid="pos-logout-btn" className="text-[#A1A1AA] hover:text-[#FF3B30]"><LogOut size={18} /></button>
      </div>
    </div>
  );
}
