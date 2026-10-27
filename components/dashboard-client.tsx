"use client";

import { useEffect, useMemo, useState } from "react";

type Contact = { id: string; name: string; company: string; email: string; companyType: string; status: string; updatedAt: string; lastError?: string };
type Template = { id: string; code: string; name: string; subject: string; body: string; active: boolean; version: number };
type Campaign = { id: string; name: string; status: string; total: number; sent: number; errors: number; startAt: string | null };
type Activity = { id: string; action: string; detail: string; createdAt: string };
type Dashboard = {
  viewer: { name: string; email: string };
  connected: boolean;
  sendingEnabled: boolean;
  contacts: Contact[];
  templates: Template[];
  campaigns: Campaign[];
  activity: Activity[];
};

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [editor, setEditor] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [authRequired, setAuthRequired] = useState(false);

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
          <div className="page-title"><div><p className="eyebrow">BASE COMERCIAL</p><h1>Contactos</h1><p>Organizá prospectos y controlá cada comunicación desde un solo lugar.</p></div><div className="title-actions"><button className="secondary">Importar CSV</button><button className="primary">+ Nuevo contacto</button></div></div>
          <div className="stats">
            <article><span>Total de contactos</span><strong>{counts.total}</strong><small>en la base actual</small></article>
            <article><span>En cola</span><strong>{counts.queued}</strong><small>programados o procesando</small></article>
            <article><span>Enviados</span><strong>{counts.sent}</strong><small>confirmados por Gmail</small></article>
            <article><span>Requieren atención</span><strong>{counts.errors}</strong><small>errores para revisar</small></article>
          </div>
          <div className="card table-card">
            <div className="toolbar"><div className="search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, empresa o email"/></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="selection">{selected.size} seleccionados</span><button className="secondary" disabled={!selected.size}>Agregar a campaña</button></div>
            <div className="table-scroll"><table><thead><tr><th><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())}/></th><th>Contacto</th><th>Empresa</th><th>Tipo</th><th>Estado</th><th>Actualización</th><th/></tr></thead><tbody>{filtered.map((contact) => <tr key={contact.id}><td><input type="checkbox" checked={selected.has(contact.id)} onChange={(e) => setSelected((current) => { const next = new Set(current); e.target.checked ? next.add(contact.id) : next.delete(contact.id); return next; })}/></td><td><div className="person"><span>{contact.name.split(" ").map((word) => word[0]).join("").slice(0,2)}</span><div><strong>{contact.name}</strong><small>{contact.email}</small></div></div></td><td>{contact.company}</td><td><code>{contact.companyType}</code></td><td><span className={`status ${contact.status.toLowerCase()}`}>{statusLabels[contact.status] || contact.status}</span>{contact.lastError && <small className="row-error">{contact.lastError}</small>}</td><td>{new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(contact.updatedAt))}</td><td><button className="dots">•••</button></td></tr>)}</tbody></table></div>
          </div>
        </section>}

        {tab === "templates" && <section>
          <div className="page-title"><div><p className="eyebrow">CONTENIDO</p><h1>Plantillas</h1><p>Personalizá el mensaje para cada tipo de empresa y conservá su historial.</p></div><button className="primary">+ Nueva plantilla</button></div>
          <div className="template-layout"><div className="card template-list"><div className="section-head"><strong>Tipos de mensaje</strong><span>{data.templates.length}</span></div>{data.templates.map((template) => <button key={template.id} className={activeTemplate === template.id ? "active" : ""} onClick={() => setActiveTemplate(template.id)}><span>{template.code.replace("TIPO_", "0")}</span><div><strong>{template.name}</strong><small>{template.code} · versión {template.version}</small></div><em className={template.active ? "enabled" : ""}/></button>)}</div>
            {editor && <div className="card editor"><div className="editor-head"><div><p className="eyebrow">{editor.code}</p><h2>{editor.name}</h2></div><label className="toggle"><input type="checkbox" checked={editor.active} onChange={(e) => setEditor({ ...editor, active: e.target.checked })}/><span/></label></div><div className="form-row"><label>Nombre interno<input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })}/></label><label>Código<input value={editor.code} disabled/></label></div><label>Asunto<input value={editor.subject} onChange={(e) => setEditor({ ...editor, subject: e.target.value })}/></label><label>Mensaje<textarea value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })}/></label><div className="variables"><span>Variables</span>{["{{nombre}}", "{{empresa}}", "{{email}}"].map((variable) => <code key={variable}>{variable}</code>)}</div><div className="editor-actions"><span>Los cambios crean una nueva versión.</span><button className="primary" disabled={busy} onClick={saveTemplate}>Guardar cambios</button></div></div>}
          </div>
        </section>}

        {tab === "campaigns" && <section>
          <div className="page-title"><div><p className="eyebrow">AUTOMATIZACIÓN</p><h1>Campañas</h1><p>Programá envíos graduales y seguí su avance sin perder control.</p></div><button className="primary">+ Crear campaña</button></div>
          <div className="campaign-grid">{data.campaigns.map((campaign) => <article className="card campaign" key={campaign.id}><div className="campaign-head"><span className={`status ${campaign.status.toLowerCase()}`}>{campaign.status === "DRAFT" ? "Borrador" : campaign.status}</span><button className="dots">•••</button></div><h2>{campaign.name}</h2><p>{campaign.total} destinatarios · intervalo de 5 minutos</p><div className="progress"><span style={{ width: `${campaign.total ? (campaign.sent / campaign.total) * 100 : 0}%` }}/></div><div className="campaign-metrics"><div><strong>{campaign.sent}</strong><small>Enviados</small></div><div><strong>{campaign.total - campaign.sent - campaign.errors}</strong><small>Pendientes</small></div><div><strong>{campaign.errors}</strong><small>Errores</small></div></div><button className="wide-button">Configurar campaña</button></article>)}</div>
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
