import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiErr } from "@/lib/api";
import { toast } from "sonner";
import {
  Plus, Trash2, Pencil, Printer, Cpu, Copy, Play, RotateCw, Wifi, WifiOff, HelpCircle,
  FlaskConical, Type, Image as ImageIcon, Upload,
} from "lucide-react";
import { PageHead, Btn, Field, SelectField, Modal } from "@/components/admin/ui";

const stationLabel = { kitchen: "Кухня", bar: "Бар", precheck: "Пречек (касса)" };
const jobTypeLabel = { ticket: "Заказ", void: "Сторно", precheck: "Пречек", test: "Тест", text: "Текст", image: "Картинка" };
const jobStatusStyle = {
  pending: "text-[#FACC15] bg-[#FACC1511]",
  sent: "text-[#00E5FF] bg-[#00E5FF11]",
  printed: "text-[#00E676] bg-[#00E67611]",
  failed: "text-[#FF3B30] bg-[#FF3B3011]",
};
const jobStatusLabel = { pending: "В очереди", sent: "Отправлено", printed: "Напечатано", failed: "Ошибка" };

export default function Printers() {
  const qc = useQueryClient();
  const { data: printers = [] } = useQuery({ queryKey: ["printers"], queryFn: async () => (await api.get("/printers")).data });
  const { data: workshops = [] } = useQuery({ queryKey: ["workshops"], queryFn: async () => (await api.get("/workshops")).data });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: async () => (await api.get("/agents")).data });
  const { data: jobs = [] } = useQuery({ queryKey: ["print-jobs"], queryFn: async () => (await api.get("/print-jobs")).data, refetchInterval: 4000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data });

  const [pModal, setPModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [aModal, setAModal] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [emuJobs, setEmuJobs] = useState(null);
  const [textModal, setTextModal] = useState(null);
  const [textValue, setTextValue] = useState("");
  const [imageModal, setImageModal] = useState(null);
  const [imgData, setImgData] = useState(null);
  const [imgName, setImgName] = useState("");
  const [logoModal, setLogoModal] = useState(false);
  const [logoData, setLogoData] = useState(null);
  const [receiptForm, setReceiptForm] = useState({ name: "", address: "", phone: "", footer_note: "" });

  useEffect(() => {
    if (settings) setReceiptForm({
      name: settings.name || "", address: settings.address || "",
      phone: settings.phone || "", footer_note: settings.footer_note || "",
    });
  }, [settings]);

  const saveReceipt = async () => {
    try {
      await api.put("/settings/receipt", receiptForm);
      toast.success("Данные чека сохранены");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  const onLogoFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setLogoData(r.result);
    r.readAsDataURL(f);
  };
  const saveLogo = async () => {
    if (!logoData) { toast.error("Выберите изображение"); return; }
    try {
      await api.put("/settings/logo", { image: logoData });
      toast.success("Логотип сохранён");
      setLogoModal(false); setLogoData(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const toggleLogo = async (enabled) => {
    try {
      await api.put("/settings/logo", { enabled });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const removeLogo = async () => {
    try {
      await api.delete("/settings/logo");
      toast.success("Логотип удалён");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  const doTest = async (p) => {
    try {
      await api.post(`/printers/${p.id}/test`);
      toast.success(`Тест отправлен на «${p.name}»`);
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const doText = async () => {
    if (!textValue.trim()) { toast.error("Введите текст"); return; }
    try {
      await api.post(`/printers/${textModal.id}/print-text`, { text: textValue });
      toast.success("Текст отправлен на печать");
      setTextModal(null); setTextValue("");
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImgName(f.name);
    const r = new FileReader();
    r.onload = () => setImgData(r.result);
    r.readAsDataURL(f);
  };
  const doImage = async () => {
    if (!imgData) { toast.error("Выберите изображение"); return; }
    try {
      await api.post(`/printers/${imageModal.id}/print-image`, { image: imgData });
      toast.success("Изображение отправлено на печать");
      setImageModal(null); setImgData(null); setImgName("");
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
    } catch (e) { toast.error(apiErr(e)); }
  };

  const wsName = (id) => workshops.find((w) => w.id === id)?.name || "—";

  const openPrinter = (p) => {
    setEditing(p);
    setForm(p ? { ...p } : { name: "", station: "kitchen", workshop_id: workshops[0]?.id || "", local_ip: "192.168.0.100", port: 9100, codepage_label: "cp866", escape_t_value: 17, paper_width_mm: 80, active: true });
    setPModal(true);
  };

  const savePrinter = async () => {
    try {
      const body = {
        name: form.name, station: form.station,
        workshop_id: form.station === "precheck" ? null : (form.workshop_id || null),
        local_ip: form.local_ip, port: Number(form.port),
        codepage_label: form.codepage_label || "cp866", escape_t_value: Number(form.escape_t_value ?? 17),
        paper_width_mm: Number(form.paper_width_mm), active: form.active ?? true,
      };
      if (editing) await api.patch(`/printers/${editing.id}`, body);
      else await api.post("/printers", body);
      toast.success("Сохранено");
      setPModal(false);
      qc.invalidateQueries({ queryKey: ["printers"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delPrinter = async (id) => { await api.delete(`/printers/${id}`); qc.invalidateQueries({ queryKey: ["printers"] }); };

  const addAgent = async () => {
    try {
      await api.post("/agents", { name: agentName || "Новый агент" });
      toast.success("Агент создан");
      setAModal(false); setAgentName("");
      qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delAgent = async (id) => { await api.delete(`/agents/${id}`); qc.invalidateQueries({ queryKey: ["agents"] }); };
  const copyKey = async (k) => {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = k; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch { return false; }
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(k);
        toast.success("Ключ скопирован");
        return;
      }
      throw new Error("no clipboard");
    } catch {
      if (fallback()) toast.success("Ключ скопирован");
      else toast.error("Не удалось скопировать — выделите ключ вручную");
    }
  };

  const retry = async (id) => { await api.post(`/print-jobs/${id}/retry`); qc.invalidateQueries({ queryKey: ["print-jobs"] }); };

  const emulate = async () => {
    try {
      const { data } = await api.post("/agent/emulate");
      qc.invalidateQueries({ queryKey: ["print-jobs"] });
      qc.invalidateQueries({ queryKey: ["printers"] });
      if (data.processed === 0) { toast.info("Нет заданий в очереди"); return; }
      setEmuJobs(data.jobs);
      toast.success(`Напечатано заданий: ${data.processed}`);
    } catch (e) { toast.error(apiErr(e)); }
  };

  const StatusBadge = ({ s }) => (
    <span className={`text-xs px-2 py-0.5 rounded-md font-semibold inline-flex items-center gap-1 ${s === "online" ? "text-[#00E676] bg-[#00E67611]" : s === "offline" ? "text-[#FF3B30] bg-[#FF3B3011]" : "text-[#A1A1AA] bg-[#27272A]"}`}>
      {s === "online" ? <Wifi size={12} /> : s === "offline" ? <WifiOff size={12} /> : null}
      {s === "online" ? "онлайн" : s === "offline" ? "офлайн" : "неизв."}
    </span>
  );

  return (
    <div>
      <PageHead title="Печать" subtitle="Принтеры по цехам, агенты-мосты и очередь заданий"
        action={<Btn onClick={() => openPrinter(null)} data-testid="add-printer-btn"><Plus size={16} className="inline mr-1" /> Принтер</Btn>} />

      {/* Receipt settings: логотип + данные заведения */}
      <div className="bg-[#121212] border border-[#27272A] rounded-xl p-5 mb-8">
        <h2 className="font-head text-lg font-bold mb-4">Настройка чека</h2>
        <div className="flex items-start gap-4 mb-5">
          <div className="w-24 h-16 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">
            {settings?.logo_image
              ? <img src={settings.logo_image} alt="logo" className="max-h-full max-w-full object-contain" data-testid="logo-preview" />
              : <ImageIcon className="text-[#52525B]" size={22} />}
          </div>
          <div className="flex-1">
            <div className="font-semibold">Логотип на чеках</div>
            <div className="text-xs text-[#A1A1AA]">Печатается по центру в шапке заказных чеков и пречеков</div>
            {settings?.logo_image && !settings?.logo_enabled && <div className="text-xs text-[#FACC15] mt-1">Загружен, но выключен</div>}
          </div>
          <div className="flex items-center gap-3">
            {settings?.logo_image && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={!!settings?.logo_enabled} onChange={(e) => toggleLogo(e.target.checked)} className="accent-[#FF5A00] w-4 h-4" data-testid="logo-toggle" />
                Печатать
              </label>
            )}
            <Btn variant="ghost" onClick={() => { setLogoData(null); setLogoModal(true); }} data-testid="upload-logo-btn"><Upload size={16} className="inline mr-1" /> {settings?.logo_image ? "Заменить" : "Логотип"}</Btn>
            {settings?.logo_image && <button onClick={removeLogo} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid="remove-logo-btn"><Trash2 size={16} /></button>}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-[#27272A] pt-5">
          <Field label="Название заведения" value={receiptForm.name} onChange={(e) => setReceiptForm({ ...receiptForm, name: e.target.value })} data-testid="receipt-name-input" />
          <Field label="Телефон" value={receiptForm.phone} onChange={(e) => setReceiptForm({ ...receiptForm, phone: e.target.value })} data-testid="receipt-phone-input" />
          <Field label="Адрес" value={receiptForm.address} onChange={(e) => setReceiptForm({ ...receiptForm, address: e.target.value })} data-testid="receipt-address-input" />
          <Field label="Подпись внизу чека" value={receiptForm.footer_note} onChange={(e) => setReceiptForm({ ...receiptForm, footer_note: e.target.value })} data-testid="receipt-footer-input" />
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-[#52525B]">Название, адрес и телефон печатаются в шапке пречека (счёта гостю).</p>
          <Btn onClick={saveReceipt} data-testid="save-receipt-btn">Сохранить данные чека</Btn>
        </div>
      </div>

      {/* Printers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {printers.map((p) => (
          <div key={p.id} className="bg-[#121212] border border-[#27272A] rounded-xl p-5" data-testid={`printer-${p.id}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#FF5A0022] text-[#FF5A00] flex items-center justify-center"><Printer size={20} /></div>
                <div>
                  <div className="font-semibold flex items-center gap-2">{p.name} {!p.active && <span className="text-xs text-[#52525B]">(выкл)</span>}</div>
                  <div className="text-xs text-[#A1A1AA]">{stationLabel[p.station]}{p.station !== "precheck" ? ` · ${wsName(p.workshop_id)}` : ""}</div>
                </div>
              </div>
              <StatusBadge s={p.status} />
            </div>
            <div className="text-xs text-[#A1A1AA] tabnum mb-3">{p.local_ip}:{p.port} · {p.codepage_label} · ESC t {p.escape_t_value} · {p.paper_width_mm}мм</div>
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                <button onClick={() => doTest(p)} data-testid={`test-printer-${p.id}`}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md bg-[#1A1A1A] border border-[#27272A] hover:border-[#00E676] text-[#00E676]"><FlaskConical size={13} /> Тест</button>
                <button onClick={() => { setTextValue(""); setTextModal(p); }} data-testid={`text-printer-${p.id}`}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md bg-[#1A1A1A] border border-[#27272A] hover:border-[#00E5FF] text-[#00E5FF]"><Type size={13} /> Текст</button>
                <button onClick={() => { setImgData(null); setImgName(""); setImageModal(p); }} data-testid={`image-printer-${p.id}`}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md bg-[#1A1A1A] border border-[#27272A] hover:border-[#A855F7] text-[#A855F7]"><ImageIcon size={13} /> Картинка</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openPrinter(p)} className="text-[#A1A1AA] hover:text-white" data-testid={`edit-printer-${p.id}`}><Pencil size={16} /></button>
                <button onClick={() => delPrinter(p.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]" data-testid={`del-printer-${p.id}`}><Trash2 size={16} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Agents */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-head text-xl font-bold flex items-center gap-2"><Cpu size={20} /> Агенты-мосты</h2>
        <Btn variant="ghost" onClick={() => setAModal(true)} data-testid="add-agent-btn"><Plus size={16} className="inline mr-1" /> Агент</Btn>
      </div>
      <div className="bg-[#121212] border border-[#27272A] rounded-xl p-4 mb-4 flex items-start gap-3 text-sm text-[#A1A1AA]">
        <HelpCircle size={18} className="text-[#00E5FF] shrink-0 mt-0.5" />
        <div>Скачайте агента из папки <span className="text-white font-mono">print-agent/</span>, запустите на устройстве в одной сети с принтерами и вставьте ключ ниже. Агент сам подключится к облаку — проброс портов на роутере не нужен. Пока принтеров нет — жмите «Запустить эмулятор» ниже.</div>
      </div>
      <div className="space-y-2 mb-10">
        {agents.map((a) => (
          <div key={a.id} className="bg-[#121212] border border-[#27272A] rounded-lg px-4 py-3 flex items-center justify-between" data-testid={`agent-${a.id}`}>
            <div>
              <div className="font-semibold">{a.name}</div>
              <div className="text-xs text-[#52525B]">Последний сигнал: {a.last_heartbeat_at ? new Date(a.last_heartbeat_at).toLocaleString("ru-RU") : "нет"}</div>
            </div>
            <div className="flex items-center gap-3">
              <code className="text-xs text-[#A1A1AA] bg-[#0A0A0A] border border-[#27272A] rounded px-2 py-1 max-w-[220px] truncate">{a.api_key}</code>
              <button onClick={() => copyKey(a.api_key)} className="text-[#A1A1AA] hover:text-[#00E5FF]" data-testid={`copy-agent-${a.id}`}><Copy size={16} /></button>
              <button onClick={() => delAgent(a.id)} className="text-[#A1A1AA] hover:text-[#FF3B30]"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Print jobs */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-head text-xl font-bold">Очередь заданий</h2>
        <Btn onClick={emulate} data-testid="emulate-btn"><Play size={16} className="inline mr-1" /> Запустить эмулятор</Btn>
      </div>
      <div className="bg-[#121212] border border-[#27272A] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-[#A1A1AA] text-xs uppercase border-b border-[#27272A]">
            <th className="text-left p-4">Тип</th><th className="text-left p-4">Принтер</th>
            <th className="text-left p-4">Статус</th><th className="text-left p-4">Попыток</th>
            <th className="text-left p-4">Время</th><th className="p-4"></th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-[#1A1A1A]" data-testid={`job-${j.id}`}>
                <td className="p-4 font-medium">{jobTypeLabel[j.type]}</td>
                <td className="p-4 text-[#A1A1AA]">{j.printer_name}</td>
                <td className="p-4"><span className={`text-xs px-2 py-0.5 rounded-md font-semibold ${jobStatusStyle[j.status]}`}>{jobStatusLabel[j.status]}</span></td>
                <td className="p-4 text-[#A1A1AA] tabnum">{j.attempts}</td>
                <td className="p-4 text-[#A1A1AA]">{new Date(j.created_at).toLocaleTimeString("ru-RU")}</td>
                <td className="p-4 text-right">
                  {j.status === "failed" && <button onClick={() => retry(j.id)} className="text-[#00E5FF] hover:text-white flex items-center gap-1 ml-auto text-xs" data-testid={`retry-${j.id}`}><RotateCw size={14} /> Повтор</button>}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-[#52525B]">Заданий пока нет — отправьте заказ на кухню в кассе</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Printer modal */}
      <Modal open={pModal} onClose={() => setPModal(false)} title={editing ? "Настройка принтера" : "Новый принтер"}>
        <div className="space-y-4">
          <Field label="Название" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="printer-name-input" />
          <SelectField label="Станция" value={form.station || "kitchen"} onChange={(e) => setForm({ ...form, station: e.target.value })}
            options={[{ value: "kitchen", label: "Кухня" }, { value: "bar", label: "Бар" }, { value: "precheck", label: "Пречек (касса)" }]} />
          {form.station !== "precheck" && (
            <SelectField label="Цех (роутинг заказов)" value={form.workshop_id || ""} onChange={(e) => setForm({ ...form, workshop_id: e.target.value })}
              options={workshops.map((w) => ({ value: w.id, label: w.name }))} />
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Локальный IP" value={form.local_ip || ""} onChange={(e) => setForm({ ...form, local_ip: e.target.value })} data-testid="printer-ip-input" />
            <Field label="Порт" type="number" value={form.port ?? 9100} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Кодировка (кодек)" value={form.codepage_label || "cp866"} onChange={(e) => setForm({ ...form, codepage_label: e.target.value })}
              options={[{ value: "cp866", label: "cp866" }, { value: "cp1251", label: "cp1251" }]} />
            <Field label="ESC t (номер)" type="number" value={form.escape_t_value ?? 17} onChange={(e) => setForm({ ...form, escape_t_value: e.target.value })} data-testid="printer-esct-input" />
          </div>
          <p className="text-xs text-[#52525B] -mt-1">Номер команды ESC t подбирается под конкретную модель принтера (см. tools/printer-diagnostic.js). Подтверждено для оборудования: cp866, ESC t 17.</p>
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Ширина ленты" value={String(form.paper_width_mm || 80)} onChange={(e) => setForm({ ...form, paper_width_mm: e.target.value })}
              options={[{ value: "80", label: "80 мм" }, { value: "58", label: "58 мм" }]} />
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer pb-2.5">
                <input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-[#FF5A00] w-4 h-4" />
                Активен
              </label>
            </div>
          </div>
          <Btn onClick={savePrinter} className="w-full" data-testid="save-printer-btn">Сохранить</Btn>
        </div>
      </Modal>

      {/* Agent modal */}
      <Modal open={aModal} onClose={() => setAModal(false)} title="Новый агент-мост">
        <div className="space-y-4">
          <Field label="Название" placeholder="Мост — зал 1 этаж" value={agentName} onChange={(e) => setAgentName(e.target.value)} data-testid="agent-name-input" />
          <Btn onClick={addAgent} className="w-full" data-testid="save-agent-btn">Создать и получить ключ</Btn>
        </div>
      </Modal>

      {/* Logo upload modal */}
      <Modal open={logoModal} onClose={() => setLogoModal(false)} title="Логотип заведения">
        <div className="space-y-4">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#27272A] rounded-xl py-8 cursor-pointer hover:border-[#FF5A00] transition-colors">
            <Upload size={24} className="text-[#A1A1AA]" />
            <span className="text-sm text-[#A1A1AA]">Выберите изображение (PNG/JPG)</span>
            <input type="file" accept="image/*" onChange={onLogoFile} className="hidden" data-testid="logo-file-input" />
          </label>
          {(logoData || settings?.logo_image) && (
            <div className="bg-white rounded-lg p-3 flex justify-center">
              <img src={logoData || settings.logo_image} alt="logo preview" className="max-h-40 object-contain" />
            </div>
          )}
          <p className="text-xs text-[#52525B]">Лучше использовать монохромное лого. Будет преобразовано в чёрно-белое и вписано по ширине ленты каждого принтера.</p>
          <Btn onClick={saveLogo} className="w-full" data-testid="save-logo-btn">Сохранить и включить</Btn>
        </div>
      </Modal>

      {/* Custom text modal */}
      <Modal open={!!textModal} onClose={() => setTextModal(null)} title={`Печать текста → ${textModal?.name || ""}`}>
        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-[0.15em] text-[#A1A1AA]">Текст (каждая строка — новая строка на чеке)</label>
            <textarea value={textValue} onChange={(e) => setTextValue(e.target.value)} rows={6} data-testid="print-text-input"
              className="w-full mt-1 bg-[#0A0A0A] border border-[#27272A] rounded-lg px-4 py-2.5 focus:border-[#FF5A00] outline-none font-mono text-sm resize-none"
              placeholder="Например:&#10;С днём рождения!&#10;Скидка 10% по промокоду RESTO" />
          </div>
          <Btn onClick={doText} className="w-full" data-testid="send-text-btn">Отправить на печать</Btn>
        </div>
      </Modal>

      {/* Image modal */}
      <Modal open={!!imageModal} onClose={() => setImageModal(null)} title={`Печать картинки → ${imageModal?.name || ""}`}>
        <div className="space-y-4">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#27272A] rounded-xl py-8 cursor-pointer hover:border-[#A855F7] transition-colors" data-testid="image-dropzone">
            <Upload size={24} className="text-[#A1A1AA]" />
            <span className="text-sm text-[#A1A1AA]">{imgName || "Выберите изображение (PNG/JPG)"}</span>
            <input type="file" accept="image/*" onChange={onFile} className="hidden" data-testid="image-file-input" />
          </label>
          {imgData && (
            <div className="bg-white rounded-lg p-3 flex justify-center">
              <img src={imgData} alt="preview" className="max-h-48 object-contain" style={{ imageRendering: "pixelated" }} />
            </div>
          )}
          <p className="text-xs text-[#52525B]">Изображение будет преобразовано в монохром и обрезано по ширине ленты ({imageModal?.paper_width_mm || 80}мм).</p>
          <Btn onClick={doImage} className="w-full" data-testid="send-image-btn">Отправить на печать</Btn>
        </div>
      </Modal>

      {/* Emulator result */}
      {emuJobs && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEmuJobs(null)}>
          <div className="w-full max-w-md bg-[#121212] border border-[#27272A] rounded-xl p-6 max-h-[80vh] overflow-y-auto fade-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-head text-xl font-bold mb-4 flex items-center gap-2"><Printer size={20} /> Напечатано (эмуляция)</h3>
            <div className="space-y-4">
              {emuJobs.map((j) => (
                <div key={j.id} className="bg-white text-black rounded-lg p-4 font-mono text-xs whitespace-pre-wrap">{j.text}</div>
              ))}
            </div>
            <Btn onClick={() => setEmuJobs(null)} className="w-full mt-4" data-testid="emu-close-btn">Закрыть</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
