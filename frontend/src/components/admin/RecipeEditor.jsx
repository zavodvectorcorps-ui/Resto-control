import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/admin/ui";

export const unitOptions = (measure) => {
  if (measure === "kg") return [{ value: "kg", label: "кг" }, { value: "g", label: "г" }];
  if (measure === "l") return [{ value: "l", label: "л" }, { value: "ml", label: "мл" }];
  return [{ value: "pcs", label: "шт" }];
};
const round3 = (n) => Math.round(n * 1000) / 1000;

const lossPercent = (inventory, inventoryId, method) => {
  const inv = inventory.find((x) => x.id === inventoryId);
  return (method && inv?.processing_loss?.[method]) || 0;
};

// amount в рецепте хранится как брутто (списывается со склада и идёт в себестоимость);
// удобнее вводить нетто (реальный вес в готовом продукте) — брутто считаем от него.
const bruttoFrom = (netto, loss) => {
  const n = Number(netto) || 0;
  return loss > 0 ? round3(n / (1 - loss / 100)) : n;
};

// При загрузке существующего рецепта (где хранится только amount=брутто) восстанавливает netto для UI.
export const hydrateRecipeNetto = (recipe, inventory) => (recipe || []).map((r) => {
  const loss = lossPercent(inventory, r.inventory_id, r.processing_method);
  const netto = loss > 0 ? round3(Number(r.amount) * (1 - loss / 100)) : Number(r.amount);
  return { ...r, netto };
});

export default function RecipeEditor({ recipe, onChange, inventory, excludeId, testPrefix = "ingredient", emptyText = "Списание со склада не настроено" }) {
  const list = excludeId ? inventory.filter((i) => i.id !== excludeId) : inventory;
  const rows = recipe || [];

  const addRow = () => {
    const first = list[0];
    if (!first) { toast.error("Сначала добавьте ингредиенты и полуфабрикаты на складе (Меню и склад → Склад)"); return; }
    onChange([...rows, { inventory_id: first.id, name: first.name, amount: 1, netto: 1, unit: first.measure }]);
  };
  const updateRow = (i, field, value) => {
    const next = [...rows];
    const row = next[i];
    if (field === "inventory_id") {
      const inv = inventory.find((x) => x.id === value);
      const loss = lossPercent(inventory, value, row.processing_method);
      next[i] = { ...row, inventory_id: value, name: inv?.name || "", unit: inv?.measure || "pcs", amount: bruttoFrom(row.netto, loss) };
    } else if (field === "unit") {
      next[i] = { ...row, unit: value };
    } else if (field === "processing_method") {
      const loss = lossPercent(inventory, row.inventory_id, value);
      next[i] = { ...row, processing_method: value, amount: bruttoFrom(row.netto, loss) };
    } else if (field === "netto") {
      const loss = lossPercent(inventory, row.inventory_id, row.processing_method);
      next[i] = { ...row, netto: value, amount: bruttoFrom(value, loss) };
    }
    onChange(next);
  };
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-[var(--ink-faint)]">{emptyText}</p>}
      {rows.length > 0 && (
        <div className="flex gap-2 text-[10px] text-[var(--ink-faint)] px-1">
          <span className="flex-1 min-w-0">Ингредиент</span>
          <span className="w-16 text-center">нетто</span>
          <span className="w-16 text-center">ед.</span>
          <span className="w-20 text-center">обработка</span>
          <span className="w-16 text-center">брутто</span>
          <span className="w-4" />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 items-center" data-testid={`${testPrefix}-row-${i}`}>
          <div className="flex-1 min-w-0">
            <SearchableSelect value={r.inventory_id} onChange={(v) => updateRow(i, "inventory_id", v)}
              options={list.map((inv) => ({ value: inv.id, label: inv.name }))} data-testid={`${testPrefix}-inventory-${i}`} />
          </div>
          <input type="number" step="0.001" value={r.netto ?? r.amount} onChange={(e) => updateRow(i, "netto", e.target.value)}
            title="Вес ингредиента в готовом продукте (нетто)"
            className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm outline-none focus:border-[var(--accent)]" data-testid={`${testPrefix}-amount-${i}`} />
          <select value={r.unit || ""} onChange={(e) => updateRow(i, "unit", e.target.value)}
            className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm outline-none focus:border-[var(--accent)]" data-testid={`${testPrefix}-unit-${i}`}>
            {unitOptions(inventory.find((x) => x.id === r.inventory_id)?.measure).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={r.processing_method || ""} onChange={(e) => updateRow(i, "processing_method", e.target.value)} data-testid={`${testPrefix}-method-${i}`}
            className="w-20 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm outline-none focus:border-[var(--accent)]">
            <option value="">без потерь</option>
            <option value="cold">хол.</option>
            <option value="boil">вар.</option>
            <option value="fry">жар.</option>
            <option value="stew">туш.</option>
            <option value="bake">зап.</option>
          </select>
          <span className="w-16 text-center text-sm text-[var(--ink-dim)] tabular-nums" title="Списывается со склада и идёт в себестоимость" data-testid={`${testPrefix}-brutto-${i}`}>{r.amount}</span>
          <button onClick={() => removeRow(i)} className="text-[var(--ink-dim)] hover:text-[var(--danger)] shrink-0"><Trash2 size={16} /></button>
        </div>
      ))}
      <button onClick={addRow} type="button" data-testid={`${testPrefix}-add-btn`} className="text-[var(--success)] text-sm flex items-center gap-1 hover:text-[var(--ink)]">
        <Plus size={14} /> Ингредиент
      </button>
    </div>
  );
}
