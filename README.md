# Relay — automatización de campañas de email

Aplicación para importar un Excel diario, seleccionar destinatarios, enviar correos desde Gmail y programar seguimientos opcionales. Cuando llega una respuesta, se marca como respondido y se cancelan los seguimientos pendientes. La aplicación no responde automáticamente.

## Arquitectura

- Next.js + TypeScript para interfaz y API.
- PostgreSQL para la cola de envíos, campañas, plantillas, sesiones OAuth y estado de respuestas. No se usa como CRM.
- OAuth 2.0 de Google para enviar y detectar respuestas mediante metadatos de Gmail.
- Worker Node separado con bloqueo `FOR UPDATE SKIP LOCKED`.
- Tokens de Google cifrados con AES-256-GCM.
- Claves de idempotencia y restricciones únicas para impedir duplicados dentro de una campaña.
- Auditoría de acciones relevantes.

La interfaz se inicia en `DEMO_MODE=true`: permite revisar y editar plantillas sin una base de datos ni credenciales reales. En producción debe configurarse PostgreSQL y cambiar `DEMO_MODE=false`.

## Flujo diario y conservación

1. Importar la planilla `.xlsx` del día. No se conserva el archivo original.
2. Filtrar y revisar los destinatarios y un ejemplo del mensaje.
3. Crear la campaña. Se guardan copias del contenido de las plantillas y los datos necesarios de los destinatarios seleccionados.
4. Habilitar los envíos y mantener el proceso web y el worker en ejecución. Los correos iniciales se espacian según el intervalo de la campaña; los seguimientos se programan desde el envío anterior y siguen el mismo hilo de Gmail.
5. Consultar resultados en la campaña. Una respuesta solo cambia su estado y cancela seguimientos pendientes.

El worker elimina cada hora las listas importadas con más de 24 horas y los contactos que no estén en ninguna campaña. Eliminar una campaña terminada o cancelada borra sus trabajos y los contactos que no pertenezcan a otra campaña. El historial de esa campaña deja de estar disponible tras eliminarla. Las listas antiguas que ya existan también se eliminarán cuando arranque el worker.

El diseño actual utiliza PostgreSQL porque el proceso web y el worker comparten una cola con bloqueos transaccionales. El volumen de contactos no exige PostgreSQL por capacidad; su función es conservar el estado operativo entre reinicios y coordinar ambos procesos.

## Desarrollo

```bash
cp .env.example .env.local
npm install
npm run dev
```

Abrir `http://localhost:3000`.

## PostgreSQL

Crear una base y aplicar:

```bash
npm run db:migrate
npm run db:check
```

En desarrollo local se utiliza `emailsender_dev`, creada sobre PostgreSQL 15. El archivo `.env.local` no se versiona.

`db/seed.sql` es solamente una referencia opcional para un entorno vacío. No debe ejecutarse en producción si el registro por OAuth ya creó el espacio de trabajo.

## Google OAuth

En Google Cloud Console:

1. Crear un proyecto.
2. Configurar la pantalla de consentimiento OAuth.
3. Habilitar Gmail API.
4. Crear un cliente OAuth Web.
5. Registrar `https://TU_DOMINIO/api/google/callback` como URI de redirección.
6. Cargar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_ALLOWED_EMAIL`.

Para configurar de forma segura un JSON descargado de Google sin imprimir el secreto:

```bash
npm run oauth:configure -- /ruta/al/client_secret.json
```

La aplicación solicita identidad básica, `gmail.send` y `gmail.metadata`. El último permite detectar respuestas mediante identificadores y encabezados sin descargar ni almacenar el cuerpo del correo. Google clasifica los permisos de lectura de Gmail como restringidos, por lo que un despliegue para terceros puede requerir verificación OAuth y requisitos adicionales.

Generar secretos:

```bash
openssl rand -hex 32
```

Guardar `TOKEN_ENCRYPTION_KEY` únicamente como secreto del entorno de producción.

## Worker

El proceso web y el worker se despliegan por separado usando el mismo código y la misma base:

```bash
npm run worker
```

El worker reclama un único trabajo vencido de forma transaccional, marca el contacto como `PROCESSING`, envía mediante Gmail y registra `SENT` o `ERROR`. Si el proceso cae después de Gmail, el trabajo no se reenvía automáticamente.

Un trabajo interrumpido pasa a `ERROR` después de 10 minutos con una indicación para revisar Gmail antes de volver a intentar. El panel muestra si el worker ha informado actividad durante el último minuto. Pausar una campaña impide reclamar nuevos envíos; uno que ya está en curso puede terminar. La pausa general de envíos no detiene la revisión de respuestas ni la limpieza de datos.

En producción se requieren **dos procesos permanentes** (`npm run start` y `npm run worker`) conectados a la misma base PostgreSQL, HTTPS, un dominio público para OAuth y copias de seguridad de la base. Un hosting que suspenda el worker impedirá tanto los envíos como la detección de respuestas. El control maestro de envíos empieza deshabilitado.

Para comprobar el flujo de campaña sin enviar correos, con la aplicación local encendida:

```bash
npm run smoke:campaign
```

La prueba crea un espacio temporal aislado y verifica vista previa, campaña, seguimiento, pausa, reanudación, cancelación y eliminación.

## Antes de habilitar envíos

1. Conectar una cuenta autorizada de Google Workspace.
2. Importar únicamente contactos con base legítima para ser contactados.
3. Revisar las plantillas y variables.
4. Crear una campaña con dos direcciones controladas.
5. Verificar Gmail, auditoría y estados.
6. Recién entonces habilitar el control maestro.
