export type ContactStatus = "DRAFT" | "READY" | "QUEUED" | "PROCESSING" | "SENT" | "ERROR" | "PAUSED" | "DO_NOT_CONTACT" | "REPLIED";

const now = new Date();
const isoDaysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const store = {
  connected: false,
  sendingEnabled: false,
  contacts: [
    { id: "c1", name: "Sofía Álvarez", company: "Estudio Norte", email: "sofia@estudionorte.com", companyType: "TIPO_1", status: "READY" as ContactStatus, updatedAt: isoDaysAgo(0) },
    { id: "c2", name: "Martín Silva", company: "Vértice SAS", email: "martin@vertice.com", companyType: "TIPO_2", status: "QUEUED" as ContactStatus, updatedAt: isoDaysAgo(0) },
    { id: "c3", name: "Lucía Pereira", company: "Pereira & Asociados", email: "lucia@pereira.com", companyType: "TIPO_1", status: "SENT" as ContactStatus, updatedAt: isoDaysAgo(1) },
    { id: "c4", name: "Diego Gómez", company: "Mercado Sur", email: "diego@mercadosur.com", companyType: "TIPO_3", status: "SENT" as ContactStatus, updatedAt: isoDaysAgo(2) },
    { id: "c5", name: "Carolina Méndez", company: "Arquitectura M", email: "carolina@arquitecturam.com", companyType: "TIPO_2", status: "ERROR" as ContactStatus, updatedAt: isoDaysAgo(0), lastError: "La dirección fue rechazada por el servidor de destino." },
    { id: "c6", name: "Nicolás Torres", company: "Torres Logística", email: "nicolas@torreslogistica.com", companyType: "TIPO_3", status: "DRAFT" as ContactStatus, updatedAt: isoDaysAgo(4) },
  ],
  templates: [
    { id: "t1", code: "TIPO_1", name: "Servicios profesionales", subject: "Una propuesta para {{empresa}}", body: "Hola {{nombre}},\n\nQuería contarte cómo podemos ayudar a {{empresa}} a optimizar su comunicación comercial.\n\n¿Te parece si coordinamos una breve llamada?\n\nSaludos,", active: true, version: 1 },
    { id: "t2", code: "TIPO_2", name: "Comercio y servicios", subject: "Una idea para {{empresa}}", body: "Hola {{nombre}},\n\nEstuvimos analizando empresas como {{empresa}} y creemos que podemos aportarles una solución concreta.\n\n¿Conversamos?\n\nSaludos,", active: true, version: 2 },
    { id: "t3", code: "TIPO_3", name: "Logística e industria", subject: "¿Conversamos, {{nombre}}?", body: "Hola {{nombre}},\n\nTenemos una propuesta especialmente pensada para {{empresa}}. Me gustaría contarte brevemente de qué se trata.\n\nQuedo atenta,", active: true, version: 1 },
  ],
  campaigns: [
    { id: "p1", name: "Prospección octubre", status: "DRAFT", total: 6, sent: 2, errors: 1, startAt: null },
  ],
  activity: [
    { id: "a1", action: "EMAIL_SENT", detail: "Correo enviado a lucia@pereira.com", createdAt: isoDaysAgo(1) },
    { id: "a2", action: "EMAIL_SENT", detail: "Correo enviado a diego@mercadosur.com", createdAt: isoDaysAgo(2) },
    { id: "a3", action: "CONTACT_ERROR", detail: "Falló el envío a carolina@arquitecturam.com", createdAt: isoDaysAgo(0) },
  ],
};

export function demoDashboard() {
  return structuredClone(store);
}

export function updateDemoTemplate(id: string, patch: Partial<(typeof store.templates)[number]>) {
  const template = store.templates.find((item) => item.id === id);
  if (!template) throw new Error("Plantilla no encontrada.");
  Object.assign(template, patch, { version: template.version + 1 });
  store.activity.unshift({ id: crypto.randomUUID(), action: "TEMPLATE_UPDATED", detail: `Se actualizó ${template.name}`, createdAt: new Date().toISOString() });
  return structuredClone(template);
}

export function setDemoSending(enabled: boolean) {
  store.sendingEnabled = enabled;
  store.activity.unshift({ id: crypto.randomUUID(), action: enabled ? "SENDING_ENABLED" : "SENDING_DISABLED", detail: enabled ? "Se habilitaron los envíos" : "Se pausaron todos los envíos", createdAt: new Date().toISOString() });
  return enabled;
}
