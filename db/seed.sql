WITH new_workspace AS (
  INSERT INTO workspaces(name) VALUES ('Empresa Demo') RETURNING id
), new_user AS (
  INSERT INTO users(workspace_id,email,name,role)
  SELECT id,'admin@empresa.com','Administradora','OWNER' FROM new_workspace RETURNING workspace_id
)
INSERT INTO message_templates(workspace_id,code,name,subject,body_text)
SELECT workspace_id,'TIPO_1','Servicios profesionales','Una propuesta para {{empresa}}','Hola {{nombre}},\n\nQuería contarte cómo podemos ayudar a {{empresa}}.\n\nSaludos,' FROM new_user
UNION ALL SELECT workspace_id,'TIPO_2','Comercio y servicios','Una idea para {{empresa}}','Hola {{nombre}},\n\nTenemos una propuesta para {{empresa}}. ¿Conversamos?\n\nSaludos,' FROM new_user
UNION ALL SELECT workspace_id,'TIPO_3','Logística e industria','¿Conversamos, {{nombre}}?','Hola {{nombre}},\n\nCreemos que nuestro servicio puede ser relevante para {{empresa}}.\n\nQuedo atenta,' FROM new_user;
