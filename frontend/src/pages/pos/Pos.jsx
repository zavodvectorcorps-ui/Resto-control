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
  Receipt, ArrowRightLeft, Scissors, Check, AlertTriangle,
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
  const [precheck, setPrecheck] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitSel, setSplitSel] = useState({});
  const [billPicker, setBillPicker] = useState(null);
  const [voidConfirm, setVoidConfirm] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidPin, setVoidPin] = useState("");
  const [modPicker, setModPicker] = useState(null); // { product, groups }
  const [modSel, setModSel] = useState({}); // { [group_id]: [option, ...] }
  const [clientPhone, setClientPhone] = useState("");
  const [client, setClient] = useState(null);
  const [discountSource, setDiscountSource] = useState(null);
  const [bonusRedeem, setBonusRedeem] = useState("");

  const { data: shift, refetch: refetchShift } = useQuery({ queryKey: ["shift"], queryFn: async () => (await api.get("/shifts/current")).data });
  const { data: tables = [], refetch: refetchTables } = useQuery({ queryKey: ["pos-tables"], queryFn: async () => (await api.get("/tables")).data });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: async () => (await api.get("/products")).data });
  const { data: modGroups = [] } = useQuery({ queryKey: ["modifier-groups"], queryFn: async () => (await api.get("/modifier-groups")).data });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data });

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
    const orders = t.open_orders && t.open_orders.length ? t.open_orders : (t.open_order ? [t.open_order] : []);
    if (orders.length > 1) { setBillPicker({ table: t, orders }); return; }
    if (orders.length === 1) {
      store.loadCart(orders[0].items, orders[0].id, t.id, t.name);
    } else {
      store.loadCart([], null, t.id, t.name);
    }
    setView("order");
  };

  const openBill = (order, t) => {
    store.loadCart(order.items, order.id, t.id, t.name);
    setBillPicker(null);
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
    const { data: order } = await api.get(`/orders/${id}`);
    store.loadCart(order.items, id, store.tableId, store.tableName);
    refetchTables();
    toast.success("Заказ отправлен на кухню");
  };

  const requestBill = async () => {
    const id = store.orderId || (await saveOrder());
    if (!id) return;
    try {
      const { data } = await api.post(`/orders/${id}/request-bill`);
      setPrecheck(data.job);
      toast.success("Пречек отправлен на печать");
    } catch (e) { toast.error(apiErr(e)); }
  };

  const doMove = async (tid) => {
    const id = store.orderId || (await saveOrder());
    if (!id) return;
    try {
      await api.post(`/orders/${id}/move`, { table_id: tid });
      const t = tables.find((x) => x.id === tid);
      store.setTable(tid, t?.name || "");
      setMoveOpen(false);
      refetchTables();
      toast.success(`Перенесено на ${t?.name}`);
    } catch (e) { toast.error(apiErr(e)); }
  };

  const doSplit = async () => {
    const id = store.orderId || (await saveOrder());
    if (!id) return;
    const indices = Object.entries(splitSel).filter(([, v]) => v).map(([idx]) => Number(idx));
    if (!indices.length) { toast.error("Выберите позиции для отдельного счёта"); return; }
    try {
      const { data } = await api.post(`/orders/${id}/split`, { indices });
      store.loadCart(data.original.items, data.original.id, store.tableId, store.tableName);
      setSplitOpen(false);
      setSplitSel({});
      refetchTables();
      toast.success(`Отдельный счёт создан: ${money(data.split.total)}`);
    } catch (e) { toast.error(apiErr(e)); }
  };

  const requestVoid = (index, it) => {
    if (it.print_status === "printed") {
      setVoidReason(""); setVoidPin("");
      setVoidConfirm({ index, name: it.name, count: it.count });
      return;
    }
    // неотправленная позиция — убираем локально и синхронизируем с сервером
    const remaining = store.cart.filter((_, i) => i !== index);
    store.removeItem(index);
    if (store.orderId) {
      if (remaining.length === 0) {
        api.delete(`/orders/${store.orderId}`).then(() => backToTables()).catch(() => {});
      } else {
        api.put(`/orders/${store.orderId}`, { items: remaining }).then(() => refetchTables()).catch(() => {});
      }
    }
  };

  const confirmVoid = async () => {
    if (!voidReason.trim()) { toast.error("Укажите причину удаления"); return; }
    if (user.role !== "admin" && !voidPin.trim()) { toast.error("Введите PIN администратора"); return; }
    const index = voidConfirm.index;
    setVoidConfirm(null);
    await voidItem(index, voidReason.trim(), voidPin.trim());
    setVoidReason(""); setVoidPin("");
  };

  const voidItem = async (index, reason, pin) => {
    if (!store.orderId) { store.removeItem(index); return; }
    try {
      const opts = (reason || pin) ? { data: { reason, confirm_pin: pin } } : {};
      const { data } = await api.delete(`/orders/${store.orderId}/items/${index}`, opts);
      if (data.deleted || !data.order) {
        toast.success("Заказ отменён");
        backToTables();
        return;
      }
      store.loadCart(data.order.items, store.orderId, store.tableId, store.tableName);
      refetchTables();
      if (data.void_job) toast.success("СТОРНО отправлено на цех");
    } catch (e) { toast.error(apiErr(e)); }
  };

  const onProductClick = (p) => {
    const groups = modGroups.filter((g) => (p.modifier_group_ids || []).includes(g.id));
    if (groups.length) { setModSel({}); setModPicker({ product: p, groups }); return; }
    store.addItem(p);
  };

  const toggleModOption = (group, opt) => {
    setModSel((prev) => {
      const cur = prev[group.id] || [];
      const exists = cur.find((o) => o.option_id === opt.id);
      let next;
      if (group.selection_type === "single") {
        next = exists ? [] : [{ group_id: group.id, option_id: opt.id, name: opt.name, price_delta: opt.price_delta }];
      } else {
        if (exists) next = cur.filter((o) => o.option_id !== opt.id);
        else {
          if (cur.length >= (group.max_count || 99)) { toast.error(`Максимум ${group.max_count} в «${group.name}»`); return prev; }
          next = [...cur, { group_id: group.id, option_id: opt.id, name: opt.name, price_delta: opt.price_delta }];
        }
      }
      return { ...prev, [group.id]: next };
    });
  };

  const confirmModifiers = () => {
    for (const g of modPicker.groups) {
      const sel = modSel[g.id] || [];
      if (g.min_count > 0 && sel.length < g.min_count) {
        toast.error(`Выберите минимум ${g.min_count} в «${g.name}»`); return;
      }
    }
    const selected = modPicker.groups.flatMap((g) => modSel[g.id] || []);
    store.addItem(modPicker.product, selected);
    setModPicker(null); setModSel({});
  };

  const lookupClient = async (phone) => {
    setClientPhone(phone);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4) { setClient(null); return; }
    try {
      const { data } = await api.get(`/clients?phone=${digits}`);
      setClient(data);
      setDiscount(((subtotal * (data.discount_percent || 0)) / 100).toFixed(2));
      setDiscountSource(`client:${data.name}`);
    } catch { setClient(null); }
  };

  const doPay = async () => {
    const id = await saveOrder();
    if (!id) return;
    try {
      const { data } = await api.post(`/orders/${id}/pay`, {
        payment_method: pay, discount: Number(discount),
        client_id: client?.id || null,
        discount_source: discountSource || (Number(discount) > 0 ? "manual" : null),
        bonus_redeem_amount: Number(bonusRedeem || 0),
      });
      setReceipt(data);
      setCheckout(false);
      setDiscount(0); setClient(null); setClientPhone(""); setDiscountSource(null); setBonusRedeem("");
      store.clear();
      setView("tables");
      refetchTables();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Оплачено");
    } catch (e) { toast.error(apiErr(e)); }
  };

  const backToTables = () => { store.clear(); setView("tables"); refetchTables(); };

  const subtotal = store.subtotal();
  const canPay = user.role === "admin";

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
          {user.role === "waiter" ? (
            <p className="text-[#A1A1AA] mb-8">Обратитесь к кассиру или администратору, чтобы открыть смену</p>
          ) : (
            <>
              <p className="text-[#A1A1AA] mb-8">Откройте смену, чтобы принимать заказы</p>
              <button onClick={openShift} data-testid="open-shift-btn"
                className="bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg px-8 py-4 font-semibold text-lg active:scale-95 transition-transform">
                Открыть смену
              </button>
            </>
          )}
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
                {t.open_orders && t.open_orders.length ? (
                  <div className="text-sm text-[#FF5A00] font-semibold mt-1 tabnum">
                    {money(t.open_total)}{t.open_orders.length > 1 ? ` · ${t.open_orders.length} счёта` : ""}
                  </div>
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
                <button key={p.id} onClick={() => onProductClick(p)} data-testid={`pos-product-${p.id}`}
                  className="bg-[#1A1A1A] border border-[#27272A] rounded-lg p-4 flex flex-col items-start gap-2 hover:border-[#FF5A00] active:scale-95 transition-all text-left min-h-[100px]">
                  <Utensils size={16} className="text-[#52525B]" />
                  <span className="font-medium text-sm leading-tight">{p.name}</span>
                  {(p.modifier_group_ids || []).length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#A855F711] text-[#A855F7] font-semibold">модификаторы</span>}
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
              {store.cart.map((it, index) => {
                const printed = it.print_status === "printed";
                return (
                  <div key={index} className="bg-[#1A1A1A] border border-[#27272A] rounded-lg p-3" data-testid={`cart-item-${index}`}>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-medium flex items-center gap-2">
                        {it.name}
                        {printed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00E5FF11] text-[#00E5FF] font-semibold">отправлено</span>}
                      </span>
                      <button onClick={() => requestVoid(index, it)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`void-${index}`} title={printed ? "Сторно" : "Удалить"}><Trash2 size={14} /></button>
                    </div>
                    {(it.selected_modifiers || []).length > 0 && (
                      <div className="mb-2 pl-2 border-l-2 border-[#27272A] space-y-0.5" data-testid={`cart-mods-${index}`}>
                        {(it.selected_modifiers || []).map((m, mi) => (
                          <div key={mi} className="text-[11px] text-[#A1A1AA] flex justify-between">
                            <span>+ {m.name}</span>
                            {m.price_delta ? <span className="tabnum text-[#52525B]">+{money(m.price_delta)}</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      {printed ? (
                        <span className="text-sm text-[#A1A1AA] tabnum">× {it.count}</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button onClick={() => store.changeCount(index, -1)} data-testid={`dec-${index}`}
                            className="w-7 h-7 rounded-md bg-[#0A0A0A] border border-[#27272A] flex items-center justify-center hover:border-[#FF5A00]"><Minus size={14} /></button>
                          <span className="w-6 text-center tabnum">{it.count}</span>
                          <button onClick={() => store.changeCount(index, 1)} data-testid={`inc-${index}`}
                            className="w-7 h-7 rounded-md bg-[#0A0A0A] border border-[#27272A] flex items-center justify-center hover:border-[#FF5A00]"><Plus size={14} /></button>
                        </div>
                      )}
                      <span className="tabnum font-semibold text-[#FF5A00]">{money((it.price + (it.selected_modifiers || []).reduce((a, m) => a + (m.price_delta || 0), 0)) * it.count)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[#27272A] p-4 space-y-3">
              <div className="flex justify-between text-lg font-head font-bold">
                <span>Итого</span>
                <span className="tabnum text-[#FF5A00]" data-testid="cart-total">{money(subtotal)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={requestBill} disabled={store.cart.length === 0} data-testid="request-bill-btn"
                  className="bg-[#1A1A1A] border border-[#27272A] hover:border-[#FACC15] text-[#FACC15] rounded-lg py-2.5 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-40 flex flex-col items-center gap-1">
                  <Receipt size={16} /> Счёт
                </button>
                <button onClick={() => setMoveOpen(true)} disabled={!store.orderId && store.cart.length === 0} data-testid="move-btn"
                  className="bg-[#1A1A1A] border border-[#27272A] hover:border-[#A855F7] text-[#A855F7] rounded-lg py-2.5 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-40 flex flex-col items-center gap-1">
                  <ArrowRightLeft size={16} /> Перенос
                </button>
                <button onClick={() => { setSplitSel({}); setSplitOpen(true); }} disabled={store.cart.length < 2} data-testid="split-btn"
                  className="bg-[#1A1A1A] border border-[#27272A] hover:border-[#00E676] text-[#00E676] rounded-lg py-2.5 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-40 flex flex-col items-center gap-1">
                  <Scissors size={16} /> Разделить
                </button>
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
                <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Клиент (телефон)</label>
                <input value={clientPhone} onChange={(e) => lookupClient(e.target.value)} data-testid="client-phone-input"
                  placeholder="+7 900 000-00-00"
                  className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
                {client && (
                  <div className="mt-2 flex items-center justify-between bg-[#00E67611] border border-[#00E676]/30 rounded-lg px-3 py-2 text-sm" data-testid="client-match">
                    <span className="text-[#00E676] font-medium">{client.name}</span>
                    <span className="text-[#A1A1AA]">скидка {client.discount_percent}%</span>
                  </div>
                )}
                {client && Number(client.bonus_balance) > 0 && (
                  <div className="mt-2" data-testid="bonus-block">
                    <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Списать бонусы (доступно {Number(client.bonus_balance).toFixed(2)})</label>
                    <input type="number" value={bonusRedeem} onChange={(e) => setBonusRedeem(e.target.value)} data-testid="bonus-redeem-input"
                      placeholder="0"
                      className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#00E676]" />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Скидка (₽)</label>
                <input type="number" value={discount} onChange={(e) => { setDiscount(e.target.value); setDiscountSource("manual"); }} data-testid="discount-input"
                  className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
                {Number(discount) > 0 && (
                  <p className="text-[11px] text-[#A1A1AA] mt-1" data-testid="discount-source">
                    Источник: {discountSource === "manual" ? "Ручная" : discountSource?.startsWith("client:") ? `Клиент (${client?.discount_percent || 0}%)` : "—"}
                  </p>
                )}
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
                <span className="tabnum text-[#FF5A00]" data-testid="pay-total">{(() => {
                  const afterDisc = Math.max(0, subtotal - Number(discount || 0));
                  const maxPct = settings?.max_bonus_payment_percent ?? 50;
                  const cap = Math.round(afterDisc * maxPct) / 100;
                  const bonus = client ? Math.min(Number(bonusRedeem || 0), Number(client.bonus_balance || 0), cap) : 0;
                  return money(Math.max(0, afterDisc - bonus));
                })()}</span>
              </div>
              {client && Number(bonusRedeem) > 0 && (() => {
                const afterDisc = Math.max(0, subtotal - Number(discount || 0));
                const maxPct = settings?.max_bonus_payment_percent ?? 50;
                const cap = Math.round(afterDisc * maxPct) / 100;
                const bonus = Math.min(Number(bonusRedeem || 0), Number(client.bonus_balance || 0), cap);
                return <p className="text-xs text-[#00E676] -mt-2" data-testid="bonus-applied-hint">Будет списано {money(bonus)} бонусов (лимит {maxPct}% от чека){bonus < Number(bonusRedeem) ? ", введённая сумма ограничена" : ""}</p>;
              })()}
              <button onClick={doPay} data-testid="confirm-pay-btn"
                className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-4 font-semibold text-lg active:scale-95 transition-transform">
                Принять оплату
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modifier picker modal */}
      {modPicker && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setModPicker(null)}>
          <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="modifier-picker">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-head text-xl font-bold">{modPicker.product.name}</h3>
              <button onClick={() => setModPicker(null)} data-testid="modpicker-close"><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="space-y-5">
              {modPicker.groups.map((g) => (
                <div key={g.id} data-testid={`modpicker-group-${g.id}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{g.name}</span>
                    <span className="text-[11px] text-[#52525B]">
                      {g.min_count > 0 ? "обязательно · " : ""}{g.selection_type === "single" ? "один" : `до ${g.max_count}`}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(g.options || []).map((o) => {
                      const on = (modSel[g.id] || []).some((x) => x.option_id === o.id);
                      return (
                        <button key={o.id} onClick={() => toggleModOption(g, o)} data-testid={`modpicker-option-${o.id}`}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${on ? "border-[#FF5A00] bg-[#FF5A0011] text-white" : "border-[#27272A] bg-[#0A0A0A] text-[#A1A1AA]"}`}>
                          <span>{o.name}</span>
                          <span className="tabnum">{o.price_delta ? `+${money(o.price_delta)}` : "—"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-5 pt-4 border-t border-[#27272A]">
              <span className="text-[#A1A1AA] text-sm">Доплата</span>
              <span className="tabnum text-[#FF5A00] font-bold">
                {money(modPicker.groups.flatMap((g) => modSel[g.id] || []).reduce((a, m) => a + (m.price_delta || 0), 0))}
              </span>
            </div>
            <button onClick={confirmModifiers} data-testid="modpicker-confirm"
              disabled={modPicker.groups.some((g) => (g.min_count || 0) > 0 && (modSel[g.id] || []).length < g.min_count)}
              className="w-full mt-4 bg-[#FF5A00] hover:bg-[#E04F00] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg py-3.5 font-semibold active:scale-95 transition-transform">
              Добавить в заказ
            </button>
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

      {/* Void confirmation (сторно уже отправленной позиции) */}
      {voidConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setVoidConfirm(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-xl bg-[#FF3B3011] text-[#FF3B30] flex items-center justify-center mb-4">
              <AlertTriangle size={24} />
            </div>
            <h3 className="font-head text-xl font-bold mb-2">Сторнировать позицию?</h3>
            <p className="text-sm text-[#A1A1AA] mb-4">
              «{voidConfirm.name}» ×{voidConfirm.count} уже отправлена на цех. Будет напечатан чек <span className="text-white font-semibold">СТОРНО</span>. Действие записывается в отчёт.
            </p>
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} data-testid="void-reason-input"
              placeholder="Причина удаления (обязательно)"
              className="w-full mb-3 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#FF3B30]" />
            {user.role !== "admin" && (
              <input value={voidPin} onChange={(e) => setVoidPin(e.target.value)} data-testid="void-pin-input" type="password"
                placeholder="PIN администратора"
                className="w-full mb-4 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#FF3B30]" />
            )}
            <div className="flex gap-3">
              <button onClick={() => setVoidConfirm(null)} data-testid="void-cancel-btn"
                className="flex-1 bg-[#1A1A1A] border border-[#27272A] hover:border-[#A1A1AA] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">
                Отмена
              </button>
              <button onClick={confirmVoid} data-testid="void-confirm-btn"
                className="flex-1 bg-[#FF3B30] hover:bg-[#e0342a] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">
                Сторнировать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill picker (несколько счетов на столе) */}
      {billPicker && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setBillPicker(null)}>
          <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-head text-xl font-bold">{billPicker.table.name}: выберите счёт</h3>
              <button onClick={() => setBillPicker(null)}><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="space-y-2">
              {billPicker.orders.map((o, i) => (
                <button key={o.id} onClick={() => openBill(o, billPicker.table)} data-testid={`bill-${i}`}
                  className="w-full flex items-center justify-between bg-[#1A1A1A] border border-[#27272A] hover:border-[#FF5A00] rounded-lg p-4 active:scale-95 transition-transform">
                  <span className="text-sm">Счёт {i + 1} · {o.items.length} поз.{o.note ? ` · ${o.note}` : ""}</span>
                  <span className="tabnum font-semibold text-[#FF5A00]">{money(o.total)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Move table modal */}
      {moveOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setMoveOpen(false)}>
          <div className="w-full max-w-lg bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-head text-xl font-bold">Перенести на стол</h3>
              <button onClick={() => setMoveOpen(false)}><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {tables.filter((t) => t.id !== store.tableId).map((t) => (
                <button key={t.id} onClick={() => doMove(t.id)} data-testid={`move-to-${t.id}`}
                  className={`rounded-lg p-4 border active:scale-95 transition-transform ${t.open_order ? "border-[#FF5A00] bg-[#1A1206]" : "border-[#27272A] bg-[#1A1A1A] hover:border-[#A855F7]"}`}>
                  <div className="font-head font-bold">{t.name}</div>
                  <div className="text-xs text-[#52525B]">{t.open_order ? "занят" : "свободен"}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Split bill modal */}
      {splitOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSplitOpen(false)}>
          <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-head text-xl font-bold">Разделить счёт</h3>
              <button onClick={() => setSplitOpen(false)}><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <p className="text-sm text-[#A1A1AA] mb-4">Отметьте позиции для отдельного счёта</p>
            <div className="space-y-2 mb-4">
              {store.cart.map((it, index) => {
                const sel = !!splitSel[index];
                return (
                  <button key={index} onClick={() => setSplitSel((s) => ({ ...s, [index]: !s[index] }))} data-testid={`split-item-${index}`}
                    className={`w-full flex items-center justify-between rounded-lg p-3 border ${sel ? "border-[#00E676] bg-[#00E67611]" : "border-[#27272A] bg-[#1A1A1A]"}`}>
                    <span className="flex items-center gap-2 text-sm">
                      <span className={`w-5 h-5 rounded flex items-center justify-center border ${sel ? "bg-[#00E676] border-[#00E676]" : "border-[#52525B]"}`}>
                        {sel && <Check size={13} className="text-black" />}
                      </span>
                      {it.name} ×{it.count}
                    </span>
                    <span className="tabnum text-[#FF5A00] font-semibold">{money(it.price * it.count)}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={doSplit} data-testid="confirm-split-btn"
              className="w-full bg-[#00E676] hover:bg-[#00c765] text-black rounded-lg py-3 font-semibold active:scale-95 transition-transform">
              Создать отдельный счёт
            </button>
          </div>
        </div>
      )}

      {/* Precheck modal */}
      {precheck && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPrecheck(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-head text-xl font-bold mb-4 flex items-center gap-2"><Receipt size={20} /> Пречек</h3>
            <div className="bg-white text-black rounded-lg p-4 font-mono text-xs whitespace-pre-wrap">{precheck.text}</div>
            <button onClick={() => setPrecheck(null)} data-testid="precheck-close-btn"
              className="w-full mt-4 bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">
              Готово
            </button>
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
                <div key={i}>
                  <div className="flex justify-between"><span>{it.name} ×{it.count}</span><span>{it.total.toFixed(2)}</span></div>
                  {(it.selected_modifiers || []).map((m, mi) => (
                    <div key={mi} className="flex justify-between text-[10px] pl-2"><span>+ {m.name}</span><span>{m.price_delta ? `+${m.price_delta.toFixed(2)}` : ""}</span></div>
                  ))}
                </div>
              ))}
              {receipt.client_name && <div className="flex justify-between mt-2 text-xs"><span>Клиент</span><span>{receipt.client_name}</span></div>}
              {receipt.discount > 0 && <div className="flex justify-between mt-1"><span>Скидка{receipt.discount_percent ? ` (${receipt.discount_percent}%)` : ""}</span><span>-{receipt.discount.toFixed(2)}</span></div>}
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
        {shift && user.role === "admin" && (
          <button onClick={onCloseShift} data-testid="close-shift-btn" className="text-sm text-[#A1A1AA] hover:text-[#FF3B30] flex items-center gap-1">
            <Power size={16} /> Закрыть смену
          </button>
        )}
        <button onClick={onLogout} data-testid="pos-logout-btn" className="text-[#A1A1AA] hover:text-[#FF3B30]"><LogOut size={18} /></button>
      </div>
    </div>
  );
}
