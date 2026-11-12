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
  hub text,
  network text,
  job_title text,
  city text,
  email_quality text,
  linkedin_url text,
  existing_client_office text,
  source_date date,
  last_imported_at timestamptz,
  last_contacted_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS contacts_workspace_status_idx ON contacts(workspace_id, status);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hub text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS network text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_quality text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS existing_client_office text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_date date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_imported_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_workspace_segments_idx ON contacts(workspace_id, company_type, hub, email_quality);

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
  template_id uuid REFERENCES message_templates(id) ON DELETE RESTRICT,
  filters jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES message_templates(id) ON DELETE RESTRICT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS contact_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_imports_workspace_created_idx ON contact_imports(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_import_items (
  import_id uuid NOT NULL REFERENCES contact_imports(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source_row integer NOT NULL,
  was_new boolean NOT NULL,
  PRIMARY KEY (import_id, contact_id)
);

CREATE INDEX IF NOT EXISTS contact_import_items_contact_idx ON contact_import_items(contact_id);

CREATE TABLE IF NOT EXISTS email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,
  template_version integer NOT NULL,
  step_number integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'PROCESSING', 'SENT', 'ERROR', 'CANCELLED')),
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  sent_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  rendered_subject text,
  rendered_body text,
  gmail_message_id text,
  gmail_thread_id text,
  reply_message_id text,
  reply_from text,
  reply_detected_at timestamptz,
  last_reply_checked_at timestamptz,
  error_message text,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id, step_number)
);

ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS step_number integer NOT NULL DEFAULT 0;
ALTER TABLE email_jobs DROP CONSTRAINT IF EXISTS email_jobs_campaign_id_contact_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS email_jobs_campaign_contact_step_idx ON email_jobs(campaign_id,contact_id,step_number);

CREATE TABLE IF NOT EXISTS campaign_followups (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number BETWEEN 1 AND 3),
  delay_days integer NOT NULL CHECK (delay_days BETWEEN 1 AND 90),
  template_id uuid NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id,step_number)
);

CREATE INDEX IF NOT EXISTS email_jobs_due_idx ON email_jobs(status, scheduled_at);

ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS gmail_thread_id text;
ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS reply_message_id text;
ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS reply_from text;
ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS reply_detected_at timestamptz;
ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS last_reply_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS email_jobs_reply_check_idx ON email_jobs(status, last_reply_checked_at, sent_at);

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
