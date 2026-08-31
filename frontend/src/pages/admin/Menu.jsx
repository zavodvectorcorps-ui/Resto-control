import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { PageHead, Btn, Field, SelectField, SearchableSelectField, Modal } from "@/components/admin/ui";
import RecipeEditor, { hydrateRecipeNetto } from "@/components/admin/RecipeEditor";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

export default function Menu() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: async () => (await api.get("/products")).data });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });
  const { data: workshops = [] } = useQuery({ queryKey: ["workshops"], queryFn: async () => (await api.get("/workshops")).data });
  const { data: inventory = [] } = useQuery({ queryKey: ["inventory"], queryFn: async () => (await api.get("/inventory")).data });
  const { data: modGroups = [] } = useQuery({ queryKey: ["modifier-groups"], queryFn: async () => (await api.get("/modifier-groups")).data });

  const [tab, setTab] = useState("products");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [wsFilter, setWsFilter] = useState("all");
  const [saleFilter, setSaleFilter] = useState("all");

  const catName = (id) => categories.find((c) => c.id === id)?.name || "—";
  const wsName = (id) => workshops.find((w) => w.id === id)?.name || "—";
  const q = search.trim().toLowerCase();
  const shownProductRows = products.filter((p) =>
    (catFilter === "all" || p.category_id === catFilter)
    && (wsFilter === "all" || p.workshop_id === wsFilter)
    && (saleFilter === "all" || (saleFilter === "yes" ? (p.for_sale ?? true) : !(p.for_sale ?? true)))
    && (!q || p.name.toLowerCase().includes(q))
  );

  const openProduct = (p) => {
    setEditing(p);
    const recipe = hydrateRecipeNetto(p?.recipe, inventory);
    setForm(p
      ? { ...p, recipe, itemType: p.inventory_id ? "good" : "dish", modifier_group_ids: p.modifier_group_ids || [] }
      : { name: "", price: 0, cost: 0, cost_source: "manual", measure: "pcs", category_id: categories[0]?.id, workshop_id: workshops[0]?.id, for_sale: true, itemType: "dish", recipe: [], inventory_id: null, modifier_group_ids: [] });
    setOpen(true);
  };

  const saveProduct = async () => {
    try {
      const isGood = form.itemType === "good";
      const body = {
        name: form.name, price: Number(form.price), cost: Number(form.cost),
        cost_source: form.cost_source || "manual",
        measure: form.measure, category_id: form.category_id, workshop_id: form.workshop_id,
        for_sale: form.for_sale ?? true, discount_eligible: form.discount_eligible ?? true, image: form.image || null,
        inventory_id: isGood ? (form.inventory_id || null) : null,
        recipe: isGood ? [] : (form.recipe || []).map((r) => ({ inventory_id: r.inventory_id, name: r.name, amount: Number(r.amount), unit: r.unit || null, processing_method: r.processing_method || null })),
        modifier_group_ids: form.modifier_group_ids || [],
        preparation_notes: form.preparation_notes || "",
        course_number: (form.course_number === "" || form.course_number == null) ? null : Number(form.course_number),
      };
      if (isGood && !body.inventory_id) { toast.error("Выберите позицию склада для товара"); return; }
      if (editing) await api.put(`/products/${editing.id}`, body);
      else await api.post("/products", body);
      toast.success("Сохранено");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  const delProduct = async (id) => {
    await api.delete(`/products/${id}`);
    toast.success("Удалено");
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  // быстрый тумблер прямо в списке — без открытия карточки
  const toggleProductFlag = async (p, field) => {
    try {
      await api.put(`/products/${p.id}`, {
        name: p.name, category_id: p.category_id, workshop_id: p.workshop_id,
        price: p.price, cost: p.cost, cost_source: p.cost_source, measure: p.measure,
        image: p.image || null, for_sale: p.for_sale ?? true, discount_eligible: p.discount_eligible ?? true,
        [field]: !(p[field] ?? true),
        recipe: p.recipe || [], inventory_id: p.inventory_id || null,
        modifier_group_ids: p.modifier_group_ids || [], yield_g: p.yield_g ?? null,
        preparation_notes: p.preparation_notes || "", course_number: p.course_number ?? null,
      });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  // categories inline
  const [catForm, setCatForm] = useState("");
  const [catCourse, setCatCourse] = useState(0);
  const addCat = async () => {
    if (!catForm.trim()) return;
    await api.post("/categories", { name: catForm, position: categories.length + 1, course_number: Number(catCourse || 0) });
    setCatForm(""); setCatCourse(0);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };
  const delCat = async (id) => {
    await api.delete(`/categories/${id}`);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };
  const updateCatCourse = async (c, course) => {
    await api.put(`/categories/${c.id}`, { name: c.name, color: c.color || "var(--accent)", position: c.position || 0, course_number: Number(course || 0) });
    toast.success("Курс подачи сохранён");
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  return (
    <div>
      <PageHead
        title="Меню"
        subtitle="Позиции, категории и привязка к цехам"
        action={tab === "products" && <Btn onClick={() => openProduct(null)} data-testid="add-product-btn"><Plus size={16} className="inline mr-1" /> Добавить позицию</Btn>}
      />

      <div className="flex gap-2 mb-6">
        {[["products", "Позиции"], ["categories", "Категории"], ["modifiers", "Модификаторы"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`menu-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--ink-dim)]"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "products" && (
        <>
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию…" data-testid="product-search-input"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]" />
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} data-testid="product-category-filter"
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]">
            <option value="all">Все категории</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={wsFilter} onChange={(e) => setWsFilter(e.target.value)} data-testid="product-workshop-filter"
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]">
            <option value="all">Все цеха</option>
            {workshops.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={saleFilter} onChange={(e) => setSaleFilter(e.target.value)} data-testid="product-sale-filter"
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]">
            <option value="all">В продаже: все</option>
            <option value="yes">В продаже</option>
            <option value="no">Не в продаже</option>
          </select>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--ink-dim)] text-xs uppercase tracking-wider border-b border-[var(--border)]">
                <th className="text-left p-4">Название</th>
                <th className="text-left p-4">Тип</th>
                <th className="text-left p-4">Категория</th>
                <th className="text-left p-4">Цех</th>
                <th className="text-center p-4">В продаже</th>
                <th className="text-center p-4">Скидка</th>
                <th className="text-right p-4">Цена</th>
                <th className="text-right p-4">Себест.</th>
                <th className="text-right p-4">Наценка</th>
                <th className="text-right p-4">Фудкост</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {shownProductRows.length === 0 && (
                <tr><td colSpan="11" className="p-6 text-center text-[var(--ink-faint)]">Ничего не найдено</td></tr>
              )}
              {shownProductRows.map((p) => {
                const markupPct = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : null;
                const foodCostPct = p.price > 0 ? (p.cost / p.price) * 100 : null;
                return (
                <tr key={p.id} className="border-b border-[var(--surface-2)] hover:bg-[var(--surface-hover)]" data-testid={`product-row-${p.id}`}>
                  <td className="p-4 font-medium">{p.name}</td>
                  <td className="p-4">
                    {p.inventory_id
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--info-soft)] text-[var(--info)]">ТОВАР</span>
                      : (p.recipe || []).length > 0
                        ? <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--accent-soft)] text-[var(--accent)]">БЛЮДО</span>
                        : <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[var(--border)] text-[var(--ink-dim)]">—</span>}
                  </td>
                  <td className="p-4 text-[var(--ink-dim)]">{catName(p.category_id)}</td>
                  <td className="p-4 text-[var(--ink-dim)]">{wsName(p.workshop_id)}</td>
                  <td className="p-4 text-center">
                    <button onClick={() => toggleProductFlag(p, "for_sale")} data-testid={`toggle-for-sale-${p.id}`}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${(p.for_sale ?? true) ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--border)] text-[var(--ink-dim)]"}`}>
                      {(p.for_sale ?? true) ? "да" : "нет"}
                    </button>
                  </td>
                  <td className="p-4 text-center">
                    <button onClick={() => toggleProductFlag(p, "discount_eligible")} data-testid={`toggle-discount-eligible-${p.id}`}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${(p.discount_eligible ?? true) ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--border)] text-[var(--ink-dim)]"}`}>
                      {(p.discount_eligible ?? true) ? "да" : "нет"}
                    </button>
                  </td>
                  <td className="p-4 text-right tabnum text-[var(--accent)] font-semibold">{money(p.price)}</td>
                  <td className="p-4 text-right tabnum text-[var(--ink-dim)]">{money(p.cost)}</td>
                  <td className="p-4 text-right tabnum text-[var(--success)]">{markupPct == null ? "—" : `${markupPct.toFixed(0)}%`}</td>
                  <td className={`p-4 text-right tabnum ${foodCostPct != null && foodCostPct > 35 ? "text-[var(--danger)]" : "text-[var(--ink-dim)]"}`}>{foodCostPct == null ? "—" : `${foodCostPct.toFixed(0)}%`}</td>
                  <td className="p-4">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openProduct(p)} className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid={`edit-product-${p.id}`}><Pencil size={16} /></button>
                      <button onClick={() => delProduct(p.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-product-${p.id}`}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {tab === "categories" && (
        <div className="max-w-lg">
          <div className="flex gap-2 mb-2">
            <input value={catForm} onChange={(e) => setCatForm(e.target.value)} placeholder="Новая категория"
              data-testid="cat-input"
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 focus:border-[var(--accent)] outline-none" />
            <input type="number" min="0" value={catCourse} onChange={(e) => setCatCourse(e.target.value)} placeholder="Курс" title="Курс подачи" data-testid="cat-course-input"
              className="w-20 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 focus:border-[var(--accent)] outline-none" />
            <Btn onClick={addCat} data-testid="add-cat-btn"><Plus size={16} /></Btn>
          </div>
          <p className="text-xs text-[var(--ink-faint)] mb-4">Курс подачи: 0 — без порядка, 1 — первым, 2 — вторым и т.д. Печатается и группируется в заказе.</p>
          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-3">
                <span>{c.name}</span>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-[var(--ink-dim)] flex items-center gap-1">Курс
                    <input type="number" min="0" defaultValue={c.course_number || 0} onBlur={(e) => updateCatCourse(c, e.target.value)} data-testid={`cat-course-${c.id}`}
                      className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
                  </label>
                  <button onClick={() => delCat(c.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-cat-${c.id}`}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "modifiers" && <ModifiersPanel groups={modGroups} inventory={inventory} qc={qc} />}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать позицию" : "Новая позиция"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="product-name-input" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Цена" type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="product-price-input" />
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">Себестоимость</label>
                <button type="button" data-testid="cost-source-toggle"
                  onClick={() => setForm({ ...form, cost_source: form.cost_source === "auto" ? "manual" : "auto" })}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${form.cost_source === "auto" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--border)] text-[var(--ink-dim)]"}`}>
                  {form.cost_source === "auto" ? "АВТО" : "РУЧ."}
                </button>
              </div>
              <input type="number" disabled={form.cost_source === "auto"} value={form.cost ?? 0}
                onChange={(e) => setForm({ ...form, cost: e.target.value })} data-testid="product-cost-input"
                className={`w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 outline-none focus:border-[var(--accent)] ${form.cost_source === "auto" ? "opacity-50 cursor-not-allowed" : ""}`} />
              {form.cost_source === "auto" && <p className="text-[10px] text-[var(--ink-faint)] mt-1">Считается из тех.карты и цен прихода при сохранении</p>}
            </div>
          </div>
          {(() => {
            const price = Number(form.price) || 0;
            const cost = Number(form.cost) || 0;
            const markup = price - cost;
            const markupPct = cost > 0 ? (markup / cost) * 100 : null;
            const foodCostPct = price > 0 ? (cost / price) * 100 : null;
            return (
              <div className="grid grid-cols-3 gap-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3" data-testid="markup-summary">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">Наценка</div>
                  <div className="text-sm font-semibold tabular-nums mt-0.5" data-testid="markup-amount">{markup.toFixed(2)} ₽</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">Наценка, %</div>
                  <div className="text-sm font-semibold tabular-nums mt-0.5 text-[var(--success)]" data-testid="markup-percent">{markupPct == null ? "—" : `${markupPct.toFixed(0)}%`}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">Фудкост, %</div>
                  <div className={`text-sm font-semibold tabular-nums mt-0.5 ${foodCostPct != null && foodCostPct > 35 ? "text-[var(--danger)]" : "text-[var(--accent)]"}`} data-testid="foodcost-percent">{foodCostPct == null ? "—" : `${foodCostPct.toFixed(0)}%`}</div>
                </div>
              </div>
            );
          })()}
          <SelectField label="Категория" value={form.category_id || ""} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          <SelectField label="Цех" value={form.workshop_id || ""} onChange={(e) => setForm({ ...form, workshop_id: e.target.value })}
            options={workshops.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField label="Ед. измерения" value={form.measure || "pcs"} onChange={(e) => setForm({ ...form, measure: e.target.value })}
            options={[{ value: "pcs", label: "шт" }, { value: "kg", label: "кг" }, { value: "l", label: "л" }]} />
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)]">Курс подачи (пусто = как в категории)</label>
            <input type="number" min="0" value={form.course_number ?? ""} onChange={(e) => setForm({ ...form, course_number: e.target.value })} data-testid="product-course-input"
              placeholder="как в категории"
              className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 outline-none focus:border-[var(--accent)]" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center justify-between bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 cursor-pointer">
              <span className="text-sm">В продаже</span>
              <input type="checkbox" checked={form.for_sale ?? true} onChange={(e) => setForm({ ...form, for_sale: e.target.checked })} data-testid="product-for-sale-toggle" className="accent-[var(--accent)] w-4 h-4" />
            </label>
            <label className="flex items-center justify-between bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 cursor-pointer">
              <span className="text-sm">Участвует в скидках</span>
              <input type="checkbox" checked={form.discount_eligible ?? true} onChange={(e) => setForm({ ...form, discount_eligible: e.target.checked })} data-testid="product-discount-eligible-toggle" className="accent-[var(--accent)] w-4 h-4" />
            </label>
          </div>
          <p className="text-xs text-[var(--ink-faint)] -mt-2">«Не в продаже» скрывает позицию из интерфейса официанта (остаётся видна только в бэк-офисе). «Не участвует в скидках» ограничивает скидку при оплате суммой остальных позиций чека.</p>
          <div className="border-t border-[var(--border)] pt-4">
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Тип позиции</label>
            <div className="flex gap-2 mb-4">
              <button type="button" onClick={() => setForm({ ...form, itemType: "dish" })} data-testid="item-type-dish"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${form.itemType !== "good" ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                Блюдо (тех.карта)
              </button>
              <button type="button" onClick={() => setForm({ ...form, itemType: "good" })} data-testid="item-type-good"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${form.itemType === "good" ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                Товар (прямое списание)
              </button>
            </div>

            {form.itemType === "good" ? (
              <div>
                <SearchableSelectField label="Позиция склада, которая продаётся" value={form.inventory_id || ""} onChange={(v) => setForm({ ...form, inventory_id: v })}
                  options={inventory.map((i) => ({ value: i.id, label: i.name }))} data-testid="product-inventory-select" />
                <p className="text-xs text-[var(--ink-faint)] mt-2">При продаже списывается сама эта позиция со склада — без тех.карты. Подходит для товаров для перепродажи (бутилированная вода, снеки).</p>
              </div>
            ) : (
              <>
                <RecipeEditor recipe={form.recipe} onChange={(recipe) => setForm({ ...form, recipe })} inventory={inventory} testPrefix="ingredient" />
                {form.yield_g != null && <p className="text-xs text-[var(--ink-faint)] mt-2" data-testid="yield-display">Выход блюда (нетто, авто): <span className="text-[var(--info)]">{form.yield_g} г</span> — пересчитается при сохранении</p>}
              </>
            )}
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Заметки для кухни</label>
            <textarea value={form.preparation_notes || ""} onChange={(e) => setForm({ ...form, preparation_notes: e.target.value })} data-testid="prep-notes-input" rows="2"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 outline-none focus:border-[var(--accent)] text-sm" />
          </div>
          <div className="border-t border-[var(--border)] pt-4">
            <label className="text-xs uppercase tracking-[0.15em] text-[var(--ink-dim)] block mb-2">Группы модификаторов</label>
            {modGroups.length === 0 && <p className="text-xs text-[var(--ink-faint)]">Нет групп. Создайте их во вкладке «Модификаторы».</p>}
            <div className="flex flex-wrap gap-2">
              {modGroups.map((g) => {
                const on = (form.modifier_group_ids || []).includes(g.id);
                return (
                  <button key={g.id} type="button" data-testid={`product-modgroup-${g.id}`}
                    onClick={() => setForm((f) => ({ ...f, modifier_group_ids: on ? (f.modifier_group_ids || []).filter((x) => x !== g.id) : [...(f.modifier_group_ids || []), g.id] }))}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--bg)] border-[var(--border)] text-[var(--ink-dim)]"}`}>
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
          <Btn onClick={saveProduct} className="w-full" data-testid="save-product-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}


function ModifiersPanel({ groups, inventory, qc }) {
  const [gModal, setGModal] = useState(false);
  const [gForm, setGForm] = useState({});
  const [oModal, setOModal] = useState(null); // group id
  const [oForm, setOForm] = useState({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["modifier-groups"] });

  const saveGroup = async () => {
    try {
      const body = { name: gForm.name, selection_type: gForm.selection_type || "single", min_count: Number(gForm.min_count || 0), max_count: Number(gForm.max_count || 1) };
      if (gForm.id) await api.put(`/modifier-groups/${gForm.id}`, body);
      else await api.post("/modifier-groups", body);
      toast.success("Сохранено"); setGModal(false); setGForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delGroup = async (id) => { await api.delete(`/modifier-groups/${id}`); refresh(); };

  const saveOption = async () => {
    try {
      const body = { name: oForm.name, price_delta: Number(oForm.price_delta || 0), inventory_id: oForm.inventory_id || null, amount: oForm.amount ? Number(oForm.amount) : null };
      if (oForm.id) await api.put(`/modifier-groups/${oModal}/options/${oForm.id}`, body);
      else await api.post(`/modifier-groups/${oModal}/options`, body);
      toast.success("Сохранено"); setOModal(null); setOForm({}); refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delOption = async (gid, oid) => { await api.delete(`/modifier-groups/${gid}/options/${oid}`); refresh(); };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn onClick={() => { setGForm({ selection_type: "single", min_count: 0, max_count: 1 }); setGModal(true); }} data-testid="add-modgroup-btn"><Plus size={16} className="inline mr-1" /> Группа модификаторов</Btn>
      </div>
      {groups.length === 0 && <p className="text-[var(--ink-faint)] text-sm">Групп модификаторов пока нет</p>}
      {groups.map((g) => (
        <div key={g.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5" data-testid={`modgroup-${g.id}`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-head font-bold text-lg">{g.name}</span>
              <span className="ml-3 text-xs text-[var(--ink-dim)]">{g.selection_type === "single" ? "один вариант" : `выбор ${g.min_count}–${g.max_count}`}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setOForm({}); setOModal(g.id); }} className="text-[var(--success)] text-sm hover:text-[var(--ink)]" data-testid={`add-option-${g.id}`}><Plus size={14} className="inline" /> Опция</button>
              <button onClick={() => { setGForm({ id: g.id, name: g.name, selection_type: g.selection_type, min_count: g.min_count, max_count: g.max_count }); setGModal(true); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)] text-sm" data-testid={`edit-modgroup-${g.id}`}><Pencil size={14} /></button>
              <button onClick={() => delGroup(g.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-modgroup-${g.id}`}><Trash2 size={16} /></button>
            </div>
          </div>
          <div className="space-y-1">
            {(g.options || []).map((o) => (
              <div key={o.id} className="flex items-center justify-between text-sm bg-[var(--bg)] rounded-lg px-3 py-2" data-testid={`option-${o.id}`}>
                <span>{o.name} {o.price_delta ? <span className="text-[var(--accent)]">+{o.price_delta} ₽</span> : <span className="text-[var(--ink-faint)]">без доплаты</span>}
                  {o.inventory_id && <span className="text-[var(--ink-faint)] ml-2">списание {o.amount} {inventory.find((i) => i.id === o.inventory_id)?.name || ""}</span>}</span>
                <span className="flex gap-2">
                  <button onClick={() => { setOForm({ id: o.id, name: o.name, price_delta: o.price_delta, inventory_id: o.inventory_id, amount: o.amount }); setOModal(g.id); }} className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid={`edit-option-${o.id}`}><Pencil size={13} /></button>
                  <button onClick={() => delOption(g.id, o.id)} className="text-[var(--ink-dim)] hover:text-[var(--danger)]" data-testid={`del-option-${o.id}`}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {(g.options || []).length === 0 && <p className="text-xs text-[var(--ink-faint)]">Опции не добавлены</p>}
          </div>
        </div>
      ))}

      <Modal open={gModal} onClose={() => setGModal(false)} title={gForm.id ? "Изменить группу" : "Новая группа модификаторов"}>
        <div className="space-y-4">
          <Field label="Название" value={gForm.name || ""} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} data-testid="modgroup-name-input" />
          <SelectField label="Тип выбора" value={gForm.selection_type || "single"} onChange={(e) => setGForm({ ...gForm, selection_type: e.target.value })}
            options={[{ value: "single", label: "Один вариант" }, { value: "multiple", label: "Несколько" }]} data-testid="modgroup-type-select" />
          {gForm.selection_type === "multiple" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Мин." type="number" value={gForm.min_count ?? 0} onChange={(e) => setGForm({ ...gForm, min_count: e.target.value })} data-testid="modgroup-min-input" />
              <Field label="Макс." type="number" value={gForm.max_count ?? 1} onChange={(e) => setGForm({ ...gForm, max_count: e.target.value })} data-testid="modgroup-max-input" />
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)] cursor-pointer">
              <input type="checkbox" checked={Number(gForm.min_count) >= 1} data-testid="modgroup-required-check"
                onChange={(e) => setGForm({ ...gForm, min_count: e.target.checked ? 1 : 0, max_count: 1 })}
                className="accent-[var(--accent)] w-4 h-4" />
              Обязательный выбор (гость должен выбрать один вариант)
            </label>
          )}
          <Btn onClick={saveGroup} className="w-full" data-testid="save-modgroup-btn">Сохранить</Btn>
        </div>
      </Modal>

      <Modal open={!!oModal} onClose={() => setOModal(null)} title={oForm.id ? "Изменить опцию" : "Новая опция"}>
        <div className="space-y-4">
          <Field label="Название" value={oForm.name || ""} onChange={(e) => setOForm({ ...oForm, name: e.target.value })} data-testid="option-name-input" />
          <Field label="Доплата, ₽" type="number" value={oForm.price_delta ?? 0} onChange={(e) => setOForm({ ...oForm, price_delta: e.target.value })} data-testid="option-price-input" />
          <SearchableSelectField label="Ингредиент для списания (необязательно)" value={oForm.inventory_id || ""} onChange={(v) => setOForm({ ...oForm, inventory_id: v })}
            options={[{ value: "", label: "— нет —" }, ...inventory.map((i) => ({ value: i.id, label: i.name }))]} data-testid="option-inventory-select" />
          {oForm.inventory_id && <Field label="Кол-во списания (в ед. склада)" type="number" step="0.001" value={oForm.amount ?? ""} onChange={(e) => setOForm({ ...oForm, amount: e.target.value })} data-testid="option-amount-input" />}
          <Btn onClick={saveOption} className="w-full" data-testid="save-option-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
