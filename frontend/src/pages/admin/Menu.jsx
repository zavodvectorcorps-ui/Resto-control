import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const money = (n) => `${Number(n || 0).toFixed(2)} ₽`;

export default function Menu() {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: async () => (await api.get("/products")).data });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: async () => (await api.get("/categories")).data });
  const { data: workshops = [] } = useQuery({ queryKey: ["workshops"], queryFn: async () => (await api.get("/workshops")).data });
  const { data: inventory = [] } = useQuery({ queryKey: ["inventory"], queryFn: async () => (await api.get("/inventory")).data });

  const [tab, setTab] = useState("products");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  const catName = (id) => categories.find((c) => c.id === id)?.name || "—";
  const wsName = (id) => workshops.find((w) => w.id === id)?.name || "—";

  const openProduct = (p) => {
    setEditing(p);
    setForm(p ? { ...p, recipe: p.recipe || [] } : { name: "", price: 0, cost: 0, measure: "pcs", category_id: categories[0]?.id, workshop_id: workshops[0]?.id, for_sale: true, recipe: [] });
    setOpen(true);
  };

  const addIngredient = () => {
    const first = inventory[0];
    if (!first) { toast.error("Сначала добавьте позиции на склад"); return; }
    setForm((f) => ({ ...f, recipe: [...(f.recipe || []), { inventory_id: first.id, name: first.name, amount: 1 }] }));
  };
  const updateIngredient = (i, field, value) => {
    setForm((f) => {
      const recipe = [...(f.recipe || [])];
      if (field === "inventory_id") {
        const inv = inventory.find((x) => x.id === value);
        recipe[i] = { ...recipe[i], inventory_id: value, name: inv?.name || "" };
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
        measure: form.measure, category_id: form.category_id, workshop_id: form.workshop_id,
        for_sale: form.for_sale ?? true, image: form.image || null,
        recipe: (form.recipe || []).map((r) => ({ inventory_id: r.inventory_id, name: r.name, amount: Number(r.amount) })),
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
        {[["products", "Позиции"], ["categories", "Категории"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`menu-tab-${k}`}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? "bg-[#FF5A00] text-white" : "bg-[#121212] border border-[#27272A] text-[#A1A1AA]"}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === "products" ? (
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
      ) : (
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать позицию" : "Новая позиция"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="product-name-input" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Цена" type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="product-price-input" />
            <Field label="Себестоимость" type="number" value={form.cost ?? 0} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
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
                  <select value={r.inventory_id} onChange={(e) => updateIngredient(i, "inventory_id", e.target.value)}
                    className="flex-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FF5A00]">
                    {inventory.map((inv) => <option key={inv.id} value={inv.id}>{inv.name} ({inv.measure})</option>)}
                  </select>
                  <input type="number" step="0.001" value={r.amount} onChange={(e) => updateIngredient(i, "amount", e.target.value)}
                    className="w-20 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#FF5A00]" data-testid={`ingredient-amount-${i}`} />
                  <button onClick={() => removeIngredient(i)} className="text-[#A1A1AA] hover:text-[#FF3B30]"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
          <Btn onClick={saveProduct} className="w-full" data-testid="save-product-btn">Сохранить</Btn>
        </div>
      </Modal>
    </div>
  );
}
