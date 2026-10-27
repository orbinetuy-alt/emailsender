# Envíos Workspace

Mini plataforma de seguimiento y envío gradual de correos construida para Google Apps Script.

## Qué incluye

- Panel privado para ver clientes, estados y actividad reciente.
- Tres tipos de mensaje editables, ampliables sin cambiar código.
- Variables en asunto y cuerpo: `{{nombre}}`, `{{empresa}}`, `{{email}}`, `{{tipo}}` y cualquier columna adicional de la hoja Clientes.
- Cola de envíos con un único correo por ejecución del disparador (aproximadamente cada 5 minutos).
- Estados `BORRADOR`, `EN_COLA`, `ENVIANDO`, `ENVIADO`, `ERROR`, `PAUSADO` y `NO_CONTACTAR`.
- Bloqueo contra ejecuciones simultáneas y reintentos accidentales.
- Interruptor maestro: recién instalado, el sistema nunca envía hasta que se habilita explícitamente.
- Historial de acciones y errores.

## Instalación en Google Workspace

1. Crear una Google Sheet nueva dentro de la cuenta empresarial que enviará los correos.
2. Abrir **Extensiones → Apps Script**.
3. Copiar `Code.gs`, `Index.html` y `appsscript.json` en el proyecto de Apps Script.
4. Ejecutar manualmente `configurarSistema()` desde el editor y aceptar los permisos solicitados.
5. Volver a la planilla. Se crearán las hojas `Clientes`, `TiposMensaje`, `Configuracion` y `Actividad`.
6. Cargar o pegar la lista en `Clientes`. Como mínimo necesita `email` y `tipo_mensaje`. Se pueden conservar/agregar otras columnas para personalización.
7. Editar los textos en `TiposMensaje`. Los códigos iniciales son `TIPO_1`, `TIPO_2` y `TIPO_3`.
8. En Apps Script, elegir **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: la propietaria del script.
   - Quién tiene acceso: solo ella o usuarios autorizados del dominio.
9. Abrir la URL generada. Revisar vistas previas, encolar los contactos y, solamente al estar lista, habilitar los envíos.

## Columnas de Clientes

Las columnas base se crean automáticamente:

| Columna | Uso |
| --- | --- |
| `id` | Identificador estable generado por el sistema. |
| `nombre` | Nombre del contacto. |
| `empresa` | Empresa del contacto. |
| `email` | Dirección de destino. |
| `tipo_mensaje` | Código de plantilla, por ejemplo `TIPO_1`. |
| `estado` | Estado de comunicación. |
| `fecha_envio` | Fecha y hora del envío confirmado por Gmail. |
| `ultimo_error` | Último error registrado. |
| `intentos` | Cantidad de intentos. |
| `actualizado` | Última modificación automática. |

Puede agregar columnas como `rubro`, `ciudad` o `servicio`; después puede utilizar `{{rubro}}`, `{{ciudad}}` o `{{servicio}}` en las plantillas.

## Operación segura

- El disparador de Apps Script se ejecuta aproximadamente cada cinco minutos; Google no garantiza el segundo exacto.
- Cada ejecución intenta enviar como máximo un correo. Si un envío falla, queda en `ERROR` y no se reintenta automáticamente.
- `NO_CONTACTAR` nunca se encola ni envía.
- El sistema no usa píxeles de seguimiento ni oculta su actividad al administrador de Workspace.
- Para detener todo de inmediato, deshabilitar envíos desde el panel o eliminar el disparador en Apps Script.

## Desarrollo con clasp (opcional)

Si se instala la CLI de Google Apps Script:

```bash
clasp login
clasp create --type sheets --title "Envíos Workspace"
clasp push
```

No subir `.clasp.json` si contiene identificadores que no se quieran compartir.
