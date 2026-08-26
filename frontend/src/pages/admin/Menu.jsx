import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

const unitOptions = (measure) => {
  if (measure === "kg") return [{ value: "kg", label: "кг" }, { value: "g", label: "г" }];
  if (measure === "l") return [{ value: "l", label: "л" }, { value: "ml", label: "мл" }];
  return [{ value: "pcs", label: "шт" }];
};

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

  const catName = (id) => categories.find((c) => c.id === id)?.name || "—";
  const wsName = (id) => workshops.find((w) => w.id === id)?.name || "—";

  const openProduct = (p) => {
    setEditing(p);
    setForm(p ? { ...p, recipe: p.recipe || [], modifier_group_ids: p.modifier_group_ids || [] } : { name: "", price: 0, cost: 0, cost_source: "manual", measure: "pcs", category_id: categories[0]?.id, workshop_id: workshops[0]?.id, for_sale: true, recipe: [], modifier_group_ids: [] });
    setOpen(true);
  };

  const addIngredient = () => {
    const first = inventory[0];
    if (!first) { toast.error("Сначала добавьте позиции на склад"); return; }
    setForm((f) => ({ ...f, recipe: [...(f.recipe || []), { inventory_id: first.id, name: first.name, amount: 1, unit: first.measure }] }));
  };
  const updateIngredient = (i, field, value) => {
    setForm((f) => {
      const recipe = [...(f.recipe || [])];
      if (field === "inventory_id") {
        const inv = inventory.find((x) => x.id === value);
        recipe[i] = { ...recipe[i], inventory_id: value, name: inv?.name || "", unit: inv?.measure || "pcs" };
      } else if (field === "unit") {
        recipe[i] = { ...recipe[i], unit: value };
      } else {
        recipe[i] = { ...recipe[i], amount: value };
      }
      return { ...f, recipe };
    });
  };
  const removeIngredient = (i) => setForm((f) => ({ ...f, recipe: (f.recipe || []).filter((_, idx) => idx !== i) }));

  const saveProduct = async () => {
    try {
      const body = {
        name: form.name, price: Number(form.price), cost: Number(form.cost),
        cost_source: form.cost_source || "manual",
        measure: form.measure, category_id: form.category_id, workshop_id: form.workshop_id,
        for_sale: form.for_sale ?? true, image: form.image || null,
        recipe: (form.recipe || []).map((r) => ({ inventory_id: r.inventory_id, name: r.name, amount: Number(r.amount), unit: r.unit || null })),
        modifier_group_ids: form.modifier_group_ids || [],
      };
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

  // categories inline
  const [catForm, setCatForm] = useState("");
  const addCat = async () => {
    if (!catForm.trim()) return;
    await api.post("/categories", { name: catForm, position: categories.length + 1 });
    setCatForm("");
    qc.invalidateQueries({ queryKey: ["categories"] });
  };
  const delCat = async (id) => {
    await api.delete(`/categories/${id}`);
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
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[#FF5A00] text-white" : "bg-[#121212] border border-[#27272A] text-[#A1A1AA]"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "products" && (
        <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[#A1A1AA] text-xs uppercase tracking-wider border-b border-[#27272A]">
                <th className="text-left p-4">Название</th>
                <th className="text-left p-4">Категория</th>
                <th className="text-left p-4">Цех</th>
                <th className="text-right p-4">Цена</th>
                <th className="text-right p-4">Себест.</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-[#1A1A1A] hover:bg-[#161616]" data-testid={`product-row-${p.id}`}>
                  <td className="p-4 font-medium">{p.name}</td>
                  <td className="p-4 text-[#A1A1AA]">{catName(p.category_id)}</td>
                  <td className="p-4 text-[#A1A1AA]">{wsName(p.workshop_id)}</td>
                  <td className="p-4 text-right tabnum text-[#FF5A00] font-semibold">{money(p.price)}</td>
                  <td className="p-4 text-right tabnum text-[#A1A1AA]">{money(p.cost)}</td>
                  <td className="p-4">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openProduct(p)} className="text-[#A1A1AA] hover:text-white" data-testid={`edit-product-${p.id}`}><Pencil size={16} /></button>
                      <button onClick={() => delProduct(p.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-product-${p.id}`}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "categories" && (
        <div className="max-w-lg">
          <div className="flex gap-2 mb-4">
            <input value={catForm} onChange={(e) => setCatForm(e.target.value)} placeholder="Новая категория"
              data-testid="cat-input"
              className="flex-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 focus:border-[#FF5A00] outline-none" />
            <Btn onClick={addCat} data-testid="add-cat-btn"><Plus size={16} /></Btn>
          </div>
          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-[#121212] border border-[#27272A] rounded-lg px-4 py-3">
                <span>{c.name}</span>
                <button onClick={() => delCat(c.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-cat-${c.id}`}><Trash2 size={16} /></button>
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
                <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Себестоимость</label>
                <button type="button" data-testid="cost-source-toggle"
                  onClick={() => setForm({ ...form, cost_source: form.cost_source === "auto" ? "manual" : "auto" })}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${form.cost_source === "auto" ? "bg-[#00E676]/20 text-[#00E676]" : "bg-[#27272A] text-[#A1A1AA]"}`}>
                  {form.cost_source === "auto" ? "АВТО" : "РУЧ."}
                </button>
              </div>
              <input type="number" disabled={form.cost_source === "auto"} value={form.cost ?? 0}
                onChange={(e) => setForm({ ...form, cost: e.target.value })} data-testid="product-cost-input"
                className={`w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 outline-none focus:border-[#FF5A00] ${form.cost_source === "auto" ? "opacity-50 cursor-not-allowed" : ""}`} />
              {form.cost_source === "auto" && <p className="text-[10px] text-[#52525B] mt-1">Считается из тех.карты и цен прихода при сохранении</p>}
            </div>
          </div>
          <SelectField label="Категория" value={form.category_id || ""} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          <SelectField label="Цех" value={form.workshop_id || ""} onChange={(e) => setForm({ ...form, workshop_id: e.target.value })}
            options={workshops.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField label="Ед. измерения" value={form.measure || "pcs"} onChange={(e) => setForm({ ...form, measure: e.target.value })}
            options={[{ value: "pcs", label: "шт" }, { value: "kg", label: "кг" }, { value: "l", label: "л" }]} />
          <div className="border-t border-[#27272A] pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Тех.карта (авто-списание)</label>
              <button onClick={addIngredient} className="text-[#00E676] text-sm flex items-center gap-1 hover:text-white" data-testid="add-ingredient-btn"><Plus size={14} /> Ингредиент</button>
            </div>
            <div className="space-y-2">
              {(form.recipe || []).length === 0 && <p className="text-xs text-[#52525B]">Списание со склада не настроено</p>}
              {(form.recipe || []).map((r, i) => (
                <div key={i} className="flex gap-2 items-center" data-testid={`ingredient-row-${i}`}>
                  <select value={r.inventory_id} onChange={(e) => updateIngredient(i, "inventory_id", e.target.value)} data-testid={`ingredient-inventory-${i}`}
                    className="flex-1 min-w-0 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FF5A00]">
                    {inventory.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                  </select>
                  <input type="number" step="0.001" value={r.amount} onChange={(e) => updateIngredient(i, "amount", e.target.value)}
                    className="w-16 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-2 py-2 text-sm outline-none focus:border-[#FF5A00]" data-testid={`ingredient-amount-${i}`} />
                  <select value={r.unit || ""} onChange={(e) => updateIngredient(i, "unit", e.target.value)}
                    className="w-16 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-2 py-2 text-sm outline-none focus:border-[#FF5A00]" data-testid={`ingredient-unit-${i}`}>
                    {unitOptions(inventory.find((x) => x.id === r.inventory_id)?.measure).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button onClick={() => removeIngredient(i)} className="text-[#A1A1AA] hover:text-[#FF3B30]"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-[#27272A] pt-4">
            <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA] block mb-2">Группы модификаторов</label>
            {modGroups.length === 0 && <p className="text-xs text-[#52525B]">Нет групп. Создайте их во вкладке «Модификаторы».</p>}
            <div className="flex flex-wrap gap-2">
              {modGroups.map((g) => {
                const on = (form.modifier_group_ids || []).includes(g.id);
                return (
                  <button key={g.id} type="button" data-testid={`product-modgroup-${g.id}`}
                    onClick={() => setForm((f) => ({ ...f, modifier_group_ids: on ? (f.modifier_group_ids || []).filter((x) => x !== g.id) : [...(f.modifier_group_ids || []), g.id] }))}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? "bg-[#FF5A00] border-[#FF5A00] text-white" : "bg-[#0A0A0A] border-[#27272A] text-[#A1A1AA]"}`}>
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
      {groups.length === 0 && <p className="text-[#52525B] text-sm">Групп модификаторов пока нет</p>}
      {groups.map((g) => (
        <div key={g.id} className="bg-[#121212] border border-[#27272A] rounded-xl p-5" data-testid={`modgroup-${g.id}`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-head font-bold text-lg">{g.name}</span>
              <span className="ml-3 text-xs text-[#A1A1AA]">{g.selection_type === "single" ? "один вариант" : `выбор ${g.min_count}–${g.max_count}`}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setOForm({}); setOModal(g.id); }} className="text-[#00E676] text-sm hover:text-white" data-testid={`add-option-${g.id}`}><Plus size={14} className="inline" /> Опция</button>
              <button onClick={() => { setGForm({ id: g.id, name: g.name, selection_type: g.selection_type, min_count: g.min_count, max_count: g.max_count }); setGModal(true); }} className="text-[#A1A1AA] hover:text-white text-sm" data-testid={`edit-modgroup-${g.id}`}><Pencil size={14} /></button>
              <button onClick={() => delGroup(g.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-modgroup-${g.id}`}><Trash2 size={16} /></button>
            </div>
          </div>
          <div className="space-y-1">
            {(g.options || []).map((o) => (
              <div key={o.id} className="flex items-center justify-between text-sm bg-[#0A0A0A] rounded-lg px-3 py-2" data-testid={`option-${o.id}`}>
                <span>{o.name} {o.price_delta ? <span className="text-[#FF5A00]">+{o.price_delta} ₽</span> : <span className="text-[#52525B]">без доплаты</span>}
                  {o.inventory_id && <span className="text-[#52525B] ml-2">списание {o.amount} {inventory.find((i) => i.id === o.inventory_id)?.name || ""}</span>}</span>
                <span className="flex gap-2">
                  <button onClick={() => { setOForm({ id: o.id, name: o.name, price_delta: o.price_delta, inventory_id: o.inventory_id, amount: o.amount }); setOModal(g.id); }} className="text-[#A1A1AA] hover:text-white" data-testid={`edit-option-${o.id}`}><Pencil size={13} /></button>
                  <button onClick={() => delOption(g.id, o.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-option-${o.id}`}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
            {(g.options || []).length === 0 && <p className="text-xs text-[#52525B]">Опции не добавлены</p>}
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
            <label className="flex items-center gap-2 text-sm text-[#A1A1AA] cursor-pointer">
              <input type="checkbox" checked={Number(gForm.min_count) >= 1} data-testid="modgroup-required-check"
                onChange={(e) => setGForm({ ...gForm, min_count: e.target.checked ? 1 : 0, max_count: 1 })}
                className="accent-[#FF5A00] w-4 h-4" />
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
          <SelectField label="Ингредиент для списания (необязательно)" value={oForm.inventory_id || ""} onChange={(e) => setOForm({ ...oForm, inventory_id: e.target.value })}
            options={[{ value: "", label: "— нет —" }, ...inventory.map((i) => ({ value: i.id, label: i.name }))]} data-testid="option-inventory-select" />
          {oForm.inventory_id && <Field label="Кол-во списания (в ед. склада)" type="number" step="0.001" value={oForm.amount ?? ""} onChange={(e) => setOForm({ ...oForm, amount: e.target.value })} data-testid="option-amount-input" />}
          <Btn onClick={saveOption} className="w-full" data-testid="save-option-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
