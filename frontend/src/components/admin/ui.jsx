import { useEffect, useRef, useState } from "react";
import { X, ChevronDown, Search } from "lucide-react";

export function PageHead({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
      <div>
        <h1 className="font-head text-3xl font-extrabold mb-1 text-[var(--ink)]">{title}</h1>
        {subtitle && <p className="text-[var(--ink-dim)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Btn({ children, variant = "primary", size = "md", className = "", ...rest }) {
  const styles = {
    primary: "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-sm",
    ghost: "bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] text-[var(--ink)]",
    subtle: "bg-transparent hover:bg-[var(--surface-hover)] text-[var(--ink-dim)] hover:text-[var(--ink)]",
    danger: "bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--danger)] text-[var(--danger)]",
  };
  const sizes = {
    md: "px-4 py-2.5 text-sm",
    sm: "px-3 py-1.5 text-xs",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 ${sizes[size]} rounded-lg font-semibold leading-none active:scale-[0.97] transition-all disabled:opacity-40 disabled:pointer-events-none ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, className = "", ...rest }) {
  return (
    <div>
      {label && <label className="text-xs uppercase tracking-[0.12em] text-[var(--ink-dim)] font-medium">{label}</label>}
      <input
        className={`w-full mt-1 bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] rounded-lg px-4 py-2.5 focus:border-[var(--accent)] outline-none placeholder:text-[var(--ink-faint)] transition-colors ${className}`}
        {...rest}
      />
    </div>
  );
}

export function SelectField({ label, options, className = "", ...rest }) {
  return (
    <div>
      {label && <label className="text-xs uppercase tracking-[0.12em] text-[var(--ink-dim)] font-medium">{label}</label>}
      <select
        className={`w-full mt-1 bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] rounded-lg px-4 py-2.5 focus:border-[var(--accent)] outline-none transition-colors ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// Выпадающий список с поиском по названию — замена <select> там, где вариантов может быть много
// (ингредиенты, полуфабрикаты). Интерфейс совместим с SelectField: label, options, value, onChange.
export function SearchableSelect({ options, value, onChange, placeholder = "Выберите…", "data-testid": testId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQuery("");
  }, [open]);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} data-testid={testId}
        className="w-full flex items-center justify-between gap-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--ink)] rounded-lg px-3 py-2 text-sm text-left outline-none focus:border-[var(--accent)] hover:border-[var(--border-strong)] transition-colors">
        <span className={`truncate ${selected ? "" : "text-[var(--ink-faint)]"}`}>{selected?.label || placeholder}</span>
        <ChevronDown size={14} className="text-[var(--ink-faint)] shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[var(--border)] flex items-center gap-2">
            <Search size={14} className="text-[var(--ink-faint)] shrink-0" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
              placeholder="Поиск…" data-testid={testId ? `${testId}-search` : undefined}
              className="w-full bg-transparent text-sm outline-none text-[var(--ink)] placeholder:text-[var(--ink-faint)]" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-xs text-[var(--ink-faint)]">Ничего не найдено</div>}
            {filtered.map((o) => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-hover)] transition-colors ${o.value === value ? "text-[var(--accent)] font-semibold" : "text-[var(--ink)]"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SearchableSelectField({ label, options, value, onChange, placeholder, "data-testid": testId }) {
  return (
    <div>
      {label && <label className="text-xs uppercase tracking-[0.12em] text-[var(--ink-dim)] font-medium">{label}</label>}
      <div className="mt-1">
        <SearchableSelect options={options} value={value} onChange={onChange} placeholder={placeholder} data-testid={testId} />
      </div>
    </div>
  );
}

// Кнопка с выпадающим меню действий — группирует второстепенные операции вместо ряда отдельных кнопок.
export function ActionMenu({ label, icon: Icon, items, "data-testid": testId }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <Btn variant="ghost" onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {Icon && <Icon size={16} />} {label} <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </Btn>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden py-1">
          {items.map((it, i) => (
            it.divider ? <div key={i} className="h-px bg-[var(--border)] my-1" /> :
            <button key={i} onClick={() => { setOpen(false); it.onClick(); }} data-testid={it.testId}
              className="w-full flex items-center gap-2.5 text-left px-3.5 py-2.5 text-sm text-[var(--ink)] hover:bg-[var(--surface-hover)] transition-colors">
              {it.icon && <it.icon size={16} className="text-[var(--ink-dim)] shrink-0" />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 fade-up" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 max-h-[88vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-head text-xl font-bold text-[var(--ink)]">{title}</h3>
          <button onClick={onClose} className="text-[var(--ink-dim)] hover:text-[var(--ink)]" data-testid="modal-close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
