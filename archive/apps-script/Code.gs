const APP = Object.freeze({
  sheets: {
    clients: 'Clientes',
    templates: 'TiposMensaje',
    config: 'Configuracion',
    activity: 'Actividad',
  },
  clientHeaders: [
    'id', 'nombre', 'empresa', 'email', 'tipo_mensaje', 'estado',
    'fecha_envio', 'ultimo_error', 'intentos', 'actualizado',
  ],
  templateHeaders: ['codigo', 'nombre', 'asunto', 'mensaje', 'activo', 'actualizado'],
  activityHeaders: ['fecha', 'nivel', 'accion', 'cliente_id', 'email', 'detalle'],
  states: {
    draft: 'BORRADOR',
    queued: 'EN_COLA',
    sending: 'ENVIANDO',
    sent: 'ENVIADO',
    error: 'ERROR',
    paused: 'PAUSADO',
    blocked: 'NO_CONTACTAR',
  },
  config: {
    enabled: 'ENVIOS_HABILITADOS',
    senderName: 'NOMBRE_REMITENTE',
    replyTo: 'RESPONDER_A',
    lastRun: 'ULTIMA_EJECUCION',
    spreadsheetId: 'SPREADSHEET_ID',
  },
  maxActivityRows: 500,
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Envíos Workspace')
    .addItem('Abrir panel', 'mostrarPanel')
    .addSeparator()
    .addItem('Configurar sistema', 'configurarSistema')
    .addItem('Deshabilitar envíos', 'deshabilitarEnviosDesdeMenu')
    .addToUi();
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Envíos Workspace')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function mostrarPanel() {
  const html = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setWidth(1200)
    .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Envíos Workspace');
}

function configurarSistema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este script debe estar vinculado a una Google Sheet.');

  ensureSheet_(ss, APP.sheets.clients, APP.clientHeaders);
  ensureSheet_(ss, APP.sheets.templates, APP.templateHeaders);
  ensureSheet_(ss, APP.sheets.config, ['clave', 'valor', 'descripcion']);
  ensureSheet_(ss, APP.sheets.activity, APP.activityHeaders);

  seedTemplates_(ss);
  seedConfig_(ss);
  formatSheets_(ss);
  createFiveMinuteTrigger_();
  logActivity_('INFO', 'CONFIGURACION', '', '', 'Sistema configurado; envíos deshabilitados por seguridad.');
  return getDashboardData();
}

function getDashboardData() {
  const ss = getSpreadsheet_();
  ensureConfigured_(ss);
  const clients = readObjects_(ss.getSheetByName(APP.sheets.clients));
  const templates = readObjects_(ss.getSheetByName(APP.sheets.templates));
  const activity = readObjects_(ss.getSheetByName(APP.sheets.activity)).slice(-30).reverse();
  const config = readConfig_(ss);
  const counts = Object.values(APP.states).reduce((acc, state) => {
    acc[state] = 0;
    return acc;
  }, {});

  clients.forEach((client) => {
    const state = normalizeState_(client.estado);
    counts[state] = (counts[state] || 0) + 1;
  });

  return {
    clients: clients.slice(0, 1000).map(sanitizeForClient_),
    templates: templates.map(sanitizeForClient_),
    activity: activity.map(sanitizeForClient_),
    counts,
    config: {
      enabled: String(config[APP.config.enabled]).toUpperCase() === 'SI',
      senderName: config[APP.config.senderName] || '',
      replyTo: config[APP.config.replyTo] || '',
      lastRun: config[APP.config.lastRun] || '',
      effectiveUser: Session.getEffectiveUser().getEmail() || '',
      remainingQuota: MailApp.getRemainingDailyQuota(),
    },
  };
}

function saveTemplate(payload) {
  validatePayloadObject_(payload);
  const code = cleanCode_(payload.codigo);
  const name = cleanText_(payload.nombre, 120);
  const subject = cleanText_(payload.asunto, 250);
  const body = cleanText_(payload.mensaje, 20000, true);
  if (!code || !name || !subject || !body) throw new Error('Código, nombre, asunto y mensaje son obligatorios.');

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP.sheets.templates);
  const rows = readObjectsWithRows_(sheet);
  const existing = rows.find((row) => cleanCode_(row.data.codigo) === code);
  const values = [code, name, subject, body, payload.activo === false ? 'NO' : 'SI', new Date()];
  if (existing) sheet.getRange(existing.row, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  logActivity_('INFO', 'PLANTILLA_GUARDADA', '', '', code);
  return getDashboardData();
}

function saveSettings(payload) {
  validatePayloadObject_(payload);
  const senderName = cleanText_(payload.senderName || '', 120);
  const replyTo = String(payload.replyTo || '').trim().toLowerCase();
  if (replyTo && !isValidEmail_(replyTo)) throw new Error('El email de respuesta no es válido.');
  setConfigValue_(APP.config.senderName, senderName);
  setConfigValue_(APP.config.replyTo, replyTo);
  logActivity_('INFO', 'CONFIGURACION_ACTUALIZADA', '', '', 'Datos del remitente actualizados.');
  return getDashboardData();
}

function setSendingEnabled(enabled, confirmation) {
  if (enabled === true && confirmation !== 'HABILITAR') {
    throw new Error('Para habilitar los envíos se requiere la confirmación exacta HABILITAR.');
  }
  setConfigValue_(APP.config.enabled, enabled === true ? 'SI' : 'NO');
  logActivity_('WARN', enabled === true ? 'ENVIOS_HABILITADOS' : 'ENVIOS_DESHABILITADOS', '', '', Session.getEffectiveUser().getEmail());
  return getDashboardData();
}

function deshabilitarEnviosDesdeMenu() {
  setSendingEnabled(false, '');
  SpreadsheetApp.getUi().alert('Los envíos quedaron deshabilitados.');
}

function queueClients(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Seleccioná al menos un cliente.');
  const selected = new Set(ids.map(String));
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP.sheets.clients);
  const rows = readObjectsWithRows_(sheet);
  const templates = templateMap_(ss);
  const protectedEmails = new Map();
  rows.forEach((item) => {
    const email = String(item.data.email || '').trim().toLowerCase();
    const state = normalizeState_(item.data.estado);
    if (email && [APP.states.queued, APP.states.sending, APP.states.sent].includes(state)) {
      protectedEmails.set(email, String(item.data.id || item.row));
    }
  });
  const seenInRequest = new Set();
  let queued = 0;
  const errors = [];

  rows.forEach((item) => {
    const client = item.data;
    if (!selected.has(String(client.id))) return;
    try {
      validateClientForQueue_(client, templates);
      const state = normalizeState_(client.estado);
      if ([APP.states.sent, APP.states.blocked, APP.states.sending].includes(state)) {
        throw new Error(`No se puede encolar desde el estado ${state}.`);
      }
      const emailKey = String(client.email).trim().toLowerCase();
      if (protectedEmails.has(emailKey)) throw new Error('Ese email ya está en cola o fue enviado.');
      if (seenInRequest.has(emailKey)) throw new Error('Email duplicado dentro de la selección.');
      setClientFields_(sheet, item.row, { estado: APP.states.queued, ultimo_error: '', actualizado: new Date() });
      seenInRequest.add(emailKey);
      protectedEmails.set(emailKey, String(client.id));
      queued += 1;
    } catch (error) {
      errors.push(`${client.email || client.id || `fila ${item.row}`}: ${error.message}`);
    }
  });

  logActivity_('INFO', 'CLIENTES_ENCOLADOS', '', '', `${queued} cliente(s). ${errors.length} error(es).`);
  return { dashboard: getDashboardData(), queued, errors };
}

function pauseClients(ids) {
  return updateClientStates_(ids, APP.states.paused, [APP.states.queued, APP.states.error]);
}

function markDoNotContact(ids) {
  return updateClientStates_(ids, APP.states.blocked, [
    APP.states.draft, APP.states.queued, APP.states.error, APP.states.paused,
  ]);
}

function previewClient(clientId) {
  const ss = getSpreadsheet_();
  const row = readObjects_(ss.getSheetByName(APP.sheets.clients)).find((client) => String(client.id) === String(clientId));
  if (!row) throw new Error('Cliente no encontrado.');
  const template = templateMap_(ss)[cleanCode_(row.tipo_mensaje)];
  if (!template) throw new Error('El cliente no tiene una plantilla válida.');
  return {
    to: row.email,
    subject: renderTemplate_(template.asunto, row),
    body: renderTemplate_(template.mensaje, row),
  };
}

function processEmailQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { status: 'locked' };

  try {
    const ss = getSpreadsheet_();
    ensureConfigured_(ss);
    const config = readConfig_(ss);
    setConfigValue_(APP.config.lastRun, new Date());
    if (String(config[APP.config.enabled]).toUpperCase() !== 'SI') return { status: 'disabled' };
    if (MailApp.getRemainingDailyQuota() < 1) {
      logActivity_('ERROR', 'SIN_CUOTA', '', '', 'Google informa que no queda cuota diaria de destinatarios.');
      return { status: 'quota_exhausted' };
    }

    const sheet = ss.getSheetByName(APP.sheets.clients);
    const item = readObjectsWithRows_(sheet).find((row) => normalizeState_(row.data.estado) === APP.states.queued);
    if (!item) return { status: 'empty' };

    const client = item.data;
    const templates = templateMap_(ss);
    try {
      validateClientForQueue_(client, templates);
      const emailKey = String(client.email).trim().toLowerCase();
      const duplicateAlreadySent = readObjectsWithRows_(sheet).some((row) =>
        row.row !== item.row &&
        String(row.data.email || '').trim().toLowerCase() === emailKey &&
        normalizeState_(row.data.estado) === APP.states.sent
      );
      if (duplicateAlreadySent) throw new Error('Envío cancelado: ya existe un registro ENVIADO para este email.');
      setClientFields_(sheet, item.row, {
        estado: APP.states.sending,
        intentos: Number(client.intentos || 0) + 1,
        actualizado: new Date(),
      });
      SpreadsheetApp.flush();

      const template = templates[cleanCode_(client.tipo_mensaje)];
      const subject = renderTemplate_(template.asunto, client);
      const plainBody = renderTemplate_(template.mensaje, client);
      const options = {
        name: config[APP.config.senderName] || undefined,
        replyTo: config[APP.config.replyTo] || undefined,
        htmlBody: textToSafeHtml_(plainBody),
      };
      Object.keys(options).forEach((key) => options[key] === undefined && delete options[key]);
      GmailApp.sendEmail(String(client.email).trim(), subject, plainBody, options);

      setClientFields_(sheet, item.row, {
        estado: APP.states.sent,
        fecha_envio: new Date(),
        ultimo_error: '',
        actualizado: new Date(),
      });
      logActivity_('INFO', 'EMAIL_ENVIADO', client.id, client.email, subject);
      return { status: 'sent', clientId: String(client.id), email: String(client.email) };
    } catch (error) {
      setClientFields_(sheet, item.row, {
        estado: APP.states.error,
        ultimo_error: cleanText_(error.message || String(error), 500),
        actualizado: new Date(),
      });
      logActivity_('ERROR', 'EMAIL_FALLIDO', client.id, client.email, error.message || String(error));
      return { status: 'error', clientId: String(client.id), error: error.message || String(error) };
    }
  } finally {
    lock.releaseLock();
  }
}

function runQueueOnceForTesting() {
  return processEmailQueue();
}

function ensureConfigured_(ss) {
  const missing = Object.values(APP.sheets).filter((name) => !ss.getSheetByName(name));
  if (missing.length) throw new Error('Primero ejecutá configurarSistema(). Faltan: ' + missing.join(', '));
}

function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(APP.config.spreadsheetId);
  if (!id) throw new Error('No se encontró la planilla configurada. Ejecutá configurarSistema().');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else {
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0].map(String);
    const missing = headers.filter((header) => !existing.includes(header));
    if (missing.length) sheet.getRange(1, existing.filter(Boolean).length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function seedTemplates_(ss) {
  const sheet = ss.getSheetByName(APP.sheets.templates);
  if (sheet.getLastRow() > 1) return;
  const now = new Date();
  sheet.getRange(2, 1, 3, APP.templateHeaders.length).setValues([
    ['TIPO_1', 'Tipo de empresa 1', 'Una propuesta para {{empresa}}', 'Hola {{nombre}},\n\nQuería contactarte para contarte cómo podemos ayudar a {{empresa}}.\n\nSaludos,', 'SI', now],
    ['TIPO_2', 'Tipo de empresa 2', 'Servicios para {{empresa}}', 'Hola {{nombre}},\n\nTenemos una propuesta pensada para empresas como {{empresa}}. ¿Te gustaría que coordinemos una breve conversación?\n\nSaludos,', 'SI', now],
    ['TIPO_3', 'Tipo de empresa 3', '¿Conversamos, {{nombre}}?', 'Hola {{nombre}},\n\nMe comunico porque creemos que nuestro servicio puede ser relevante para {{empresa}}.\n\nQuedo atenta,', 'SI', now],
  ]);
}

function seedConfig_(ss) {
  const sheet = ss.getSheetByName(APP.sheets.config);
  const existing = readObjects_(sheet).reduce((acc, row) => {
    acc[String(row.clave)] = true;
    return acc;
  }, {});
  const defaults = [
    [APP.config.enabled, 'NO', 'Interruptor maestro. Cambiar únicamente desde el panel.'],
    [APP.config.senderName, '', 'Nombre visible del remitente.'],
    [APP.config.replyTo, '', 'Dirección opcional para respuestas.'],
    [APP.config.lastRun, '', 'Última ejecución del procesador.'],
  ];
  defaults.filter((row) => !existing[row[0]]).forEach((row) => sheet.appendRow(row));
  PropertiesService.getScriptProperties().setProperty(APP.config.spreadsheetId, ss.getId());
}

function formatSheets_(ss) {
  Object.values(APP.sheets).forEach((name) => {
    const sheet = ss.getSheetByName(name);
    const lastColumn = Math.max(1, sheet.getLastColumn());
    sheet.getRange(1, 1, 1, lastColumn)
      .setBackground('#172033')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.autoResizeColumns(1, Math.min(lastColumn, 12));
  });
}

function createFiveMinuteTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === 'processEmailQueue');
  if (!exists) ScriptApp.newTrigger('processEmailQueue').timeBased().everyMinutes(5).create();
}

function readObjects_(sheet) {
  return readObjectsWithRows_(sheet).map((item) => item.data);
}

function readObjectsWithRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((header) => String(header).trim());
  return values.slice(1).map((row, index) => {
    const data = {};
    headers.forEach((header, column) => {
      if (header) data[header] = row[column];
    });
    return { row: index + 2, data };
  }).filter((item) => Object.values(item.data).some((value) => value !== '' && value !== null));
}

function readConfig_(ss) {
  return readObjects_(ss.getSheetByName(APP.sheets.config)).reduce((acc, row) => {
    acc[String(row.clave)] = row.valor;
    return acc;
  }, {});
}

function setConfigValue_(key, value) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP.sheets.config);
  const item = readObjectsWithRows_(sheet).find((row) => String(row.data.clave) === key);
  if (item) sheet.getRange(item.row, 2).setValue(value);
  else sheet.appendRow([key, value, '']);
}

function templateMap_(ss) {
  return readObjects_(ss.getSheetByName(APP.sheets.templates)).reduce((acc, template) => {
    if (String(template.activo).toUpperCase() !== 'NO') acc[cleanCode_(template.codigo)] = template;
    return acc;
  }, {});
}

function validateClientForQueue_(client, templates) {
  if (!client.id) throw new Error('Falta id. Puede asignarlo ejecutando normalizarClientes().');
  if (!isValidEmail_(String(client.email || '').trim())) throw new Error('Email inválido.');
  const code = cleanCode_(client.tipo_mensaje);
  if (!code || !templates[code]) throw new Error('Tipo de mensaje inexistente o inactivo.');
}

function normalizarClientes() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP.sheets.clients);
  const rows = readObjectsWithRows_(sheet);
  rows.forEach((item) => {
    const updates = {};
    if (!item.data.id) updates.id = Utilities.getUuid();
    if (!item.data.estado) updates.estado = APP.states.draft;
    if (item.data.intentos === '') updates.intentos = 0;
    updates.actualizado = new Date();
    setClientFields_(sheet, item.row, updates);
  });
  logActivity_('INFO', 'CLIENTES_NORMALIZADOS', '', '', `${rows.length} fila(s).`);
  return getDashboardData();
}

function setClientFields_(sheet, rowNumber, fields) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  Object.keys(fields).forEach((key) => {
    const column = headers.indexOf(key) + 1;
    if (column < 1) throw new Error(`Falta la columna ${key} en Clientes.`);
    sheet.getRange(rowNumber, column).setValue(fields[key]);
  });
}

function updateClientStates_(ids, targetState, allowedStates) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Seleccioná al menos un cliente.');
  const selected = new Set(ids.map(String));
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP.sheets.clients);
  let updated = 0;
  readObjectsWithRows_(sheet).forEach((item) => {
    if (!selected.has(String(item.data.id))) return;
    if (!allowedStates.includes(normalizeState_(item.data.estado))) return;
    setClientFields_(sheet, item.row, { estado: targetState, actualizado: new Date() });
    updated += 1;
  });
  logActivity_('INFO', 'ESTADOS_ACTUALIZADOS', '', '', `${updated} cliente(s) → ${targetState}.`);
  return getDashboardData();
}

function normalizeState_(value) {
  const state = String(value || APP.states.draft).trim().toUpperCase();
  return Object.values(APP.states).includes(state) ? state : APP.states.draft;
}

function renderTemplate_(text, client) {
  return String(text || '').replace(/{{\s*([a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ-]+)\s*}}/g, (match, key) => {
    const normalized = Object.keys(client).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return normalized ? String(client[normalized] == null ? '' : client[normalized]) : '';
  });
}

function textToSafeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

function logActivity_(level, action, clientId, email, detail) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP.sheets.activity);
  if (!sheet) return;
  sheet.appendRow([new Date(), level, action, clientId || '', email || '', cleanText_(detail || '', 1000, true)]);
  const excess = sheet.getLastRow() - 1 - APP.maxActivityRows;
  if (excess > 0) sheet.deleteRows(2, excess);
}

function sanitizeForClient_(object) {
  const safe = {};
  Object.keys(object).forEach((key) => {
    const value = object[key];
    safe[key] = value instanceof Date ? value.toISOString() : value;
  });
  return safe;
}

function cleanCode_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 60);
}

function cleanText_(value, maxLength, preserveWhitespace) {
  const text = String(value == null ? '' : value);
  const cleaned = preserveWhitespace ? text.trim() : text.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, maxLength);
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function validatePayloadObject_(payload) {
  if (!payload || Object.prototype.toString.call(payload) !== '[object Object]') {
    throw new Error('Solicitud inválida.');
  }
}
