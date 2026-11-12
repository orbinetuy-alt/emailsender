import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { isDemoMode, transaction } from "@/lib/db";
import { parseContactsXlsx } from "@/lib/xlsx-contacts";

const emailSchema = z.string().trim().toLowerCase().email();

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (isDemoMode()) return NextResponse.json({ error: "La importación real está deshabilitada en modo demo." }, { status: 409 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Seleccioná un archivo Excel.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("El archivo debe tener formato .xlsx.");
    if (file.size > 8_000_000) throw new Error("El archivo supera el máximo de 8 MB.");

    const parsed = await parseContactsXlsx(Buffer.from(await file.arrayBuffer()));
    const result = await transaction(async (client) => {
      const valid = [];
      const errors: string[] = [];
      const seen = new Set<string>();
      for (const contact of parsed) {
        const email = emailSchema.safeParse(contact.email);
        if (!contact.name.trim()) errors.push(`Fila ${contact.row}: falta el nombre.`);
        else if (!contact.companyType.trim()) errors.push(`Fila ${contact.row}: falta el tipo.`);
        else if (!email.success) errors.push(`Fila ${contact.row}: email inválido.`);
        else if (seen.has(email.data)) errors.push(`Fila ${contact.row}: email repetido dentro del archivo.`);
        else {
          seen.add(email.data);
          valid.push({ ...contact, email: email.data });
        }
      }
      if (!valid.length) throw new Error(errors[0] ?? "No se encontraron contactos válidos.");

      const existing = await client.query<{ email: string }>(
        "SELECT lower(email) AS email FROM contacts WHERE workspace_id=$1 AND lower(email)=ANY($2::text[])",
        [viewer.workspaceId, valid.map((contact) => contact.email)],
      );
      const existingEmails = new Set(existing.rows.map((item) => item.email));
      const created = valid.filter((contact) => !existingEmails.has(contact.email)).length;
      const updated = valid.length - created;
      const imported = await client.query<{ id: string }>(
        `INSERT INTO contact_imports(workspace_id,file_name,total_rows,created_count,updated_count,rejected_count,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [viewer.workspaceId, file.name, parsed.length, created, updated, errors.length, viewer.userId],
      );
      for (const contact of valid) {
        const saved = await client.query<{ id: string }>(
          `INSERT INTO contacts(
             workspace_id,name,company,email,company_type,status,hub,network,job_title,city,email_quality,
             linkedin_url,existing_client_office,source_date,last_imported_at,custom_fields
           ) VALUES($1,$2,$3,$4,$5,'READY',$6,$7,$8,$9,$10,$11,$12,$13,now(),$14)
           ON CONFLICT(workspace_id,email) DO UPDATE SET
             name=EXCLUDED.name,company=EXCLUDED.company,company_type=EXCLUDED.company_type,hub=EXCLUDED.hub,
             network=EXCLUDED.network,job_title=EXCLUDED.job_title,city=EXCLUDED.city,email_quality=EXCLUDED.email_quality,
             linkedin_url=EXCLUDED.linkedin_url,existing_client_office=EXCLUDED.existing_client_office,
             source_date=EXCLUDED.source_date,last_imported_at=now(),custom_fields=EXCLUDED.custom_fields,updated_at=now()
           RETURNING id`,
          [viewer.workspaceId, contact.name, contact.company, contact.email, contact.companyType, contact.hub, contact.network,
            contact.jobTitle, contact.city, contact.emailQuality, contact.linkedin, contact.existingClientOffice,
            contact.sourceDate, JSON.stringify({ sourceRow: contact.row })],
        );
        await client.query(
          "INSERT INTO contact_import_items(import_id,contact_id,source_row,was_new) VALUES($1,$2,$3,$4)",
          [imported.rows[0].id, saved.rows[0].id, contact.row, !existingEmails.has(contact.email)],
        );
      }
      await client.query(
        "INSERT INTO audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CONTACTS_IMPORTED','CONTACT_IMPORT',$3,$4)",
        [viewer.workspaceId, viewer.userId, imported.rows[0].id, JSON.stringify({ detail: `${file.name}: ${created} nuevos, ${updated} actualizados`, created, updated, rejected: errors.length })],
      );
      return { created, updated, rejected: errors.length, total: parsed.length, errors: errors.slice(0, 10) };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo importar el Excel.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
