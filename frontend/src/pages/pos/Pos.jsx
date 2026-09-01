import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api, { apiErr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { usePosStore } from "@/store/posStore";
import { toast } from "sonner";
import {
  ChefHat, LogOut, Plus, Minus, Trash2, Send, CreditCard, Grid3x3,
  ArrowLeft, Power, Printer, Banknote, X, Utensils, Search,
  Receipt, ArrowRightLeft, Scissors, Check, AlertTriangle, MessageSquare, Wallet,
  User, Tag,
} from "lucide-react";
import { FloorPlan, hallsOf, sortTablesForList, tableStateClasses } from "@/components/admin/FloorPlan";
import { StatusIndicators } from "@/components/StatusIndicators";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useOfflineQueueFlush } from "@/hooks/useOfflineQueueFlush";
import { enqueue as enqueueOffline, isNetworkError, isQueued as isQueuedOffline } from "@/lib/offlineQueue";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

export default function Pos() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const store = usePosStore();
  const online = useConnectionStatus();

  const [view, setView] = useState("tables"); // tables | order
  const [activeHall, setActiveHall] = useState(null);
  const [activeCat, setActiveCat] = useState(null);
  const [prodSearch, setProdSearch] = useState("");
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
  const [scEnabled, setScEnabled] = useState(false);
  const [cashMove, setCashMove] = useState(null); // { type }
  const [cashAmt, setCashAmt] = useState("");
  const [cashReason, setCashReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [commentFor, setCommentFor] = useState(null); // cart index
  const [commentText, setCommentText] = useState("");
  const [zReport, setZReport] = useState(null);
  const [debtWarn, setDebtWarn] = useState(null);
  const [discountRisk, setDiscountRisk] = useState(null); // orderId, если нужна причина скидки после пречека
  const [discountRiskReason, setDiscountRiskReason] = useState("");
  const [openCashPrompt, setOpenCashPrompt] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState("");
  const [closeCashPrompt, setCloseCashPrompt] = useState(false);
  const [actualCashInput, setActualCashInput] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const toggleStop = async (p, e) => {
    e.stopPropagation();
    try {
      if (p.is_available) await api.post(`/pos/stop-list/${p.id}`);
      else await api.delete(`/pos/stop-list/${p.id}`);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) { toast.error(apiErr(err)); }
  };

  const { data: shift, refetch: refetchShift } = useQuery({ queryKey: ["shift"], queryFn: async () => (await api.get("/shifts/current")).data });
  const { data: tables = [], refetch: refetchTables } = useQuery({ queryKey: ["pos-tables"], queryFn: async () => (await api.get("/tables")).data, refetchInterval: 4000 });
  const pendingSyncCount = useOfflineQueueFlush(online, refetchTables);
  const posHalls = useMemo(() => hallsOf(tables), [tables]);
  useEffect(() => {
    if (posHalls.length && !posHalls.includes(activeHall)) setActiveHall(posHalls[0]);
  }, [posHalls, activeHall]);
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: async () => (await api.get("/products")).data });
  const { data: modGroups = [] } = useQuery({ queryKey: ["modifier-groups"], queryFn: async () => (await api.get("/modifier-groups")).data });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data });
  const { data: methods = [] } = useQuery({ queryKey: ["payment-methods"], queryFn: async () => (await api.get("/payment-methods")).data });
  const { data: quickComments = [] } = useQuery({ queryKey: ["quick-comments"], queryFn: async () => (await api.get("/quick-comments")).data });
  useEffect(() => { if (settings?.service_charge_default_enabled != null) setScEnabled(settings.service_charge_default_enabled); }, [settings]);

  const cat = activeCat || categories[0]?.id;
  const searchQ = prodSearch.trim().toLowerCase();
  const shownProducts = useMemo(() => {
    if (searchQ) return products.filter((p) => p.for_sale !== false && p.name.toLowerCase().includes(searchQ));
    return products.filter((p) => p.for_sale !== false && (!cat || p.category_id === cat));
  }, [products, cat, searchQ]);

  const openShift = () => { setZReport(null); setOpeningCashInput(""); setOpenCashPrompt(true); };
  const confirmOpenShift = async () => {
    await api.post("/shifts/open", { opening_cash: Number(openingCashInput || 0) });
    setOpenCashPrompt(false);
    refetchShift();
    toast.success("Смена открыта");
  };
  const closeShift = () => { setActualCashInput(""); setCloseCashPrompt(true); };
  const confirmCloseShift = async () => {
    try {
      const { data } = await api.post("/shifts/close", {
        actual_cash: actualCashInput === "" ? null : Number(actualCashInput),
      });
      setCloseCashPrompt(false);
      refetchShift();
      setZReport(data);
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

  const saveOrderRaw = async () => {
    const items = store.cart;
    if (items.length === 0) { toast.error("Добавьте позиции"); return null; }
    if (store.orderId) {
      await api.put(`/orders/${store.orderId}`, { items });
      return store.orderId;
    }
    const { data } = await api.post("/orders", { table_id: store.tableId, items });
    store.setOrder(data.id);
    return data.id;
  };

  const saveOrder = async () => {
    try {
      return await saveOrderRaw();
    } catch (e) { toast.error(apiErr(e)); return null; }
  };

  const sendKitchen = async () => {
    const items = store.cart;
    if (items.length === 0) { toast.error("Добавьте позиции"); return; }
    try {
      const id = await saveOrderRaw();
      if (!id) return;
      const { data } = await api.post(`/orders/${id}/send`);
      setTickets(data.tickets && data.tickets.length ? data.tickets : null);
      const { data: order } = await api.get(`/orders/${id}`);
      store.loadCart(order.items, id, store.tableId, store.tableName);
      refetchTables();
      toast.success("Заказ отправлен на кухню");
    } catch (e) {
      if (isNetworkError(e)) {
        enqueueOffline({ kind: "send", tableId: store.tableId, tableName: store.tableName, orderId: store.orderId, items });
        toast.error("Нет связи — заказ поставлен в очередь, отправится на кухню автоматически", { duration: 6000 });
        return;
      }
      toast.error(apiErr(e));
    }
  };

  const fireCourse = async (courseNumber) => {
    try {
      const id = await saveOrder();
      if (!id) return;
      const { data } = await api.post(`/orders/${id}/send?course=${courseNumber}`);
      setTickets(data.tickets && data.tickets.length ? data.tickets : null);
      const { data: order } = await api.get(`/orders/${id}`);
      store.loadCart(order.items, id, store.tableId, store.tableName);
      refetchTables();
      if (data.tickets && data.tickets.length) toast.success(`Подача ${courseNumber} отправлена на кухню`);
      else toast(`В подаче ${courseNumber} нет новых позиций`);
    } catch (e) { toast.error(apiErr(e)); }
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
    if (p.is_available === false) { toast.error(`«${p.name}» в стоп-листе`); return; }
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

  const payableTotal = () => {
    const afterDisc = Math.max(0, subtotal - Number(discount || 0));
    const maxPct = settings?.max_bonus_payment_percent ?? 50;
    const cap = Math.round(afterDisc * maxPct) / 100;
    const bonus = client ? Math.min(Number(bonusRedeem || 0), Number(client.bonus_balance || 0), cap) : 0;
    const sc = scEnabled ? Math.round(subtotal * (settings?.service_charge_percent || 0)) / 100 : 0;
    return Math.max(0, afterDisc - bonus + sc);
  };

  const executePay = async (riskReason) => {
    setDebtWarn(null);
    const items = store.cart;
    const payBody = {
      payment_method: pay, discount: Number(discount),
      client_id: client?.id || null,
      discount_source: discountSource || (Number(discount) > 0 ? "manual" : null),
      bonus_redeem_amount: Number(bonusRedeem || 0),
      reason: riskReason || undefined,
    };
    let id = store.orderId;
    try {
      id = await saveOrderRaw();
      if (!id) return;
      await api.patch(`/orders/${id}/service-charge`, { enabled: scEnabled });
      const { data } = await api.post(`/orders/${id}/pay`, payBody);
      setReceipt(data);
      setCheckout(false);
      setDiscount(0); setClient(null); setClientPhone(""); setDiscountSource(null); setBonusRedeem("");
      setDiscountRisk(null); setDiscountRiskReason("");
      store.clear();
      setView("tables");
      refetchTables();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Оплачено");
    } catch (e) {
      if (isNetworkError(e)) {
        enqueueOffline({ kind: "pay", tableId: store.tableId, tableName: store.tableName, orderId: store.orderId, items, payBody, scEnabled });
        setCheckout(false);
        setDiscount(0); setClient(null); setClientPhone(""); setDiscountSource(null); setBonusRedeem("");
        setDiscountRisk(null); setDiscountRiskReason("");
        store.clear();
        setView("tables");
        toast.success("Нет связи — оплата записана, гостя можно отпускать. Чек и синхронизация — как только появится связь", { duration: 8000 });
        return;
      }
      const msg = apiErr(e);
      if (msg.includes("Пречек уже печатался")) {
        setDiscountRisk(id);
        setDiscountRiskReason("");
        return;
      }
      toast.error(msg);
    }
  };

  const doPay = async () => {
    const method = methods.find((m) => m.code === pay);
    if (method?.is_debt && client && Number(client.credit_limit || 0) > 0) {
      const projected = Number(client.debt_balance || 0) + payableTotal();
      if (projected > Number(client.credit_limit)) {
        setDebtWarn({ projected, limit: Number(client.credit_limit), name: client.name, current: Number(client.debt_balance || 0) });
        return;
      }
    }
    await executePay();
  };

  const backToTables = () => { store.clear(); setView("tables"); setMobileCartOpen(false); setProdSearch(""); refetchTables(); };

  const doCashMove = async () => {
    if (!(Number(cashAmt) > 0)) { toast.error("Введите сумму больше 0"); return; }
    try {
      await api.post("/shifts/cash-movement", { type: cashMove.type, amount: Number(cashAmt), reason: cashReason });
      toast.success(cashMove.type === "in" ? "Внесение записано" : "Изъятие записано");
      setCashMove(null); setCashAmt(""); setCashReason("");
    } catch (e) { toast.error(apiErr(e)); }
  };

  const cancelOrder = async () => {
    if (!store.orderId) { setCancelOpen(false); backToTables(); return; }
    try {
      await api.delete(`/orders/${store.orderId}`, { data: { reason: cancelReason.trim() } });
      toast.success("Заказ отменён");
      setCancelOpen(false); setCancelReason("");
      backToTables();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const openComment = (index) => { setCommentText(store.cart[index]?.comment || ""); setCommentFor(index); };
  const saveComment = async () => {
    const idx = commentFor;
    const text = commentText.trim();
    store.setComment(idx, text);
    const items = store.cart.map((c, i) => (i === idx ? { ...c, comment: text || null } : c));
    setCommentFor(null); setCommentText("");
    if (store.orderId) { try { await api.put(`/orders/${store.orderId}`, { items }); refetchTables(); } catch (e) { toast.error(apiErr(e)); } }
  };

  const cartOrdered = useMemo(() => {
    const arr = store.cart.map((it, index) => ({ it, index }));
    arr.sort((a, b) => (a.it.course_number || 0) - (b.it.course_number || 0));
    return arr;
  }, [store.cart]);

  const courseHasPending = useMemo(() => {
    const m = {};
    store.cart.forEach((it) => { const c = it.course_number || 0; if (c && it.print_status !== "printed") m[c] = true; });
    return m;
  }, [store.cart]);

  const subtotal = store.subtotal();
  const canPay = user.role === "admin";

  // ---- No shift open ----
  const zReportModal = zReport && (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setZReport(null)}>
      <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="z-report-modal">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-head text-xl font-bold flex items-center gap-2"><Receipt size={20} /> Отчёт по смене (Z)</h3>
          <button onClick={() => setZReport(null)} data-testid="z-report-close-btn"><X size={20} className="text-[#A1A1AA]" /></button>
        </div>
        <div className="bg-white text-black rounded-lg p-5 font-mono text-sm" data-testid="z-report-receipt">
          <div className="text-center font-bold text-base">Z-ОТЧЁТ</div>
          <div className="text-center text-xs mb-2">{(user.restaurant_name || "RestoControl")}</div>
          <div className="border-t border-dashed border-black my-2" />
          <div className="flex justify-between"><span>Открыта</span><span>{(zReport.opened_at || "").slice(0, 16).replace("T", " ")}</span></div>
          <div className="flex justify-between"><span>Закрыта</span><span>{(zReport.closed_at || "").slice(0, 16).replace("T", " ")}</span></div>
          <div className="flex justify-between"><span>Чеков</span><span>{zReport.orders_count || 0}</span></div>
          <div className="border-t border-dashed border-black my-2" />
          <div className="font-bold">Выручка по способам оплаты:</div>
          {Object.entries(zReport.totals_by_method || {}).map(([code, val]) => (
            <div key={code} className="flex justify-between"><span>{methods.find((m) => m.code === code)?.name || code}</span><span>{money(val)}</span></div>
          ))}
          {Object.keys(zReport.totals_by_method || {}).length === 0 && <div className="text-center text-xs">— нет продаж —</div>}
          <div className="flex justify-between font-bold mt-1"><span>ИТОГО ВЫРУЧКА</span><span>{money(zReport.total_sales)}</span></div>
          {zReport.total_debt > 0 && <div className="flex justify-between"><span>В долг (не оплачено)</span><span>{money(zReport.total_debt)}</span></div>}
          <div className="border-t border-dashed border-black my-2" />
          <div className="font-bold">Касса (наличные):</div>
          <div className="flex justify-between"><span>Продажи наличными</span><span>{money(zReport.total_cash)}</span></div>
          <div className="flex justify-between"><span>Внесения</span><span>+{money(zReport.cash_in)}</span></div>
          <div className="flex justify-between"><span>Изъятия</span><span>-{money(zReport.cash_out)}</span></div>
          <div className="flex justify-between font-bold"><span>ОЖИДАЕМО В КАССЕ (книжный)</span><span>{money(zReport.expected_cash)}</span></div>
          {zReport.actual_cash != null && (
            <>
              <div className="flex justify-between"><span>Фактически пересчитано</span><span>{money(zReport.actual_cash)}</span></div>
              <div className="flex justify-between font-bold" style={{ color: zReport.cash_diff ? "#CC0000" : "#008800" }}>
                <span>Расхождение</span><span>{zReport.cash_diff > 0 ? "+" : ""}{money(zReport.cash_diff)}</span>
              </div>
            </>
          )}
          {(zReport.movements || []).length > 0 && (
            <>
              <div className="border-t border-dashed border-black my-2" />
              <div className="font-bold">Движения налички:</div>
              {(zReport.movements || []).map((m, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{m.type === "in" ? "Внесение" : "Изъятие"}{m.reason ? ` (${m.reason})` : ""}</span>
                  <span>{m.type === "in" ? "+" : "-"}{money(m.amount)}</span>
                </div>
              ))}
            </>
          )}
          <div className="border-t border-dashed border-black my-2" />
          <div className="text-center text-xs">Кассир: {user.name}</div>
        </div>
        <button onClick={() => window.print()} data-testid="z-report-print-btn"
          className="w-full mt-4 bg-[#1A1A1A] border border-[#27272A] hover:border-[#00E5FF] text-[#00E5FF] rounded-lg py-3 font-semibold flex items-center justify-center gap-2">
          <Printer size={18} /> Печать
        </button>
      </div>
    </div>
  );

  const openCashModal = openCashPrompt && (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setOpenCashPrompt(false)}>
      <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="open-cash-modal">
        <h3 className="font-head text-xl font-bold mb-4">Остаток в кассе на начало смены</h3>
        <input type="number" autoFocus value={openingCashInput} onChange={(e) => setOpeningCashInput(e.target.value)}
          placeholder="0" data-testid="opening-cash-input"
          className="w-full bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3 text-lg outline-none focus:border-[#FF5A00] mb-4" />
        <p className="text-xs text-[#A1A1AA] mb-4">Разменные деньги, которые физически лежат в кассе прямо сейчас. Нужны, чтобы при закрытии смены сверить книжный и фактический остаток.</p>
        <button onClick={confirmOpenShift} data-testid="confirm-open-shift-btn"
          className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold">Открыть смену</button>
      </div>
    </div>
  );

  const closeCashModal = closeCashPrompt && (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setCloseCashPrompt(false)}>
      <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="close-cash-modal">
        <h3 className="font-head text-xl font-bold mb-4">Сколько наличных в кассе?</h3>
        <input type="number" autoFocus value={actualCashInput} onChange={(e) => setActualCashInput(e.target.value)}
          placeholder="Пересчитайте и введите сумму" data-testid="actual-cash-input"
          className="w-full bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3 text-lg outline-none focus:border-[#FF5A00] mb-4" />
        <p className="text-xs text-[#A1A1AA] mb-4">Можно оставить пустым, если не сверяете — тогда расхождение не покажется в Z-отчёте.</p>
        <div className="flex gap-3">
          <button onClick={() => setCloseCashPrompt(false)} className="flex-1 bg-[#1A1A1A] border border-[#27272A] rounded-lg py-3 font-semibold text-[#A1A1AA]">Отмена</button>
          <button onClick={confirmCloseShift} data-testid="confirm-close-shift-btn"
            className="flex-1 bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold">Закрыть смену</button>
        </div>
      </div>
    </div>
  );

  if (shift === null) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0A0A0A] text-white">
        <PosTopBar user={user} shift={shift} onLogout={() => { logout(); nav("/login"); }} onCloseShift={closeShift} pendingSyncCount={pendingSyncCount} floating />
        {zReportModal}
        {openCashModal}
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

  const cartPanel = (
    <>
      <div className="px-5 py-4 border-b border-[#27272A] flex items-center justify-between">
        <h3 className="font-head font-bold text-lg">Заказ · {store.tableName}</h3>
        <button onClick={() => setMobileCartOpen(false)} className="md:hidden text-[#A1A1AA] hover:text-white" data-testid="mobile-cart-close-btn"><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {store.cart.length === 0 && <p className="text-[#52525B] text-sm text-center mt-8">Добавьте позиции из меню</p>}
        {(() => {
          let prevCourse = null;
          return cartOrdered.map(({ it, index }) => {
            const printed = it.print_status === "printed";
            const cn = it.course_number || 0;
            const header = cn && cn !== prevCourse ? cn : null;
            prevCourse = cn;
            return (
              <div key={index}>
                {header && (
                  <div className="flex items-center justify-between px-1 pt-1" data-testid={`course-header-${header}`}>
                    <span className="text-xs uppercase tracking-wider text-[#C084FC] font-bold">— Подача {header} —</span>
                    {courseHasPending[header] && (
                      <button onClick={() => fireCourse(header)} data-testid={`fire-course-${header}`}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md border border-[#00E5FF] text-[#00E5FF] hover:bg-[#00E5FF11] flex items-center gap-1 active:scale-95 transition-transform">
                        <Send size={12} /> Отправить подачу
                      </button>
                    )}
                  </div>
                )}
                <div className="bg-[#1A1A1A] border border-[#27272A] rounded-lg p-3" data-testid={`cart-item-${index}`}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      {it.name}
                      {printed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00E5FF11] text-[#00E5FF] font-semibold">отправлено</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openComment(index)} className="text-[#A1A1AA] hover:text-[#A855F7]" data-testid={`comment-${index}`} title="Комментарий"><MessageSquare size={14} /></button>
                      <button onClick={() => requestVoid(index, it)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`void-${index}`} title={printed ? "Сторно" : "Удалить"}><Trash2 size={14} /></button>
                    </div>
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
                  {it.comment && (
                    <div className="mb-2 text-xs text-[#C084FC] bg-[#C084FC11] rounded px-2 py-1 italic" data-testid={`cart-comment-${index}`}>✎ {it.comment}</div>
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
              </div>
            );
          });
        })()}
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
        {store.orderId && (
          <button onClick={() => { setCancelReason(""); setCancelOpen(true); }} data-testid="cancel-order-btn"
            className="w-full bg-[#1A1A1A] border border-[#27272A] hover:border-[#FF3B30] text-[#FF3B30] rounded-lg py-2 text-xs font-semibold active:scale-95 transition-transform flex items-center justify-center gap-2">
            <X size={14} /> Отменить заказ
          </button>
        )}
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
    </>
  );

  return (
    <div className="h-screen flex flex-col bg-[#0A0A0A] text-white overflow-hidden">
      <PosTopBar user={user} shift={shift} onLogout={() => { logout(); nav("/login"); }} onCloseShift={closeShift} onCash={() => { setCashAmt(""); setCashReason(""); setCashMove({ type: "in" }); }} pendingSyncCount={pendingSyncCount} />

      {view === "tables" ? (
        <div className="flex-1 flex flex-col overflow-hidden p-3 sm:p-5 pb-4">
          <div className="flex items-center justify-between mb-3 sm:mb-4 shrink-0 gap-2">
            <h2 className="font-head text-lg sm:text-xl font-bold">Выберите стол</h2>
            {posHalls.length > 1 && (
              <div className="flex bg-[#121212] border border-[#27272A] rounded-lg p-1 shrink-0" data-testid="pos-hall-tabs">
                {posHalls.map((hall) => (
                  <button key={hall} onClick={() => setActiveHall(hall)} data-testid={`pos-hall-tab-${hall}`}
                    className={`px-3 sm:px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
                      activeHall === hall ? "bg-[#FF5A00] text-white" : "text-[#A1A1AA] hover:text-white"
                    }`}>
                    {hall}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Телефон: список столов крупными плитками — карта зала, рассчитанная
              на широкий экран, на маленьком экране превращается в нечитаемую кашу. */}
          <div className="flex-1 min-h-0 overflow-y-auto md:hidden">
            {activeHall && (
              <div className="grid grid-cols-3 gap-2.5 pb-2" data-testid="pos-table-list">
                {sortTablesForList(tables.filter((t) => t.hall === activeHall)).map((t) => {
                  const cls = tableStateClasses(t, { variant: "pos", mode: "select", isMine: (tt) => tt.open_order?.waiter_id === user.id });
                  return (
                    <button key={t.id} onClick={() => selectTable(t)} data-testid={`pos-table-list-${t.id}`}
                      className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] px-2 py-4 min-h-[76px] active:scale-95 transition-transform ${cls}`}>
                      {isQueuedOffline(t.id) && (
                        <div className="absolute top-1.5 right-1.5 text-[#FACC15]" title="Есть несинхронизированные данные">
                          <Send size={11} />
                        </div>
                      )}
                      {t.is_service && <Tag size={10} className="absolute top-1.5 left-1.5 text-[#71717A]" />}
                      <div className={`font-head font-bold leading-tight ${t.is_service ? "text-[11px] text-[#A1A1AA]" : "text-lg"}`}>{t.name}</div>
                      {t.open_orders && t.open_orders.length ? (
                        <div className="text-xs font-semibold tabnum text-inherit">
                          {money(t.open_total)}{t.open_orders.length > 1 ? ` · ${t.open_orders.length}сч` : ""}
                        </div>
                      ) : !t.is_service ? (
                        <div className="text-[11px] text-[#52525B]">своб.</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Планшет/десктоп: визуальная карта зала как настроил админ. */}
          <div className="hidden md:flex flex-1 min-h-0 items-center justify-center">
            {activeHall && (
              <FloorPlan hall={activeHall} tables={tables.filter((t) => t.hall === activeHall)} mode="select" variant="pos" fit="height"
                isMine={(t) => t.open_order?.waiter_id === user.id}
                onSelect={selectTable}
                renderExtra={(t) => (
                  <>
                    {isQueuedOffline(t.id) && (
                      <div className="text-[9px] font-bold text-[#FACC15] flex items-center gap-0.5" title="Есть несинхронизированные данные">
                        <Send size={9} /> офлайн
                      </div>
                    )}
                    {t.open_orders && t.open_orders.length ? (
                      <div className="text-[11px] font-semibold tabnum text-inherit">
                        {money(t.open_total)}{t.open_orders.length > 1 ? ` · ${t.open_orders.length}сч` : ""}
                      </div>
                    ) : !t.is_service ? (
                      <div className="text-[10px] text-[#52525B]">своб.</div>
                    ) : null}
                  </>
                )}
              />
            )}
          </div>
        </div>
      ) : (
        <>
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left: categories (desktop) */}
          <div className="hidden md:flex w-[18%] min-w-[160px] border-r border-[#27272A] flex-col">
            <button onClick={backToTables} data-testid="pos-back-btn"
              className="flex items-center gap-2 px-4 py-4 text-[#A1A1AA] hover:text-white border-b border-[#27272A]">
              <ArrowLeft size={18} /> {store.tableName}
            </button>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {categories.map((c) => (
                <button key={c.id} onClick={() => { setActiveCat(c.id); setProdSearch(""); }} data-testid={`pos-cat-${c.id}`}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    !searchQ && cat === c.id ? "bg-[#1A1A1A] text-white border-l-2 border-[#FF5A00]" : "text-[#A1A1AA] hover:bg-[#121212]"
                  }`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Top: back + horizontal category chips (mobile) */}
          <div className="md:hidden border-b border-[#27272A] shrink-0">
            <button onClick={backToTables} data-testid="pos-back-btn-mobile"
              className="flex items-center gap-2 px-4 py-3 text-[#A1A1AA] hover:text-white">
              <ArrowLeft size={18} /> {store.tableName}
            </button>
            <div className="flex gap-2 overflow-x-auto px-3 pb-3">
              {categories.map((c) => (
                <button key={c.id} onClick={() => { setActiveCat(c.id); setProdSearch(""); }} data-testid={`pos-cat-mobile-${c.id}`}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    !searchQ && cat === c.id ? "bg-[#FF5A00] text-white" : "bg-[#1A1A1A] text-[#A1A1AA] border border-[#27272A]"
                  }`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Center: products */}
          <div className="flex-1 overflow-y-auto p-5 pb-24 md:pb-5">
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525B]" />
              <input value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} data-testid="pos-product-search"
                placeholder="Поиск блюда по названию…"
                className="w-full bg-[#1A1A1A] border border-[#27272A] rounded-lg pl-9 pr-4 py-3 text-sm outline-none focus:border-[#FF5A00]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {shownProducts.map((p) => (
                <button key={p.id} onClick={() => onProductClick(p)} data-testid={`pos-product-${p.id}`}
                  className={`relative bg-[#1A1A1A] border border-[#27272A] rounded-lg p-4 flex flex-col items-start gap-2 hover:border-[#FF5A00] active:scale-95 transition-all text-left min-h-[100px] ${p.is_available === false ? "opacity-40" : ""}`}>
                  <span onClick={(e) => toggleStop(p, e)} data-testid={`stop-toggle-${p.id}`}
                    className={`absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded font-bold ${p.is_available === false ? "bg-[#FF3B30] text-white" : "bg-[#27272A] text-[#52525B] hover:text-white"}`}>
                    {p.is_available === false ? "СТОП" : "⊘"}
                  </span>
                  <Utensils size={16} className="text-[#52525B]" />
                  <span className="font-medium text-sm leading-tight">{p.name}</span>
                  {(p.modifier_group_ids || []).length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#A855F711] text-[#A855F7] font-semibold">модификаторы</span>}
                  <span className="text-[#FF5A00] font-bold tabnum mt-auto">{money(p.price)}</span>
                </button>
              ))}
              {shownProducts.length === 0 && (
                <p className="text-[#52525B] col-span-full">{searchQ ? "Ничего не найдено" : "Нет позиций в категории"}</p>
              )}
            </div>
          </div>

          {/* Right: order ticket (desktop, inline) */}
          <div className="hidden md:flex w-[30%] min-w-[300px] border-l border-[#27272A] bg-[#121212] flex-col">
            {cartPanel}
          </div>
        </div>

        {/* Mobile: floating cart bar */}
        {store.cart.length > 0 && !mobileCartOpen && (
          <button onClick={() => setMobileCartOpen(true)} data-testid="mobile-cart-bar"
            className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#FF5A00] text-white px-5 py-4 flex items-center justify-between font-semibold active:scale-[0.98] transition-transform">
            <span className="flex items-center gap-2"><Receipt size={18} /> {store.cart.length} {store.cart.length === 1 ? "позиция" : "позиций"}</span>
            <span className="tabnum">{money(subtotal)} · Корзина</span>
          </button>
        )}

        {/* Mobile: fullscreen cart overlay */}
        {mobileCartOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-[#121212] flex flex-col">
            {cartPanel}
          </div>
        )}
        </>
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
                {(() => {
                  const eligibleSubtotal = store.cart.reduce((sum, it) => {
                    const prod = products.find((p) => p.id === it.product_id);
                    const eligible = prod ? (prod.discount_eligible ?? true) : true;
                    if (!eligible) return sum;
                    return sum + (it.price + (it.selected_modifiers || []).reduce((a, m) => a + (m.price_delta || 0), 0)) * it.count;
                  }, 0);
                  if (eligibleSubtotal >= subtotal) return null;
                  return (
                    <p className="text-[11px] text-[#FACC15] mt-1" data-testid="discount-cap-hint">
                      На часть позиций скидка не действует — максимум {eligibleSubtotal.toFixed(2)} ₽
                    </p>
                  );
                })()}
              </div>
              {Number(settings?.service_charge_percent) > 0 && (
                <label className="flex items-center justify-between bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3 cursor-pointer" data-testid="sc-toggle-row">
                  <span className="text-sm">Сервисный сбор {settings.service_charge_percent}%</span>
                  <input type="checkbox" checked={scEnabled} onChange={(e) => setScEnabled(e.target.checked)} className="accent-[#FF5A00] w-4 h-4" data-testid="sc-toggle" />
                </label>
              )}
              <div className="grid grid-cols-2 gap-3" data-testid="payment-methods">
                {methods.filter((m) => m.active).map((m) => {
                  const debtDisabled = m.is_debt && !client;
                  const Icon = m.code === "cash" ? Banknote : m.is_debt ? Wallet : CreditCard;
                  const active = pay === m.code;
                  const accent = m.is_debt ? "#FF3B30" : m.code === "card" ? "#00E5FF" : "#00E676";
                  return (
                    <button key={m.id} data-testid={`pay-${m.code}`} disabled={debtDisabled}
                      onClick={() => { if (debtDisabled) { toast.error("Для оплаты в долг выберите клиента"); return; } setPay(m.code); }}
                      className={`rounded-lg py-4 flex flex-col items-center gap-2 border text-sm ${active ? "text-white" : "text-[#A1A1AA] border-[#27272A]"} ${debtDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                      style={active ? { borderColor: accent, backgroundColor: accent + "11", color: accent } : {}}>
                      <Icon size={22} /> {m.name}
                    </button>
                  );
                })}
              </div>
              {methods.find((m) => m.code === pay)?.is_debt && (
                <p className="text-xs text-[#FF3B30] -mt-1" data-testid="debt-hint">Сумма будет записана в долг клиента {client?.name || ""}</p>
              )}
              <div className="flex justify-between text-2xl font-head font-extrabold pt-2 border-t border-[#27272A]">
                <span>К оплате</span>
                <span className="tabnum text-[#FF5A00]" data-testid="pay-total">{(() => {
                  const afterDisc = Math.max(0, subtotal - Number(discount || 0));
                  const maxPct = settings?.max_bonus_payment_percent ?? 50;
                  const cap = Math.round(afterDisc * maxPct) / 100;
                  const bonus = client ? Math.min(Number(bonusRedeem || 0), Number(client.bonus_balance || 0), cap) : 0;
                  const sc = scEnabled ? Math.round(subtotal * (settings?.service_charge_percent || 0)) / 100 : 0;
                  return money(Math.max(0, afterDisc - bonus + sc));
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
              <button onClick={() => setTickets(null)} data-testid="tickets-close-btn"><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="space-y-4">
              {(tickets || []).map((tk, ti) => (
                <div key={ti} className="bg-white text-black rounded-lg p-4 font-mono text-sm" data-testid={`ticket-block-${ti}`}>
                  <div className="font-bold border-b border-dashed border-black pb-1 mb-2 flex justify-between">
                    <span>ЦЕХ: {tk.workshop}</span>
                    {tk.course_number ? <span>Подача {tk.course_number}</span> : null}
                  </div>
                  {tk.items.map((it, i) => (
                    <div key={i}>
                      <div className="flex justify-between"><span>{it.name}</span><span>×{it.count}</span></div>
                      {it.comment && <div className="pl-3 text-[13px] italic">* {it.comment}</div>}
                    </div>
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
              <div className="text-center text-xs mt-2">Оплата: {receipt.is_debt ? "в долг" : (methods.find((m) => m.code === receipt.payment_method)?.name || receipt.payment_method)}</div>
            </div>
            <button onClick={() => setReceipt(null)} data-testid="receipt-close-btn"
              className="w-full mt-4 bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">
              Готово
            </button>
          </div>
        </div>
      )}
      {/* Cash movement modal (Задача 12) */}
      {cashMove && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setCashMove(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-head text-xl font-bold flex items-center gap-2"><Wallet size={20} /> Касса: движение налички</h3>
              <button onClick={() => setCashMove(null)} data-testid="cash-close-btn"><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button onClick={() => setCashMove({ type: "in" })} data-testid="cash-type-in"
                className={`rounded-lg py-3 border font-semibold ${cashMove.type === "in" ? "border-[#00E676] bg-[#00E67611] text-[#00E676]" : "border-[#27272A] text-[#A1A1AA]"}`}>Внесение</button>
              <button onClick={() => setCashMove({ type: "out" })} data-testid="cash-type-out"
                className={`rounded-lg py-3 border font-semibold ${cashMove.type === "out" ? "border-[#FF3B30] bg-[#FF3B3011] text-[#FF3B30]" : "border-[#27272A] text-[#A1A1AA]"}`}>Изъятие</button>
            </div>
            <input type="number" value={cashAmt} onChange={(e) => setCashAmt(e.target.value)} data-testid="cash-amount-input" placeholder="Сумма, ₽"
              className="w-full mb-3 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00]" />
            <input value={cashReason} onChange={(e) => setCashReason(e.target.value)} data-testid="cash-reason-input" placeholder="Причина (напр. размен, инкассация)"
              className="w-full mb-4 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#FF5A00]" />
            <button onClick={doCashMove} data-testid="cash-confirm-btn"
              className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">Записать</button>
          </div>
        </div>
      )}

      {/* Cancel order modal (Задача 12) */}
      {cancelOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setCancelOpen(false)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-xl bg-[#FF3B3011] text-[#FF3B30] flex items-center justify-center mb-4"><AlertTriangle size={24} /></div>
            <h3 className="font-head text-xl font-bold mb-2">Отменить заказ?</h3>
            <p className="text-sm text-[#A1A1AA] mb-4">Если заказ отправлен на кухню — укажите причину (запишется в отчёт).</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {quickComments.filter((c) => c.context === "cancel").map((c) => (
                <button key={c.id} onClick={() => setCancelReason(c.text)} data-testid={`cancel-qc-${c.id}`}
                  className={`text-xs px-3 py-1.5 rounded-full border ${cancelReason === c.text ? "border-[#FF3B30] text-[#FF3B30] bg-[#FF3B3011]" : "border-[#27272A] text-[#A1A1AA]"}`}>{c.text}</button>
              ))}
            </div>
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} data-testid="cancel-reason-input" placeholder="Причина отмены"
              className="w-full mb-4 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#FF3B30]" />
            <div className="flex gap-3">
              <button onClick={() => setCancelOpen(false)} data-testid="cancel-abort-btn"
                className="flex-1 bg-[#1A1A1A] border border-[#27272A] hover:border-[#A1A1AA] text-white rounded-lg py-3 font-semibold">Назад</button>
              <button onClick={cancelOrder} data-testid="cancel-confirm-btn"
                className="flex-1 bg-[#FF3B30] hover:bg-[#e0342a] text-white rounded-lg py-3 font-semibold">Отменить заказ</button>
            </div>
          </div>
        </div>
      )}

      {zReportModal}
      {closeCashModal}

      {/* Debt credit-limit warning (Долг — лимит) */}
      {debtWarn && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-center justify-center p-4" onClick={() => setDebtWarn(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="debt-warn-modal">
            <div className="w-12 h-12 rounded-xl bg-[#FACC1511] text-[#FACC15] flex items-center justify-center mb-4"><AlertTriangle size={24} /></div>
            <h3 className="font-head text-xl font-bold mb-2">Превышение лимита долга</h3>
            <p className="text-sm text-[#A1A1AA] mb-4">
              Клиент <span className="text-white font-semibold">{debtWarn.name}</span>. Текущий долг {money(debtWarn.current)}, после оплаты станет <span className="text-[#FF3B30] font-semibold">{money(debtWarn.projected)}</span> при лимите <span className="text-white">{money(debtWarn.limit)}</span>.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDebtWarn(null)} data-testid="debt-warn-cancel-btn"
                className="flex-1 bg-[#1A1A1A] border border-[#27272A] hover:border-[#A1A1AA] text-white rounded-lg py-3 font-semibold">Отмена</button>
              <button onClick={() => executePay()} data-testid="debt-warn-confirm-btn"
                className="flex-1 bg-[#FACC15] hover:bg-[#eab308] text-black rounded-lg py-3 font-semibold">Всё равно провести</button>
            </div>
          </div>
        </div>
      )}

      {discountRisk && (
        <div className="fixed inset-0 z-[65] bg-black/70 flex items-center justify-center p-4" onClick={() => setDiscountRisk(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="discount-risk-modal">
            <div className="w-12 h-12 rounded-xl bg-[#FACC1511] text-[#FACC15] flex items-center justify-center mb-4"><AlertTriangle size={24} /></div>
            <h3 className="font-head text-xl font-bold mb-2">Пречек уже печатался</h3>
            <p className="text-sm text-[#A1A1AA] mb-4">Гостю уже показывали сумму на пречеке — теперь она меняется скидкой. Укажите причину, это попадёт в отчёт «Чеки с риском».</p>
            <input value={discountRiskReason} onChange={(e) => setDiscountRiskReason(e.target.value)} autoFocus
              placeholder="Причина скидки" data-testid="discount-risk-reason-input"
              className="w-full bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-3 text-sm outline-none focus:border-[#FF5A00] mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setDiscountRisk(null)} className="flex-1 bg-[#1A1A1A] border border-[#27272A] hover:border-[#A1A1AA] text-white rounded-lg py-3 font-semibold">Отмена</button>
              <button onClick={() => executePay(discountRiskReason)} disabled={!discountRiskReason.trim()} data-testid="confirm-discount-risk-btn"
                className="flex-1 bg-[#FACC15] hover:bg-[#eab308] disabled:opacity-40 text-black rounded-lg py-3 font-semibold">Оплатить со скидкой</button>
            </div>
          </div>
        </div>
      )}

      {/* Item comment modal (Задача 12) */}
      {commentFor !== null && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setCommentFor(null)}>
          <div className="w-full max-w-sm bg-[#121212] border border-[#27272A] rounded-xl p-6 fade-up" onClick={(e) => e.stopPropagation()} data-testid="comment-modal">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-head text-xl font-bold flex items-center gap-2"><MessageSquare size={20} /> Комментарий к блюду</h3>
              <button onClick={() => setCommentFor(null)} data-testid="comment-close-btn"><X size={20} className="text-[#A1A1AA]" /></button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {quickComments.filter((c) => c.context === "dish").map((c) => (
                <button key={c.id} onClick={() => setCommentText(c.text)} data-testid={`dish-qc-${c.id}`}
                  className={`text-xs px-3 py-1.5 rounded-full border ${commentText === c.text ? "border-[#A855F7] text-[#A855F7] bg-[#A855F711]" : "border-[#27272A] text-[#A1A1AA]"}`}>{c.text}</button>
              ))}
            </div>
            <input value={commentText} onChange={(e) => setCommentText(e.target.value)} data-testid="comment-input" placeholder="Свой комментарий"
              className="w-full mb-4 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 text-sm outline-none focus:border-[#A855F7]" />
            <button onClick={saveComment} data-testid="comment-save-btn"
              className="w-full bg-[#FF5A00] hover:bg-[#E04F00] text-white rounded-lg py-3 font-semibold active:scale-95 transition-transform">Сохранить</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PosTopBar({ user, shift, onLogout, onCloseShift, onCash, floating, pendingSyncCount }) {
  return (
    <div className={`h-14 sm:h-16 border-b border-[#27272A] bg-[#0A0A0A] flex items-center justify-between px-3 sm:px-6 gap-2 ${floating ? "w-full absolute top-0" : ""}`}>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden flex-1">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#FF5A00] flex items-center justify-center shrink-0"><ChefHat size={18} /></div>
        <span className="hidden sm:inline font-head text-lg font-extrabold whitespace-nowrap shrink-0">RestoControl</span>
        <span className="text-xs sm:text-sm text-[#A1A1AA] truncate min-w-0" data-testid="pos-user-name">
          {user.name}
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <div className="flex flex-col items-end gap-1">
          {shift && <span className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-[#00E67611] text-[#00E676] font-semibold whitespace-nowrap">Смена открыта</span>}
          <div className="flex items-center gap-1.5">
            {!!pendingSyncCount && (
              <span data-testid="pending-sync-badge" title="Заказы/оплаты, ожидающие отправки на сервер"
                className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-[#FACC1511] text-[#FACC15] font-semibold flex items-center gap-1">
                <Send size={11} /> <span className="hidden sm:inline">В очереди:</span> {pendingSyncCount}
              </span>
            )}
            <StatusIndicators variant="pos" />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger data-testid="pos-user-menu-btn"
            className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-[#A1A1AA] hover:text-white hover:bg-[#1A1A1A] outline-none">
            <User size={17} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-[#161616] border-[#27272A] text-white min-w-[220px]">
            {shift && user.role === "admin" && onCash && (
              <DropdownMenuItem onClick={onCash} data-testid="cash-move-btn" className="gap-2 cursor-pointer focus:bg-[#242424] focus:text-white">
                <Wallet size={16} /> Касса
              </DropdownMenuItem>
            )}
            {shift && user.role === "admin" && (
              <DropdownMenuItem onClick={onCloseShift} data-testid="close-shift-btn" className="gap-2 cursor-pointer text-[#FF3B30] focus:bg-[#2A1414] focus:text-[#FF3B30]">
                <Power size={16} /> Закрыть смену
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onLogout} data-testid="pos-logout-btn" className="gap-2 cursor-pointer focus:bg-[#242424] focus:text-white">
              <LogOut size={16} /> Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
