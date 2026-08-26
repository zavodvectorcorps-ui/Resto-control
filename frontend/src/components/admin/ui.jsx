import { X } from "lucide-react";

export function PageHead({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between mb-8">
      <div>
        <h1 className="font-head text-3xl font-extrabold mb-1">{title}</h1>
        {subtitle && <p className="text-[#A1A1AA]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Btn({ children, variant = "primary", className = "", ...rest }) {
  const styles = {
    primary: "bg-[#FF5A00] hover:bg-[#E04F00] text-white",
    ghost: "bg-[#1A1A1A] border border-[#27272A] hover:border-[#FF5A00] text-white",
    danger: "bg-[#1A1A1A] border border-[#27272A] hover:border-[#FF3B30] text-[#FF3B30]",
  };
  return (
    <button
      className={`px-4 py-2.5 rounded-lg text-sm font-semibold active:scale-95 transition-transform ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, ...rest }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">{label}</label>
      <input
        className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 focus:border-[#FF5A00] outline-none"
        {...rest}
      />
    </div>
  );
}

export function SelectField({ label, options, ...rest }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">{label}</label>
      <select
        className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 focus:border-[#FF5A00] outline-none"
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 fade-up" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-head text-xl font-bold">{title}</h3>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-white" data-testid="modal-close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
