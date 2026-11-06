import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { parseContactsCsv } from "@/lib/csv";
import { isDemoMode, transaction } from "@/lib/db";

const contactSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(160),
  email: z.string().trim().toLowerCase().email("El email no es válido.").max(320),
  company: z.string().trim().max(200).default(""),
  companyType: z.string().trim().min(1, "Elegí un tipo de empresa.").max(80),
});

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("manual"), contact: contactSchema }),
  z.object({ mode: z.literal("csv"), csv: z.string().min(1) }),
]);

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "La carga real está deshabilitada en modo demo." }, { status: 409 });
    const input = requestSchema.parse(await request.json());

    if (input.mode === "manual") {
      const contact = contactSchema.parse(input.contact);
      const created = await transaction(async (client) => {
        const existing = await client.query("SELECT 1 FROM contacts WHERE workspace_id=$1 AND lower(email)=lower($2)", [viewer.workspaceId, contact.email]);
        if (existing.rows[0]) throw new Error("Ya existe un contacto con ese email.");
        const result = await client.query(
          `INSERT INTO contacts(workspace_id,name,company,email,company_type,status)
           VALUES($1,$2,$3,$4,$5,'READY')
           RETURNING id,name,company,email,company_type AS "companyType",status,updated_at AS "updatedAt"`,
          [viewer.workspaceId, contact.name, contact.company, contact.email, contact.companyType],
        );
        await client.query(
          "INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CONTACT_CREATED','CONTACT',$3,$4)",
          [viewer.workspaceId, viewer.userId, result.rows[0].id, JSON.stringify({ detail: `Se agregó ${contact.email}` })],
        );
        return result.rows[0];
      });
      return NextResponse.json(created, { status: 201 });
    }

    const parsed = parseContactsCsv(input.csv);
    const result = await transaction(async (client) => {
      const valid: z.infer<typeof contactSchema>[] = [];
      const errors: string[] = [];
      const seen = new Set<string>();

      for (const row of parsed) {
        const checked = contactSchema.safeParse(row);
        if (!checked.success) {
          errors.push(`Fila ${row.row}: ${checked.error.issues[0]?.message ?? "datos inválidos"}`);
        } else if (seen.has(checked.data.email)) {
          errors.push(`Fila ${row.row}: email repetido dentro del archivo.`);
        } else {
          seen.add(checked.data.email);
          valid.push(checked.data);
        }
      }
      if (!valid.length) throw new Error(errors[0] ?? "No se encontraron contactos válidos.");

      const existing = await client.query<{ email: string }>(
        "SELECT lower(email) AS email FROM contacts WHERE workspace_id=$1 AND lower(email)=ANY($2::text[])",
        [viewer.workspaceId, valid.map((contact) => contact.email)],
      );
      const existingEmails = new Set(existing.rows.map((item) => item.email));

      for (const contact of valid) {
        await client.query(
          `INSERT INTO contacts(workspace_id,name,company,email,company_type,status)
           VALUES($1,$2,$3,$4,$5,'READY')
           ON CONFLICT(workspace_id,email) DO UPDATE SET
             name=EXCLUDED.name, company=EXCLUDED.company, company_type=EXCLUDED.company_type, updated_at=now()`,
          [viewer.workspaceId, contact.name, contact.company, contact.email, contact.companyType],
        );
      }
      const created = valid.filter((contact) => !existingEmails.has(contact.email)).length;
      const updated = valid.length - created;
      await client.query(
        "INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,metadata) VALUES($1,$2,'CONTACTS_IMPORTED','CONTACT',$3)",
        [viewer.workspaceId, viewer.userId, JSON.stringify({ detail: `CSV importado: ${created} nuevos, ${updated} actualizados`, created, updated, rejected: errors.length })],
      );
      return { created, updated, rejected: errors.length, errors: errors.slice(0, 8) };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Error";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
