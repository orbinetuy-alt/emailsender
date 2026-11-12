"use client";

import { useEffect, useMemo, useState } from "react";

type Contact = { id: string; name: string; company: string; email: string; companyType: string; hub?: string; network?: string; jobTitle?: string; city?: string; emailQuality?: string; existingClientOffice?: string; status: string; updatedAt: string; lastError?: string };
type Template = { id: string; code: string; name: string; subject: string; body: string; active: boolean; version: number };
type CampaignFilters = { importId: string | null; importScope: "new" | "all"; types: string[]; hubs: string[]; companies: string[]; networks: string[]; emailQualities: string[]; excludeExistingClients: boolean };
type Campaign = { id: string; name: string; status: string; total: number; sent: number; errors: number; startAt: string | null; templateName?: string; filters?: CampaignFilters };
type Activity = { id: string; action: string; detail: string; createdAt: string };
type ContactImport = { id: string; fileName: string; total: number; created: number; updated: number; rejected: number; createdAt: string };
type Dashboard = {
  viewer: { name: string; email: string };
  connected: boolean;
  sendingEnabled: boolean;
  contacts: Contact[];
  templates: Template[];
  campaigns: Campaign[];
  activity: Activity[];
  imports: ContactImport[];
  filterOptions: { types: string[]; hubs: string[]; companies: string[]; networks: string[]; emailQualities: string[] };
};

const emptyFilters: CampaignFilters = { importId: null, importScope: "new", types: [], hubs: [], companies: [], networks: [], emailQualities: [], excludeExistingClients: true };

function FilterPicker({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  return <details className="filter-picker"><summary><span>{label}</span><strong>{selected.length ? `${selected.length} elegidos` : "Todos"}</strong></summary><div>{options.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))}/><span>{option}</span></label>)}{!options.length && <small>Importá contactos para habilitar este filtro.</small>}</div></details>;
}

const statusLabels: Record<string, string> = {
  DRAFT: "Borrador", READY: "Listo", QUEUED: "En cola", PROCESSING: "Procesando",
  SENT: "Enviado", ERROR: "Error", PAUSED: "Pausado", DO_NOT_CONTACT: "No contactar", REPLIED: "Respondió",
};

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    contacts: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    templates: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    campaigns: <><path d="M3 11l18-5v12L3 14z"/><path d="M11.6 16.5 13 21H8l-1.2-6"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8c.12.39.35.74.66 1 .3.26.7.4 1.1.4H21v4h-.1a1.7 1.7 0 0 0-1.5 1.6z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function DashboardClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState("contacts");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [editor, setEditor] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [contactModal, setContactModal] = useState<"manual" | "xlsx" | null>(null);
  const [newContact, setNewContact] = useState({ name: "", email: "", company: "", companyType: "" });
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [campaignModal, setCampaignModal] = useState(false);
  const [campaign, setCampaign] = useState({ name: "", templateId: "", intervalMinutes: 5, startAt: "", filters: emptyFilters });
  const [campaignCount, setCampaignCount] = useState(0);

  async function load() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const body = await response.json();
    if (response.status === 401) {
      setAuthRequired(true);
      return;
    }
    if (!response.ok) throw new Error(body.error || "No se pudo cargar el panel.");
    setAuthRequired(false);
    setData(body);
    if (!activeTemplate && body.templates[0]) setActiveTemplate(body.templates[0].id);
  }

  useEffect(() => { load().catch((error) => setToast(error.message)); }, []);
  useEffect(() => {
    const template = data?.templates.find((item) => item.id === activeTemplate);
    if (template) setEditor({ ...template });
  }, [activeTemplate, data]);
  useEffect(() => {
    if (!campaignModal) return;
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/campaigns/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(campaign.filters) });
        const body = await response.json();
        if (response.ok) setCampaignCount(body.count);
      } catch { setCampaignCount(0); }
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [campaign.filters, campaignModal]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = query.toLowerCase();
    return data.contacts.filter((contact) =>
      (!needle || `${contact.name} ${contact.company} ${contact.email}`.toLowerCase().includes(needle)) &&
      (!status || contact.status === status),
    );
  }, [data, query, status]);

  const counts = useMemo(() => ({
    total: data?.contacts.length || 0,
    queued: data?.contacts.filter((c) => ["QUEUED", "PROCESSING"].includes(c.status)).length || 0,
    sent: data?.contacts.filter((c) => c.status === "SENT").length || 0,
    errors: data?.contacts.filter((c) => c.status === "ERROR").length || 0,
  }), [data]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }

  async function saveTemplate() {
    if (!editor) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/templates/${editor.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editor) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load(); notify("Plantilla guardada y versionada.");
    } catch (error) { notify(error instanceof Error ? error.message : "Error"); }
    finally { setBusy(false); }
  }

  async function toggleSending() {
    if (!data) return;
    const enabled = !data.sendingEnabled;
    if (enabled && !window.confirm("¿Confirmás que las plantillas y destinatarios fueron revisados?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/settings/sending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, confirmation: enabled ? "HABILITAR" : "" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load(); notify(enabled ? "Envíos habilitados." : "Envíos pausados.");
    } catch (error) { notify(error instanceof Error ? error.message : "Error"); }
    finally { setBusy(false); }
  }

  async function createContact(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "manual", contact: newContact }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNewContact({ name: "", email: "", company: "", companyType: "" });
      setContactModal(null);
      await load();
      notify("Contacto agregado correctamente.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo agregar el contacto."); }
    finally { setBusy(false); }
  }

  async function importXlsx(event: React.FormEvent) {
    event.preventDefault();
    if (!xlsxFile) return notify("Seleccioná un archivo Excel.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", xlsxFile);
      const response = await fetch("/api/imports/contacts", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setXlsxFile(null);
      setContactModal(null);
      await load();
      notify(`${body.created} nuevos · ${body.updated} actualizados${body.rejected ? ` · ${body.rejected} rechazados` : ""}`);
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo importar el Excel."); }
    finally { setBusy(false); }
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!campaignCount) return notify("Los filtros no tienen contactos elegibles.");
    if (!window.confirm(`Se programarán ${campaignCount} mensajes con un intervalo de ${campaign.intervalMinutes} minutos. ¿Continuar?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...campaign, startAt: campaign.startAt ? new Date(campaign.startAt).toISOString() : undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setCampaign({ name: "", templateId: "", intervalMinutes: 5, startAt: "", filters: emptyFilters });
      setCampaignModal(false);
      await load();
      notify(`Campaña creada con ${body.scheduled} destinatarios.`);
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo crear la campaña."); }
    finally { setBusy(false); }
  }

  if (authRequired) return <div className="auth-page"><div className="auth-card"><div className="auth-brand">R</div><p className="eyebrow">RELAY WORKSPACE</p><h1>Tu comunicación comercial, en orden.</h1><p>Conectá la cuenta autorizada de Google para administrar campañas, enviar mensajes y detectar respuestas.</p><a className="google-button" href="/api/google/connect"><span>G</span>Continuar con Google</a><small>Solicitaremos permiso para enviar correos y consultar únicamente sus metadatos.</small></div></div>;
  if (!data) return <div className="loading"><div className="loading-mark">R</div><p>{toast || "Preparando tu espacio…"}</p></div>;

  const nav = [
    ["contacts", "contacts", "Contactos"], ["templates", "templates", "Plantillas"],
    ["campaigns", "campaigns", "Campañas"], ["activity", "activity", "Actividad"], ["settings", "settings", "Configuración"],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo"><span>R</span><div><strong>Relay</strong><small>Workspace outreach</small></div></div>
        <nav>{nav.map(([id, icon, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon name={icon}/><span>{label}</span>{id === "contacts" && <em>{data.contacts.length}</em>}</button>)}</nav>
        <div className="sidebar-bottom">
          <div className={`connection ${data.connected ? "ok" : ""}`}><span/><div><strong>{data.connected ? "Google conectado" : "Modo demostración"}</strong><small>{data.connected ? data.viewer.email : "Conectá Workspace al publicar"}</small></div></div>
          <div className="profile"><span>{data.viewer.name.charAt(0)}</span><div><strong>{data.viewer.name}</strong><small>Administradora</small></div><button>•••</button></div>
        </div>
      </aside>

      <main className="main">
        <header className="topline"><div><span className={`pulse ${data.sendingEnabled ? "on" : ""}`}/>{data.sendingEnabled ? "Automatización activa" : "Envíos pausados"}</div><button className="ghost" onClick={() => load()}>Actualizar</button></header>

        {tab === "contacts" && <section>
          <div className="page-title"><div><p className="eyebrow">BASE COMERCIAL</p><h1>Contactos</h1><p>Cargá la base diaria completa. Las campañas deciden después a quién contactar.</p></div><div className="title-actions"><button className="secondary" onClick={() => setContactModal("xlsx")}>Importar Excel</button><button className="primary" onClick={() => setContactModal("manual")}>+ Nuevo contacto</button></div></div>
          <div className="stats">
            <article><span>Total de contactos</span><strong>{counts.total}</strong><small>en la base actual</small></article>
            <article><span>En cola</span><strong>{counts.queued}</strong><small>programados o procesando</small></article>
            <article><span>Enviados</span><strong>{counts.sent}</strong><small>confirmados por Gmail</small></article>
            <article><span>Requieren atención</span><strong>{counts.errors}</strong><small>errores para revisar</small></article>
          </div>
          <div className="card table-card">
            <div className="toolbar"><div className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, empresa o email"/></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="selection">{filtered.length} resultados</span><button className="secondary" onClick={() => { setTab("campaigns"); setCampaignModal(true); }}>Crear campaña</button></div>
            <div className="table-scroll"><table><thead><tr><th>Contacto</th><th>Empresa</th><th>Tipo</th><th>Hub</th><th>Calidad email</th><th>Estado</th><th>Actualización</th></tr></thead><tbody>{filtered.map((contact) => <tr key={contact.id}><td><div className="person"><span>{contact.name.split(" ").map((word) => word[0]).join("").slice(0,2)}</span><div><strong>{contact.name}</strong><small>{contact.email}{contact.jobTitle ? ` · ${contact.jobTitle}` : ""}</small></div></div></td><td>{contact.company || "—"}<small className="cell-detail">{contact.network}</small></td><td><code>{contact.companyType}</code></td><td>{contact.hub || contact.city || "—"}</td><td><span className="quality">{contact.emailQuality || "Sin dato"}</span></td><td><span className={`status ${contact.status.toLowerCase()}`}>{statusLabels[contact.status] || contact.status}</span>{contact.lastError && <small className="row-error">{contact.lastError}</small>}</td><td>{new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(contact.updatedAt))}</td></tr>)}{!filtered.length && <tr><td colSpan={7}><div className="empty-state"><strong>{data.contacts.length ? "No hay coincidencias" : "Todavía no hay contactos"}</strong><span>{data.contacts.length ? "Probá con otro filtro." : "Importá el Excel diario para construir la base comercial."}</span></div></td></tr>}</tbody></table></div>
          </div>
          {!!data.imports?.length && <div className="card imports-list"><div className="section-head"><strong>Listas importadas</strong><span>{data.imports.length} recientes</span></div>{data.imports.map((item) => <div className="import-row" key={item.id}><div><strong>{item.fileName}</strong><small>{new Intl.DateTimeFormat("es-UY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))} · {item.total} filas</small></div><span>{item.created} nuevos · {item.updated} existentes{item.rejected ? ` · ${item.rejected} rechazados` : ""}</span><button className="secondary" onClick={() => { setCampaign({ name: "", templateId: "", intervalMinutes: 5, startAt: "", filters: { ...emptyFilters, importId: item.id } }); setTab("campaigns"); setCampaignModal(true); }}>Campaña con nuevos</button></div>)}</div>}
        </section>}

        {tab === "templates" && <section>
          <div className="page-title"><div><p className="eyebrow">CONTENIDO</p><h1>Plantillas</h1><p>Personalizá el mensaje para cada tipo de empresa y conservá su historial.</p></div><button className="primary">+ Nueva plantilla</button></div>
          <div className="template-layout"><div className="card template-list"><div className="section-head"><strong>Tipos de mensaje</strong><span>{data.templates.length}</span></div>{data.templates.map((template) => <button key={template.id} className={activeTemplate === template.id ? "active" : ""} onClick={() => setActiveTemplate(template.id)}><span>{template.code.replace("TIPO_", "0")}</span><div><strong>{template.name}</strong><small>{template.code} · versión {template.version}</small></div><em className={template.active ? "enabled" : ""}/></button>)}</div>
            {editor && <div className="card editor"><div className="editor-head"><div><p className="eyebrow">{editor.code}</p><h2>{editor.name}</h2></div><label className="toggle"><input type="checkbox" checked={editor.active} onChange={(e) => setEditor({ ...editor, active: e.target.checked })}/><span/></label></div><div className="form-row"><label>Nombre interno<input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })}/></label><label>Código<input value={editor.code} disabled/></label></div><label>Asunto<input value={editor.subject} onChange={(e) => setEditor({ ...editor, subject: e.target.value })}/></label><label>Mensaje<textarea value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })}/></label><div className="variables"><span>Variables</span>{["{{nombre}}", "{{empresa}}", "{{email}}", "{{tipo}}", "{{hub}}", "{{red}}", "{{cargo}}", "{{ciudad}}"].map((variable) => <code key={variable}>{variable}</code>)}</div><div className="editor-actions"><span>Los cambios crean una nueva versión.</span><button className="primary" disabled={busy} onClick={saveTemplate}>Guardar cambios</button></div></div>}
          </div>
        </section>}

        {tab === "campaigns" && <section>
          <div className="page-title"><div><p className="eyebrow">AUTOMATIZACIÓN</p><h1>Campañas</h1><p>Elegí un segmento de la base, asignale un mensaje y programá los envíos.</p></div><button className="primary" onClick={() => setCampaignModal(true)}>+ Crear campaña</button></div>
          <div className="campaign-grid">{data.campaigns.map((campaign) => <article className="card campaign" key={campaign.id}><div className="campaign-head"><span className={`status ${campaign.status.toLowerCase()}`}>{campaign.status === "DRAFT" ? "Borrador" : campaign.status}</span><button className="dots">•••</button></div><h2>{campaign.name}</h2><p>{campaign.total} destinatarios · {campaign.templateName || "Plantilla"}</p><div className="campaign-filters">{campaign.filters?.types?.slice(0,2).map((value) => <span key={value}>{value}</span>)}{campaign.filters?.hubs?.slice(0,2).map((value) => <span key={value}>{value}</span>)}</div><div className="progress"><span style={{ width: `${campaign.total ? (campaign.sent / campaign.total) * 100 : 0}%` }}/></div><div className="campaign-metrics"><div><strong>{campaign.sent}</strong><small>Enviados</small></div><div><strong>{campaign.total - campaign.sent - campaign.errors}</strong><small>Pendientes</small></div><div><strong>{campaign.errors}</strong><small>Errores</small></div></div></article>)}{!data.campaigns.length && <div className="card campaign-empty"><strong>Todavía no hay campañas</strong><p>Importá la base y creá un segmento por tipo, hub, empresa, red o calidad del email.</p><button className="primary" onClick={() => setCampaignModal(true)}>Crear primera campaña</button></div>}</div>
        </section>}

        {tab === "activity" && <section>
          <div className="page-title"><div><p className="eyebrow">TRAZABILIDAD</p><h1>Actividad</h1><p>Cada cambio importante queda registrado para su revisión.</p></div></div>
          <div className="card activity-list">{data.activity.map((item) => <div key={item.id}><span className="activity-icon">{item.action.includes("ERROR") ? "!" : "✓"}</span><div><strong>{item.detail}</strong><small>{item.action}</small></div><time>{new Intl.DateTimeFormat("es-UY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time></div>)}</div>
        </section>}

        {tab === "settings" && <section>
          <div className="page-title"><div><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>Configuración</h1><p>Administrá la conexión, la seguridad y el comportamiento de los envíos.</p></div></div>
          <div className="settings-grid"><div className="card settings-card"><div><h2>Google Workspace</h2><p>Conectá la cuenta que enviará los mensajes. Nunca almacenamos su contraseña.</p></div><div className="connection-row"><span className={data.connected ? "connected" : ""}>G</span><div><strong>{data.connected ? data.viewer.email : "Cuenta sin conectar"}</strong><small>{data.connected ? "Gmail autorizado" : "OAuth requerido en producción"}</small></div><a href="/api/google/connect" className="secondary">{data.connected ? "Reconectar" : "Conectar Google"}</a></div></div>
            <div className="card settings-card"><div><h2>Control maestro</h2><p>Al pausar, ningún worker reclamará nuevos trabajos de envío.</p></div><div className="master-control"><div><span className={`pulse ${data.sendingEnabled ? "on" : ""}`}/><strong>{data.sendingEnabled ? "Envíos habilitados" : "Envíos pausados"}</strong></div><button className={data.sendingEnabled ? "danger" : "primary"} disabled={busy} onClick={toggleSending}>{data.sendingEnabled ? "Pausar todo" : "Habilitar envíos"}</button></div></div>
            <div className="card settings-card"><div><h2>Política de envío</h2><p>La primera versión programa un mensaje cada cinco minutos.</p></div><div className="policy"><label>Intervalo<input value="5 minutos" disabled/></label><label>Zona horaria<input value="America/Montevideo" disabled/></label></div></div></div>
        </section>}
      </main>
      {contactModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setContactModal(null); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
          <div className="modal-head"><div><p className="eyebrow">BASE COMERCIAL</p><h2 id="contact-modal-title">{contactModal === "manual" ? "Nuevo contacto" : "Importar contactos"}</h2></div><button className="modal-close" onClick={() => setContactModal(null)} disabled={busy} aria-label="Cerrar">×</button></div>
          {contactModal === "manual" ? <form onSubmit={createContact} className="modal-form">
            <label>Nombre y apellido<input required maxLength={160} value={newContact.name} onChange={(event) => setNewContact({ ...newContact, name: event.target.value })} placeholder="Ej. Ana Pérez" autoFocus/></label>
            <label>Email<input required type="email" maxLength={320} value={newContact.email} onChange={(event) => setNewContact({ ...newContact, email: event.target.value })} placeholder="ana@empresa.com"/></label>
            <label>Empresa<input maxLength={200} value={newContact.company} onChange={(event) => setNewContact({ ...newContact, company: event.target.value })} placeholder="Nombre de la empresa"/></label>
            <label>Tipo o vertical<input required list="contact-types" maxLength={200} value={newContact.companyType} onChange={(event) => setNewContact({ ...newContact, companyType: event.target.value })} placeholder="Ej. Agencia, Fintech, Aerolíneas"/><datalist id="contact-types">{data.filterOptions?.types?.map((value) => <option value={value} key={value}/>)}</datalist></label>
            <div className="modal-actions"><button type="button" className="secondary" onClick={() => setContactModal(null)} disabled={busy}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Agregar contacto"}</button></div>
          </form> : <form onSubmit={importXlsx} className="modal-form">
            <div className="csv-help"><strong>Excel diario de prospección</strong><p>El sistema detecta automáticamente la hoja y las columnas <code>Tipo</code>, <code>Hub</code>, <code>Agencia o empresa</code>, <code>Red</code>, <code>Nombre</code>, <code>Cargo</code>, <code>Ciudad</code>, <code>Email</code> y sus datos adicionales.</p></div>
            <label className="file-picker"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setXlsxFile(event.target.files?.[0] ?? null)}/><span>{xlsxFile ? xlsxFile.name : "Elegir archivo .xlsx"}</span><small>Máximo 8 MB o 5000 contactos.</small></label>
            <div className="import-note"><strong>Actualización sin duplicados</strong><span>El email identifica a cada persona. Si vuelve a aparecer otro día, actualizamos sus datos y conservamos su historial de comunicación.</span></div>
            <div className="modal-actions"><button type="button" className="secondary" onClick={() => setContactModal(null)} disabled={busy}>Cancelar</button><button type="submit" className="primary" disabled={busy || !xlsxFile}>{busy ? "Importando…" : "Importar Excel"}</button></div>
          </form>}
        </div>
      </div>}
      {campaignModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCampaignModal(false); }}>
        <div className="modal campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-modal-title">
          <div className="modal-head"><div><p className="eyebrow">NUEVA CAMPAÑA</p><h2 id="campaign-modal-title">Elegir destinatarios y mensaje</h2></div><button className="modal-close" onClick={() => setCampaignModal(false)} disabled={busy} aria-label="Cerrar">×</button></div>
          <form onSubmit={createCampaign} className="modal-form">
            <div className="campaign-source"><label>Base de destinatarios<select value={campaign.filters.importId ?? ""} onChange={(event) => setCampaign({ ...campaign, filters: { ...campaign.filters, importId: event.target.value || null } })}><option value="">Toda la base</option>{data.imports?.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(item.createdAt))}</option>)}</select></label>{campaign.filters.importId && <label>Incluir<select value={campaign.filters.importScope} onChange={(event) => setCampaign({ ...campaign, filters: { ...campaign.filters, importScope: event.target.value as "new" | "all" } })}><option value="new">Solo nuevos de esta lista</option><option value="all">Todos los presentes en esta lista</option></select></label>}</div>
            <div className="form-row"><label>Nombre de la campaña<input required maxLength={160} value={campaign.name} onChange={(event) => setCampaign({ ...campaign, name: event.target.value })} placeholder="Ej. Agencias de Panamá" autoFocus/></label><label>Plantilla<select required value={campaign.templateId} onChange={(event) => setCampaign({ ...campaign, templateId: event.target.value })}><option value="">Seleccionar…</option>{data.templates.filter((template) => template.active).map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label></div>
            <div className="filter-grid">
              <FilterPicker label="Tipo" options={data.filterOptions?.types || []} selected={campaign.filters.types} onChange={(types) => setCampaign({ ...campaign, filters: { ...campaign.filters, types } })}/>
              <FilterPicker label="Hub" options={data.filterOptions?.hubs || []} selected={campaign.filters.hubs} onChange={(hubs) => setCampaign({ ...campaign, filters: { ...campaign.filters, hubs } })}/>
              <FilterPicker label="Empresa" options={data.filterOptions?.companies || []} selected={campaign.filters.companies} onChange={(companies) => setCampaign({ ...campaign, filters: { ...campaign.filters, companies } })}/>
              <FilterPicker label="Red" options={data.filterOptions?.networks || []} selected={campaign.filters.networks} onChange={(networks) => setCampaign({ ...campaign, filters: { ...campaign.filters, networks } })}/>
              <FilterPicker label="Calidad del email" options={data.filterOptions?.emailQualities || []} selected={campaign.filters.emailQualities} onChange={(emailQualities) => setCampaign({ ...campaign, filters: { ...campaign.filters, emailQualities } })}/>
            </div>
            <label className="check-row"><input type="checkbox" checked={campaign.filters.excludeExistingClients} onChange={(event) => setCampaign({ ...campaign, filters: { ...campaign.filters, excludeExistingClients: event.target.checked } })}/><span><strong>Excluir clientes actuales</strong><small>No incluye filas marcadas como “Ya es cliente”.</small></span></label>
            <div className="form-row"><label>Inicio (opcional)<input type="datetime-local" value={campaign.startAt} onChange={(event) => setCampaign({ ...campaign, startAt: event.target.value })}/></label><label>Intervalo en minutos<input required type="number" min={1} max={1440} value={campaign.intervalMinutes} onChange={(event) => setCampaign({ ...campaign, intervalMinutes: Number(event.target.value) })}/></label></div>
            <div className="campaign-preview"><div><span>Destinatarios elegibles</span><strong>{campaignCount}</strong></div><p>Se enviará un mensaje cada {campaign.intervalMinutes} minutos. Los contactos ya enviados, pausados o que respondieron quedan fuera.</p></div>
            <div className="modal-actions"><button type="button" className="secondary" onClick={() => setCampaignModal(false)} disabled={busy}>Cancelar</button><button type="submit" className="primary" disabled={busy || !campaign.templateId || !campaignCount}>{busy ? "Creando…" : `Crear campaña (${campaignCount})`}</button></div>
          </form>
        </div>
      </div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
