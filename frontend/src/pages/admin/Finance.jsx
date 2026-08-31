import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Wallet, Landmark, Lock, CircleDollarSign, ArrowRightLeft, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { PageHead, Btn, Field, SelectField, SearchableSelectField, Modal } from "@/components/admin/ui";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;
const today = () => new Date().toISOString().slice(0, 10);
const KIND_LABEL = { cash: "Наличные", bank: "Банк", safe: "Сейф", other: "Другое" };
const KIND_ICON = { cash: Wallet, bank: Landmark, safe: Lock, other: CircleDollarSign };

export default function Finance() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: async () => (await api.get("/accounts")).data });
  const { data: categories = [] } = useQuery({ queryKey: ["expense-categories"], queryFn: async () => (await api.get("/expense-categories")).data });
  const { data: txns = [] } = useQuery({ queryKey: ["finance-transactions"], queryFn: async () => (await api.get("/finance-transactions")).data });

  const [tab, setTab] = useState("txns");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});

  const refresh = () => ["accounts", "expense-categories", "finance-transactions"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const accName = (id) => accounts.find((a) => a.id === id)?.name || "—";

  const saveAccount = async () => {
    try {
      if (!form.name?.trim()) { toast.error("Введите название счёта"); return; }
      const body = { name: form.name, kind: form.kind || "cash", opening_balance: Number(form.opening_balance || 0) };
      if (form.id) await api.put(`/accounts/${form.id}`, body);
      else await api.post("/accounts", body);
      toast.success("Сохранено"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delAccount = async (id) => {
    try { await api.delete(`/accounts/${id}`); refresh(); } catch (e) { toast.error(apiErr(e)); }
  };

  const saveCategory = async () => {
    try {
      if (!form.name?.trim()) { toast.error("Введите название категории"); return; }
      const body = { name: form.name, kind: form.kind || "expense" };
      if (form.id) await api.put(`/expense-categories/${form.id}`, body);
      else await api.post("/expense-categories", body);
      toast.success("Сохранено"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delCategory = async (id) => {
    try { await api.delete(`/expense-categories/${id}`); refresh(); } catch (e) { toast.error(apiErr(e)); }
  };

  const saveTxn = async () => {
    try {
      const type = form.type || "expense";
      const body = {
        type, account_id: form.account_id || accounts[0]?.id,
        to_account_id: type === "transfer" ? form.to_account_id : null,
        category_id: type !== "transfer" ? (form.category_id || null) : null,
        amount: Number(form.amount || 0), description: form.description || "",
        date: form.date || today(),
      };
      await api.post("/finance-transactions", body);
      toast.success("Операция проведена"); setModal(null); setForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delTxn = async (id) => {
    try { await api.delete(`/finance-transactions/${id}`); refresh(); } catch (e) { toast.error(apiErr(e)); }
  };

  const openTxn = (type) => setModal2({ type });
  const setModal2 = (v) => { setForm({ type: v.type, date: today(), account_id: accounts[0]?.id }); setModal("txn"); };

  const catOptions = (kind) => [{ value: "", label: "— без категории —" }, ...categories.filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div>
      <PageHead title="Финансы" subtitle="Счета, категории расходов и ручные операции"
        action={
          <div className="flex gap-2 flex-wrap">
            <Btn variant="ghost" onClick={() => openTxn("income")} data-testid="add-income-btn"><ArrowDownCircle size={16} className="inline mr-1 text-[var(--success)]" /> Доход</Btn>
            <Btn variant="ghost" onClick={() => openTxn("expense")} data-testid="add-expense-btn"><ArrowUpCircle size={16} className="inline mr-1 text-[var(--danger)]" /> Расход</Btn>
            <Btn variant="ghost" onClick={() => openTxn("transfer")} data-testid="add-transfer-btn"><ArrowRightLeft size={16} className="inline mr-1 text-[var(--purple)]" /> Перевод</Btn>
          </div>
        } />

      <div className="flex gap-2 mb-6">
        {[["txns", "Операции"], ["accounts", "Счета"], ["categories", "Категории"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`finance-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>{l}</button>
        ))}
      </div>

      {tab === "accounts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {accounts.map((a) => {
            const Icon = KIND_ICON[a.kind] || CircleDollarSign;
            return (
              <div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5" data-testid={`account-${a.id}`}>
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center"><Icon size={20} /></div>
                  <div className="flex gap-3">
                    <button onClick={() => { setForm({ id: a.id, name: a.name, kind: a.kind }); setModal("account"); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)] text-xs" data-testid={`edit-account-${a.id}`}>изм.</button>
                    <button onClick={() => delAccount(a.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-account-${a.id}`}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="font-head font-bold text-lg mt-3">{a.name}</div>
                <div className="text-xs text-[var(--ink-dim)] mb-2">{KIND_LABEL[a.kind] || a.kind}</div>
                <div className={`text-2xl font-bold tabnum ${a.balance < 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{money(a.balance)}</div>
              </div>
            );
          })}
          <button onClick={() => { setForm({ kind: "cash", opening_balance: 0 }); setModal("account"); }} data-testid="add-account-btn"
            className="border border-dashed border-[var(--border)] rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-[var(--ink-dim)] hover:border-[var(--accent)] hover:text-[var(--ink)] min-h-[140px]">
            <Plus size={20} /> Новый счёт
          </button>
        </div>
      )}

      {tab === "categories" && (
        <div className="max-w-lg mb-6">
          <div className="flex justify-end mb-3">
            <Btn onClick={() => { setForm({ kind: "expense" }); setModal("category"); }} data-testid="add-category-btn"><Plus size={16} className="inline mr-1" /> Категория</Btn>
          </div>
          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-3" data-testid={`category-row-${c.id}`}>
                <span>{c.name} <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-bold ${c.kind === "income" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{c.kind === "income" ? "доход" : "расход"}</span></span>
                <div className="flex gap-2">
                  <button onClick={() => { setForm(c); setModal("category"); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)] text-xs font-semibold" data-testid={`edit-category-${c.id}`}>изм.</button>
                  <button onClick={() => delCategory(c.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-category-${c.id}`}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            {categories.length === 0 && <p className="text-sm text-[var(--ink-faint)]">Категорий нет</p>}
          </div>
        </div>
      )}

      {tab === "txns" && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--ink-dim)] text-xs uppercase border-b border-[var(--border)]">
              <th className="text-left p-4">Дата</th><th className="text-left p-4">Тип</th><th className="text-left p-4">Счёт</th>
              <th className="text-left p-4">Категория / Описание</th><th className="text-right p-4">Сумма</th><th className="p-4"></th></tr></thead>
            <tbody>{txns.map((t) => (
              <tr key={t.id} className="border-b border-[var(--surface-2)]" data-testid={`txn-row-${t.id}`}>
                <td className="p-4 text-[var(--ink-dim)]">{t.date}</td>
                <td className="p-4">
                  {t.type === "income" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--success-soft)] text-[var(--success)] font-bold">ДОХОД</span>}
                  {t.type === "expense" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--danger-soft)] text-[var(--danger)] font-bold">РАСХОД</span>}
                  {t.type === "transfer" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--purple-soft)] text-[var(--purple)] font-bold">ПЕРЕВОД</span>}
                </td>
                <td className="p-4">{t.account_name}{t.type === "transfer" && ` → ${t.to_account_name}`}</td>
                <td className="p-4 text-[var(--ink-dim)]">{t.category_name ? `${t.category_name}` : ""}{t.description ? `${t.category_name ? " · " : ""}${t.description}` : (!t.category_name ? "—" : "")}</td>
                <td className={`p-4 text-right tabnum font-semibold ${t.type === "income" ? "text-[var(--success)]" : t.type === "expense" ? "text-[var(--danger)]" : "text-[var(--purple)]"}`}>
                  {t.type === "expense" ? "−" : t.type === "income" ? "+" : ""}{money(t.amount)}
                </td>
                <td className="p-4 text-right">
                  {t.source !== "sale" && <button onClick={() => delTxn(t.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-txn-${t.id}`}><Trash2 size={15} /></button>}
                </td>
              </tr>))}
              {txns.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[var(--ink-faint)]">Операций пока нет</td></tr>}</tbody>
          </table>
        </div>
      )}

      <Modal open={modal === "account"} onClose={() => setModal(null)} title={form.id ? "Изменить счёт" : "Новый счёт"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="account-name-input" />
          <SelectField label="Тип" value={form.kind || "cash"} onChange={(e) => setForm({ ...form, kind: e.target.value })} data-testid="account-kind-select"
            options={[{ value: "cash", label: "Наличные" }, { value: "bank", label: "Банк" }, { value: "safe", label: "Сейф" }, { value: "other", label: "Другое" }]} />
          {!form.id && <Field label="Начальный баланс" type="number" value={form.opening_balance ?? 0} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} data-testid="account-balance-input" />}
          <Btn onClick={saveAccount} className="w-full" data-testid="save-account-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "category"} onClose={() => setModal(null)} title={form.id ? "Изменить категорию" : "Новая категория"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="category-name-input" />
          <SelectField label="Тип" value={form.kind || "expense"} onChange={(e) => setForm({ ...form, kind: e.target.value })} data-testid="category-kind-select"
            options={[{ value: "expense", label: "Расход" }, { value: "income", label: "Прочий доход" }]} />
          <Btn onClick={saveCategory} className="w-full" data-testid="save-category-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={modal === "txn"} onClose={() => setModal(null)} title={form.type === "income" ? "Новый доход" : form.type === "transfer" ? "Перевод между счетами" : "Новый расход"}>
        <div className="space-y-4">
          <SearchableSelectField label={form.type === "transfer" ? "Со счёта" : "Счёт"} value={form.account_id || ""} onChange={(v) => setForm({ ...form, account_id: v })}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${money(a.balance)})` }))} data-testid="txn-account-select" />
          {form.type === "transfer" && (
            <SearchableSelectField label="На счёт" value={form.to_account_id || ""} onChange={(v) => setForm({ ...form, to_account_id: v })}
              options={accounts.filter((a) => a.id !== form.account_id).map((a) => ({ value: a.id, label: `${a.name} (${money(a.balance)})` }))} data-testid="txn-to-account-select" />
          )}
          {form.type !== "transfer" && (
            <SelectField label="Категория" value={form.category_id || ""} onChange={(e) => setForm({ ...form, category_id: e.target.value })} data-testid="txn-category-select"
              options={catOptions(form.type)} />
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Сумма" type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="txn-amount-input" />
            <Field label="Дата" type="date" value={form.date || today()} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="txn-date-input" />
          </div>
          <Field label="Описание" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="txn-description-input" />
          <Btn onClick={saveTxn} className="w-full" data-testid="save-txn-btn">Провести</Btn>
        </div>
      </Modal>
    </div>
  );
}
