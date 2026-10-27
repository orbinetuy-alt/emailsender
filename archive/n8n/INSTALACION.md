# Instalación del workflow de n8n

## Archivos

- `email-workspace-queue.json`: workflow para importar en n8n.
- `clientes.csv`: encabezados requeridos para la pestaña `Clientes`.
- `tipos-mensaje.csv`: tres plantillas iniciales para la pestaña `TiposMensaje`.

## Preparar Google Sheets

1. Crear una Google Sheet.
2. Importar `clientes.csv` en una pestaña llamada exactamente `Clientes`.
3. Importar `tipos-mensaje.csv` en otra pestaña llamada exactamente `TiposMensaje`.
4. Reemplazar el email de prueba por una dirección propia.
5. Mantener el estado en `BORRADOR` hasta terminar la configuración.

## Importar y conectar n8n

1. En n8n, crear un workflow y elegir **Import from file**.
2. Seleccionar `email-workspace-queue.json`.
3. Abrir `Configuracion` y reemplazar `PEGAR_ID_DE_GOOGLE_SHEET` por el identificador que aparece entre `/d/` y `/edit` en la URL de Google Sheets.
4. Seleccionar la misma credencial en:
   - `Buscar clientes EN_COLA`
   - `Buscar plantilla activa`
   - `Marcar ENVIANDO`
   - `Guardar resultado`
5. Seleccionar la credencial Gmail de la clienta en `Enviar con Gmail`.
6. Abrir cada nodo de Google Sheets y confirmar que n8n reconoce las columnas. Si muestra campos en rojo, volver a seleccionar la pestaña o refrescar su esquema.

## Primera prueba

1. Usar exclusivamente una dirección controlada por ustedes.
2. Cambiar ese contacto de `BORRADOR` a `EN_COLA`.
3. Ejecutar desde `Probar manualmente`.
4. Confirmar que llega el mensaje y que la fila termina como `ENVIADO`.
5. Probar también un email deliberadamente inválido y revisar que la ejecución no envíe nada.
6. Solo después de estas pruebas publicar el workflow.

El disparador procesa como máximo un contacto cada cinco minutos. Ochenta contactos requieren aproximadamente 6 horas y 40 minutos si la instancia permanece disponible.

## Comportamiento ante interrupciones

La fila cambia a `ENVIANDO` antes de llamar a Gmail. Si n8n se interrumpe después de enviar pero antes de guardar el resultado, la fila permanece en `ENVIANDO` y no se reenvía automáticamente. Ese caso debe revisarse en Gmail y corregirse manualmente para evitar duplicados.
