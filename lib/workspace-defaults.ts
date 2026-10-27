import type { PoolClient } from "pg";

export const DEFAULT_MESSAGE_TEMPLATES = [
  {
    code: "TIPO_1",
    name: "Tipo de empresa 1",
    subject: "Una propuesta para {{empresa}}",
    body: "Hola {{nombre}},\n\nTe escribo porque creo que nuestros servicios pueden ser de interés para {{empresa}}.\n\nQuedo a disposición para contarte más.\n\nSaludos,",
  },
  {
    code: "TIPO_2",
    name: "Tipo de empresa 2",
    subject: "Servicios para {{empresa}}",
    body: "Hola {{nombre}},\n\nQuería presentarte una propuesta pensada para empresas como {{empresa}}.\n\nSi te interesa, podemos coordinar una breve conversación.\n\nSaludos,",
  },
  {
    code: "TIPO_3",
    name: "Tipo de empresa 3",
    subject: "¿Conversamos sobre {{empresa}}?",
    body: "Hola {{nombre}},\n\nMe gustaría contarte cómo podemos ayudar a {{empresa}} con nuestros servicios.\n\n¿Te parece si coordinamos una breve llamada?\n\nSaludos,",
  },
] as const;

export async function ensureWorkspaceDefaults(client: PoolClient, workspaceId: string) {
  for (const template of DEFAULT_MESSAGE_TEMPLATES) {
    await client.query(
      `INSERT INTO message_templates(workspace_id, code, name, subject, body_text)
       VALUES($1, $2, $3, $4, $5)
       ON CONFLICT(workspace_id, code) DO NOTHING`,
      [workspaceId, template.code, template.name, template.subject, template.body],
    );
  }
}
