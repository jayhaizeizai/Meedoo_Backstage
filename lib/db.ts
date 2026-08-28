import { Pool, PoolClient, QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var meedooPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var meedooSchemaReady: Promise<void> | undefined;
}

const connectionString = process.env.DATABASE_URL;

export function isDatabaseConfigured() {
  return Boolean(connectionString);
}

export function db() {
  if (!connectionString) throw new Error("DATABASE_NOT_CONFIGURED");
  global.meedooPool ??= new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  return global.meedooPool;
}

export async function ensureSchema() {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_NOT_CONFIGURED");
  global.meedooSchemaReady ??= db().query(`
    CREATE TABLE IF NOT EXISTS meedoo_users (
      open_id text PRIMARY KEY,
      user_id text,
      name text NOT NULL,
      email text,
      avatar_url text,
      tenant_key text,
      role text NOT NULL DEFAULT 'member',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id uuid PRIMARY KEY,
      request_id text UNIQUE,
      provider_job_id text,
      profile_username text NOT NULL,
      title text NOT NULL,
      caption text NOT NULL DEFAULT '',
      original_filename text,
      media_size_bytes bigint,
      media_path text,
      uploader_open_id text REFERENCES meedoo_users(open_id) ON DELETE SET NULL,
      uploader_name text,
      status text NOT NULL DEFAULT 'queued',
      target_platforms text[] NOT NULL DEFAULT '{}',
      imported boolean NOT NULL DEFAULT false,
      provider_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id uuid PRIMARY KEY,
      uploader_open_id text NOT NULL REFERENCES meedoo_users(open_id) ON DELETE CASCADE,
      uploader_name text NOT NULL,
      original_filename text NOT NULL,
      content_type text NOT NULL,
      expected_size bigint NOT NULL,
      chunk_size integer NOT NULL,
      total_chunks integer NOT NULL,
      media_path text,
      status text NOT NULL DEFAULT 'uploading',
      error_message text,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS upload_session_chunks (
      session_id uuid NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
      chunk_index integer NOT NULL,
      size_bytes integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(session_id, chunk_index)
    );
    CREATE TABLE IF NOT EXISTS publications (
      id bigserial PRIMARY KEY,
      upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      platform text NOT NULL,
      request_id text,
      provider_job_id text,
      platform_post_id text,
      status text NOT NULL DEFAULT 'queued',
      success boolean,
      post_url text,
      error_message text,
      fallback_to_inbox boolean NOT NULL DEFAULT false,
      retry_count integer NOT NULL DEFAULT 0,
      last_synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(upload_id, platform)
    );
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id bigserial PRIMARY KEY,
      publication_id bigint NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      captured_at timestamptz NOT NULL DEFAULT now(),
      metrics jsonb NOT NULL DEFAULT '{}',
      source text NOT NULL DEFAULT 'upload-post',
      UNIQUE(publication_id, captured_at)
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      delivery_id text PRIMARY KEY,
      event text NOT NULL,
      payload jsonb NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id bigserial PRIMARY KEY,
      user_open_id text REFERENCES meedoo_users(open_id) ON DELETE CASCADE,
      upload_id uuid REFERENCES uploads(id) ON DELETE CASCADE,
      kind text NOT NULL,
      message text NOT NULL,
      delivered_to_lark boolean NOT NULL DEFAULT false,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS uploads_uploader_created_idx ON uploads(uploader_open_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS uploads_status_idx ON uploads(status);
    CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx ON upload_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS publications_status_idx ON publications(status);
    CREATE UNIQUE INDEX IF NOT EXISTS publications_platform_post_unique
      ON publications(platform,platform_post_id) WHERE platform_post_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS metric_snapshots_publication_captured_idx ON metric_snapshots(publication_id, captured_at DESC);
  `).then(() => undefined).catch((error) => { global.meedooSchemaReady = undefined; throw error; });
  return global.meedooSchemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  await ensureSchema();
  return db().query<T>(text, values);
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
