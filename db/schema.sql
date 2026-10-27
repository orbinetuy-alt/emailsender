CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sending_enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Montevideo',
  send_interval_minutes integer NOT NULL DEFAULT 5 CHECK (send_interval_minutes BETWEEN 1 AND 1440),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  name text,
  role text NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expiry timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_id text,
  name text NOT NULL,
  company text,
  email text NOT NULL,
  company_type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'QUEUED', 'PROCESSING', 'SENT', 'ERROR', 'PAUSED', 'DO_NOT_CONTACT', 'REPLIED')),
  custom_fields jsonb NOT NULL DEFAULT '{}',
  last_contacted_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS contacts_workspace_status_idx ON contacts(workspace_id, status);

CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  start_at timestamptz,
  interval_minutes integer NOT NULL DEFAULT 5 CHECK (interval_minutes BETWEEN 1 AND 1440),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,
  template_version integer NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'PROCESSING', 'SENT', 'ERROR', 'CANCELLED')),
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  sent_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  rendered_subject text,
  rendered_body text,
  gmail_message_id text,
  error_message text,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS email_jobs_due_idx ON email_jobs(status, scheduled_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_workspace_created_idx ON audit_logs(workspace_id, created_at DESC);
