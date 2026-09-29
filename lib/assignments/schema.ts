import { query } from "../db";
import { seedreamSchema } from "../seedream";

let ready: Promise<unknown> | undefined;
export async function assignmentSchema() {
  await seedreamSchema();
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES meedoo_users(open_id),
      assignee_id text REFERENCES meedoo_users(open_id), deadline timestamptz,
      title text NOT NULL, brief text NOT NULL, summary text NOT NULL DEFAULT '',
      storyboard_prompt text NOT NULL DEFAULT '', storyboard_asset_id uuid REFERENCES generation_assets(id),
      version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='assignments' AND column_name='assignee_id') THEN
        ALTER TABLE assignments ADD COLUMN assignee_id text REFERENCES meedoo_users(open_id);
        UPDATE assignments SET assignee_id=owner_id;
      END IF;
    END $$;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS deadline timestamptz;
    CREATE INDEX IF NOT EXISTS assignments_assignee_deadline ON assignments(assignee_id,deadline);
    CREATE INDEX IF NOT EXISTS assignments_owner_created ON assignments(owner_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS assignment_shots (
      id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES assignments(id), position integer NOT NULL,
      title text NOT NULL, prompt text NOT NULL, duration integer NOT NULL DEFAULT 6 CHECK(duration BETWEEN 4 AND 30),
      reference_asset_id uuid REFERENCES generation_assets(id), created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS assignment_shots_parent ON assignment_shots(assignment_id,position);
    CREATE TABLE IF NOT EXISTS assignment_runs (
      id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES assignments(id), shot_id uuid REFERENCES assignment_shots(id),
      owner_id text NOT NULL REFERENCES meedoo_users(open_id), kind text NOT NULL CHECK(kind IN ('storyboard','video')),
      input jsonb NOT NULL, error_code text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS assignment_runs_parent ON assignment_runs(assignment_id,created_at);
    CREATE TABLE IF NOT EXISTS assignment_plans (
      id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES assignments(id), owner_id text NOT NULL REFERENCES meedoo_users(open_id),
      kind text NOT NULL CHECK(kind IN ('summary','shots')), source_version integer NOT NULL, input jsonb NOT NULL,
      status text NOT NULL DEFAULT 'queued', output jsonb, usage jsonb, model text NOT NULL, error_code text,
      applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS assignment_plans_queue ON assignment_plans(status,created_at);
  `).catch(e => { ready = undefined; throw e; });
  await ready;
}
