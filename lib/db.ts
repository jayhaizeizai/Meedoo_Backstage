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
  global.meedooPool ??= new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return global.meedooPool;
}

export async function ensureSchema() {
  if (!isDatabaseConfigured()) throw new Error("DATABASE_NOT_CONFIGURED");
  global.meedooSchemaReady ??= db()
    .query(
      `
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
    CREATE TABLE IF NOT EXISTS profile_metric_snapshots (
      id bigserial PRIMARY KEY,
      platform text NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT now(),
      followers bigint,
      metrics jsonb NOT NULL DEFAULT '{}',
      source text NOT NULL DEFAULT 'upload-post-profile',
      UNIQUE(platform, captured_at)
    );
    CREATE TABLE IF NOT EXISTS publication_follower_attributions (
      id bigserial PRIMARY KEY,
      publication_id bigint NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      profile_snapshot_id bigint NOT NULL REFERENCES profile_metric_snapshots(id) ON DELETE CASCADE,
      attributed_followers integer NOT NULL CHECK (attributed_followers >= 0),
      method text NOT NULL DEFAULT '24h-view-weighted',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(publication_id, profile_snapshot_id)
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
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_type text CHECK (video_type IN ('repost','saves','website_visit','likes'));
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='uploads'::regclass AND conname='uploads_video_type_check' AND position('likes' in pg_get_constraintdef(oid))=0) THEN
        ALTER TABLE uploads DROP CONSTRAINT uploads_video_type_check;
        ALTER TABLE uploads ADD CONSTRAINT uploads_video_type_check CHECK (video_type IN ('repost','saves','website_visit','likes'));
      END IF;
    END $$;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved';
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS reviewed_by text REFERENCES meedoo_users(open_id) ON DELETE SET NULL;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS review_comment text;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS parent_upload_id uuid REFERENCES uploads(id) ON DELETE SET NULL;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS media_delete_after timestamptz;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS file_deleted_at timestamptz;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_width integer;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_height integer;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_duration_seconds numeric;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_codec text;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS platform_content jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS removed_at timestamptz;
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS removed_by text REFERENCES meedoo_users(open_id) ON DELETE SET NULL;
    ALTER TABLE publications ADD COLUMN IF NOT EXISTS removed_at timestamptz;
    ALTER TABLE publications ADD COLUMN IF NOT EXISTS removed_by text REFERENCES meedoo_users(open_id) ON DELETE SET NULL;
    CREATE TABLE IF NOT EXISTS upload_reviews (
      id bigserial PRIMARY KEY,
      upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      reviewer_open_id text NOT NULL REFERENCES meedoo_users(open_id) ON DELETE RESTRICT,
      decision text NOT NULL,
      comment text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS maintenance_state (
      key text PRIMARY KEY,
      value jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS libtv_imports (
      file_hash text PRIMARY KEY,
      original_filename text NOT NULL,
      imported_by text REFERENCES meedoo_users(open_id) ON DELETE SET NULL,
      package_points integer NOT NULL CHECK (package_points > 0),
      package_cost_cny numeric(12,2) NOT NULL CHECK (package_cost_cny > 0),
      source_row_count integer NOT NULL,
      imported_row_count integer NOT NULL DEFAULT 0,
      first_consumed_at timestamptz,
      last_consumed_at timestamptz,
      imported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS libtv_credit_entries (
      entry_key text PRIMARY KEY,
      import_hash text NOT NULL REFERENCES libtv_imports(file_hash) ON DELETE RESTRICT,
      source_row integer NOT NULL,
      consumed_at timestamptz NOT NULL,
      entry_type text NOT NULL,
      model text,
      task_details text,
      project_name text,
      task_id text,
      member_id text,
      member_name text,
      member_alias text,
      project_id text,
      points integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS libtv_accounting_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      package_points integer NOT NULL CHECK (package_points > 0),
      package_cost_cny numeric(12,2) NOT NULL CHECK (package_cost_cny > 0),
      updated_by text REFERENCES meedoo_users(open_id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS libtv_member_mappings (
      member_id text PRIMARY KEY,
      uploader_open_id text NOT NULL REFERENCES meedoo_users(open_id) ON DELETE CASCADE,
      updated_by text REFERENCES meedoo_users(open_id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    UPDATE uploads SET media_delete_after=NULL WHERE media_delete_after IS NOT NULL;
    ALTER TABLE publications ADD COLUMN IF NOT EXISTS analytics_attempted_at timestamptz;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS lark_queued boolean NOT NULL DEFAULT false;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS lark_attempted_at timestamptz;
    CREATE INDEX IF NOT EXISTS uploads_uploader_created_idx ON uploads(uploader_open_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS uploads_status_idx ON uploads(status);
    ALTER TABLE uploads ADD COLUMN IF NOT EXISTS facebook_page_id text;
    CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx ON upload_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS publications_status_idx ON publications(status);
    CREATE UNIQUE INDEX IF NOT EXISTS publications_platform_post_unique
      ON publications(platform,platform_post_id) WHERE platform_post_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS metric_snapshots_publication_captured_idx ON metric_snapshots(publication_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS profile_metric_snapshots_platform_captured_idx ON profile_metric_snapshots(platform, captured_at DESC);
    CREATE INDEX IF NOT EXISTS publication_follower_attributions_publication_idx ON publication_follower_attributions(publication_id);
    CREATE INDEX IF NOT EXISTS uploads_review_status_submitted_idx ON uploads(review_status, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS upload_reviews_upload_created_idx ON upload_reviews(upload_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS libtv_credit_entries_consumed_idx ON libtv_credit_entries(consumed_at DESC);
    CREATE INDEX IF NOT EXISTS libtv_credit_entries_member_consumed_idx ON libtv_credit_entries(member_id, consumed_at DESC);
  `,
    )
    .then(() => undefined)
    .catch((error) => {
      global.meedooSchemaReady = undefined;
      throw error;
    });
  return global.meedooSchemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
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
