/**
 * Schema migrations. Append-only: never edit a migration that has shipped,
 * add a new one. `applyMigrations` is idempotent and safe to call on boot.
 */

export type Migration = {
  id: number;
  name: string;
  up: string;
};

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'core',
    up: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        email_lower   TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified_at TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,       -- sha256 of the bearer token, never the token itself
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);

      CREATE TABLE workspaces (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        slug          TEXT NOT NULL UNIQUE,
        plan          TEXT NOT NULL DEFAULT 'trial',
        -- Onboarding state machine. See lib/onboarding/machine.ts
        onboarding_step   TEXT NOT NULL DEFAULT 'company_profile',
        onboarding_done_at TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE memberships (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role         TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
        created_at   TEXT NOT NULL,
        UNIQUE (workspace_id, user_id)
      );
      CREATE INDEX memberships_user_idx ON memberships(user_id);

      -- Company context captured during onboarding; feeds agent prompts.
      CREATE TABLE company_profiles (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        legal_name   TEXT NOT NULL,
        industry     TEXT NOT NULL,
        size         TEXT NOT NULL,
        website      TEXT,
        description  TEXT NOT NULL DEFAULT '',
        tone         TEXT NOT NULL DEFAULT 'professional',
        timezone     TEXT NOT NULL DEFAULT 'UTC',
        goals        TEXT NOT NULL DEFAULT '[]',  -- JSON array
        updated_at   TEXT NOT NULL
      );

      -- An agent the workspace has activated, e.g. "Tom" the phone agent.
      CREATE TABLE workspace_agents (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_key    TEXT NOT NULL,            -- key into the agent catalog
        display_name TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
        config       TEXT NOT NULL DEFAULT '{}',  -- JSON, validated against the catalog schema
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE (workspace_id, agent_key)
      );

      CREATE TABLE connections (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider     TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error','revoked')),
        external_account TEXT,
        secret_ref   TEXT,     -- pointer to credential storage, never the secret itself
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE (workspace_id, provider)
      );

      -- A configured, repeatable automation owned by a workspace agent.
      CREATE TABLE workflows (
        id                 TEXT PRIMARY KEY,
        workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        workspace_agent_id TEXT NOT NULL REFERENCES workspace_agents(id) ON DELETE CASCADE,
        definition_key     TEXT NOT NULL,   -- key into the workflow definition registry
        name               TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
        trigger_kind       TEXT NOT NULL CHECK (trigger_kind IN ('manual','schedule','event')),
        trigger_config     TEXT NOT NULL DEFAULT '{}',
        input_defaults     TEXT NOT NULL DEFAULT '{}',
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX workflows_workspace_idx ON workflows(workspace_id);

      CREATE TABLE workflow_runs (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        status       TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
        trigger      TEXT NOT NULL,
        input        TEXT NOT NULL DEFAULT '{}',
        output       TEXT,
        error        TEXT,
        attempt      INTEGER NOT NULL DEFAULT 1,
        -- Set on queued runs; the claim query only picks up runs due now.
        run_after    TEXT NOT NULL,
        started_at   TEXT,
        finished_at  TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX runs_claim_idx ON workflow_runs(status, run_after);
      CREATE INDEX runs_workspace_idx ON workflow_runs(workspace_id, created_at DESC);

      CREATE TABLE workflow_run_steps (
        id         TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        step_key   TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','skipped')),
        output     TEXT,
        error      TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        UNIQUE (run_id, seq)
      );

      -- Append-only audit trail. Everything meaningful a workspace does lands here.
      CREATE TABLE activity_events (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_type   TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
        actor_id     TEXT,
        kind         TEXT NOT NULL,
        summary      TEXT NOT NULL,
        data         TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL
      );
      CREATE INDEX activity_workspace_idx ON activity_events(workspace_id, created_at DESC);
    `,
  },
  {
    id: 2,
    name: 'approvals',
    up: `
      -- Read-only until the workspace has completed onboarding (the trust
      -- contract): only then can a connection be promoted to read-write.
      ALTER TABLE connections ADD COLUMN access_level TEXT NOT NULL DEFAULT 'read_only'
        CHECK (access_level IN ('read_only', 'read_write'));

      -- One pending decision per gated action. The autonomy dial on
      -- workspace_agents.config decides whether an action needs one of
      -- these at all; this table is the inbox once it does. Granularity is
      -- per-action-kind, not per-tool: see design/README.md v1.1.
      CREATE TABLE approval_items (
        id                  TEXT PRIMARY KEY,
        workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        workspace_agent_id  TEXT NOT NULL REFERENCES workspace_agents(id) ON DELETE CASCADE,
        workflow_run_id     TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
        workflow_run_step_id TEXT REFERENCES workflow_run_steps(id) ON DELETE CASCADE,
        action_kind         TEXT NOT NULL CHECK (action_kind IN ('send','post','spend','delete','other')),
        summary             TEXT NOT NULL,
        payload             TEXT NOT NULL DEFAULT '{}',
        status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        decided_by_user_id  TEXT REFERENCES users(id),
        decided_at          TEXT,
        created_at          TEXT NOT NULL
      );
      CREATE INDEX approval_items_workspace_idx ON approval_items(workspace_id, status, created_at DESC);
    `,
  },
  {
    id: 3,
    name: 'tasks',
    up: `
      CREATE TABLE tasks (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        agent         TEXT NOT NULL,
        category      TEXT NOT NULL,
        title         TEXT NOT NULL,
        input         TEXT NOT NULL,
        output        TEXT,
        status        TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        tokens_used   INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        completed_at  TEXT,
        error         TEXT
      );
      CREATE INDEX tasks_workspace_idx ON tasks(workspace_id, created_at DESC);
      CREATE INDEX tasks_agent_idx ON tasks(agent);
    `,
  },
  {
    id: 4,
    name: 'magic_links_and_events',
    up: `
      -- Single-use email sign-in tokens (LIN-67). Like sessions, only the
      -- sha256 of the raw token is stored.
      CREATE TABLE magic_link_tokens (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        used_at    TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX magic_links_user_idx ON magic_link_tokens(user_id);

      -- Zero-cost cookieless funnel events (LIN-67 / audit fix #6). One row
      -- per event, no visitor identifiers.
      CREATE TABLE analytics_events (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX analytics_events_name_idx ON analytics_events(name, created_at DESC);
    `,
  },
  {
    // From the master lineage (LIN-52); renumbered 4 -> 5 during the LIN-73
    // merge because both lineages added a migration with id 4. Prod (main)
    // DBs already have 4 = magic_links_and_events and apply this as 5.
    id: 5,
    name: 'billing',
    up: `
      -- Append-only usage ledger (LIN-52 W10/W11). Every meter — monthly
      -- spend, overage, cap ratios — is derived from these rows; there is no
      -- mutable counter anywhere.
      CREATE TABLE usage_ledger (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        agent        TEXT NOT NULL,
        source       TEXT NOT NULL CHECK (source IN ('task','workflow_run','seed','grant')),
        source_id    TEXT,
        credits      REAL NOT NULL,
        tokens       INTEGER NOT NULL DEFAULT 0,
        reason       TEXT NOT NULL,
        occurred_at  TEXT NOT NULL
      );
      CREATE INDEX usage_ledger_workspace_idx ON usage_ledger(workspace_id, occurred_at DESC);
      CREATE INDEX usage_ledger_source_idx ON usage_ledger(source, source_id);

      CREATE TABLE subscriptions (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        plan         TEXT NOT NULL CHECK (plan IN ('trial','free','starter','team','scale')),
        status       TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','canceled')),
        current_period_start TEXT NOT NULL,
        current_period_end   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The hard spend cap (W10). 80% notifies, 100% pauses every agent.
      CREATE TABLE spend_caps (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        monthly_limit_credits REAL NOT NULL CHECK (monthly_limit_credits >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE invoices (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        number       TEXT NOT NULL UNIQUE,
        status       TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('open','paid','void')),
        period_start TEXT NOT NULL,
        period_end   TEXT NOT NULL,
        currency     TEXT NOT NULL DEFAULT 'usd',
        subtotal_usd REAL NOT NULL DEFAULT 0,
        total_usd    REAL NOT NULL DEFAULT 0,
        issued_at    TEXT NOT NULL,
        paid_at      TEXT
      );
      CREATE INDEX invoices_workspace_idx ON invoices(workspace_id, issued_at DESC);

      CREATE TABLE invoice_line_items (
        id          TEXT PRIMARY KEY,
        invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('subscription','overage')),
        description TEXT NOT NULL,
        quantity    REAL NOT NULL,
        unit_usd    REAL NOT NULL,
        amount_usd  REAL NOT NULL
      );
    `,
  },
];

type MigrateDb = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
};

export function applyMigrations(db: MigrateDb): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );

  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      count++;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${m.id} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
  return count;
}
