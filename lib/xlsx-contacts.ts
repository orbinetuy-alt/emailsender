import ExcelJS from "exceljs-hardened";

const COLUMN_ALIASES = {
  companyType: ["tipo", "categoria", "vertical"],
  hub: ["hub"],
  company: ["agencia_o_empresa", "empresa", "agencia", "company"],
  network: ["red", "network"],
  name: ["nombre", "name", "contacto"],
  jobTitle: ["cargo", "puesto", "job_title", "position"],
  city: ["ciudad", "city"],
  email: ["email", "correo", "mail"],
  emailQuality: ["estado_del_email", "calidad_del_email", "email_status"],
  linkedin: ["linkedin", "perfil_de_linkedin"],
  existingClientOffice: ["ya_es_cliente_oficina", "ya_es_cliente", "cliente_actual"],
  sourceDate: ["fecha_de_alta", "fecha_alta", "created_at"],
} as const;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "text" in value) return String(value.text).trim();
  return cell.text.trim();
}

function linkedinValue(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "hyperlink" in value) return String(value.hyperlink).trim();
  return cellText(cell);
}

function isoDate(value: ExcelJS.CellValue) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = typeof value === "object" && value && "text" in value ? String(value.text) : String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match?.[0] ?? null;
}

export type XlsxContact = {
  row: number;
  companyType: string;
  hub: string;
  company: string;
  network: string;
  name: string;
  jobTitle: string;
  city: string;
  email: string;
  emailQuality: string;
  linkedin: string;
  existingClientOffice: string;
  sourceDate: string | null;
};

export async function parseContactsXlsx(buffer: Buffer): Promise<XlsxContact[]> {
  if (buffer.byteLength > 8_000_000) throw new Error("El archivo supera el máximo de 8 MB.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.getWorksheet("Contactos") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("El Excel no contiene hojas.");

  let headerRow = 0;
  let headers: string[] = [];
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const rowHeaders = sheet.getRow(rowNumber).values as ExcelJS.CellValue[];
    const normalized = rowHeaders.slice(1).map((value) => normalize(String(value ?? "")));
    if (normalized.includes("email") && normalized.includes("nombre")) {
      headerRow = rowNumber;
      headers = normalized;
      break;
    }
  }
  if (!headerRow) throw new Error("No encontré una fila de encabezados con Nombre y Email.");

  const indexOf = (key: keyof typeof COLUMN_ALIASES) => headers.findIndex((header) => COLUMN_ALIASES[key].includes(header as never)) + 1;
  const columns = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((key) => [key, indexOf(key as keyof typeof COLUMN_ALIASES)])) as Record<keyof typeof COLUMN_ALIASES, number>;
  if (!columns.name || !columns.email || !columns.companyType) throw new Error("El Excel debe incluir Tipo, Nombre y Email.");
  if (sheet.rowCount - headerRow > 5000) throw new Error("Podés importar hasta 5000 contactos por archivo.");

  const contacts: XlsxContact[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const text = (key: keyof typeof columns) => columns[key] ? cellText(row.getCell(columns[key])) : "";
    const email = text("email").toLowerCase();
    if (!email && !text("name")) continue;
    contacts.push({
      row: rowNumber,
      companyType: text("companyType"), hub: text("hub"), company: text("company"), network: text("network"),
      name: text("name"), jobTitle: text("jobTitle"), city: text("city"), email,
      emailQuality: text("emailQuality"), linkedin: columns.linkedin ? linkedinValue(row.getCell(columns.linkedin)) : "",
      existingClientOffice: text("existingClientOffice"), sourceDate: columns.sourceDate ? isoDate(row.getCell(columns.sourceDate).value) : null,
    });
  }
  return contacts;
}
