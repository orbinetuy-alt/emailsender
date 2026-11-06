const HEADER_ALIASES = {
  name: ["nombre", "name", "contacto", "contact"],
  email: ["email", "correo", "mail", "correo_electronico"],
  company: ["empresa", "company", "organizacion", "organization"],
  companyType: ["tipo", "tipo_empresa", "company_type", "companytype", "categoria"],
} as const;

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function delimiterFor(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"') quoted = !quoted;
    if (!quoted && character === ",") commas += 1;
    if (!quoted && character === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

function parseRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("El CSV contiene una celda entre comillas sin cerrar.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export type ImportedContact = { name: string; email: string; company: string; companyType: string; row: number };

export function parseContactsCsv(text: string): ImportedContact[] {
  if (!text.trim()) throw new Error("El archivo CSV está vacío.");
  if (text.length > 2_000_000) throw new Error("El CSV supera el máximo de 2 MB.");
  const rows = parseRows(text, delimiterFor(text));
  if (rows.length < 2) throw new Error("El CSV debe incluir encabezados y al menos un contacto.");
  if (rows.length > 1001) throw new Error("Podés importar hasta 1000 contactos por archivo.");

  const headers = rows[0].map(normalizeHeader);
  const column = (key: keyof typeof HEADER_ALIASES) => headers.findIndex((header) => HEADER_ALIASES[key].includes(header as never));
  const indexes = { name: column("name"), email: column("email"), company: column("company"), companyType: column("companyType") };
  if (indexes.name < 0 || indexes.email < 0 || indexes.companyType < 0) {
    throw new Error("Faltan columnas obligatorias. Usá: nombre, email, empresa y tipo.");
  }

  return rows.slice(1).map((values, index) => ({
    name: values[indexes.name]?.trim() ?? "",
    email: values[indexes.email]?.trim().toLowerCase() ?? "",
    company: indexes.company >= 0 ? values[indexes.company]?.trim() ?? "" : "",
    companyType: values[indexes.companyType]?.trim().toUpperCase().replace(/^TIPO[ _-]?/, "TIPO_") ?? "",
    row: index + 2,
  }));
}
