# Relay — plataforma de comunicación comercial

Aplicación propia para administrar contactos, plantillas, campañas y envíos graduales desde Google Workspace.

## Arquitectura

- Next.js + TypeScript para interfaz y API.
- PostgreSQL como fuente de verdad.
- OAuth 2.0 de Google para acceso y autorización de Gmail.
- Worker Node separado con bloqueo `FOR UPDATE SKIP LOCKED`.
- Tokens de Google cifrados con AES-256-GCM.
- Claves de idempotencia y restricciones únicas para impedir duplicados.
- Auditoría de acciones relevantes.

La interfaz se inicia en `DEMO_MODE=true`: permite revisar y editar plantillas sin una base de datos ni credenciales reales. En producción debe configurarse PostgreSQL y cambiar `DEMO_MODE=false`.

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

La aplicación solicita identidad básica y `gmail.send`. El administrador de Workspace puede requerir aprobar la aplicación.

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

El worker reclama un único trabajo vencido de forma transaccional, marca el contacto como `PROCESSING`, envía mediante Gmail y registra `SENT` o `ERROR`. Si el proceso cae después de Gmail, el trabajo permanece `PROCESSING` para revisión manual y no se reenvía automáticamente.

## Antes de habilitar envíos

1. Conectar una cuenta autorizada de Google Workspace.
2. Importar únicamente contactos con base legítima para ser contactados.
3. Revisar las plantillas y variables.
4. Crear una campaña con dos direcciones controladas.
5. Verificar Gmail, auditoría y estados.
6. Recién entonces habilitar el control maestro.
