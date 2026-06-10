CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_jpy INTEGER NOT NULL,
  monthly_minutes INTEGER NOT NULL,
  daily_minutes INTEGER NOT NULL,
  max_session_seconds INTEGER NOT NULL,
  max_users INTEGER NOT NULL,
  max_concurrent_sessions INTEGER NOT NULL,
  overage_jpy_per_min INTEGER NOT NULL,
  commercial_allowed INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer_name TEXT,
  contact_name TEXT,
  memo TEXT,
  industry TEXT NOT NULL DEFAULT 'hotel_ryokan',
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  billing_mode TEXT NOT NULL DEFAULT 'invoice',
  monthly_revenue_jpy INTEGER NOT NULL,
  cost_per_minute_jpy REAL NOT NULL DEFAULT 6.5,
  model TEXT NOT NULL DEFAULT 'gpt-realtime',
  history_retention_mode TEXT NOT NULL DEFAULT 'metadata_only',
  daily_minutes_override INTEGER,
  monthly_minutes_override INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (industry != 'pharmacy' OR history_retention_mode = 'metadata_only'),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  monthly_minutes_limit INTEGER,
  daily_minutes_limit INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS account_users (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  location_id TEXT,
  access_id_hash TEXT NOT NULL UNIQUE,
  access_id_label TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'staff',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS usage_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  location_id TEXT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER,
  ended_at INTEGER,
  reserved_seconds INTEGER NOT NULL DEFAULT 0,
  billable_seconds INTEGER NOT NULL DEFAULT 0,
  estimated_cost_jpy REAL NOT NULL DEFAULT 0,
  stop_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (user_id) REFERENCES account_users(id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  delta_seconds INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  raw_json TEXT,
  FOREIGN KEY (session_id) REFERENCES usage_sessions(id)
);

CREATE TABLE IF NOT EXISTS usage_daily_rollups (
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  billable_seconds INTEGER NOT NULL DEFAULT 0,
  estimated_cost_jpy REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, date),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS quota_adjustments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  price_jpy INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_users_access_id_hash ON account_users(access_id_hash);
CREATE INDEX IF NOT EXISTS idx_usage_sessions_account_status ON usage_sessions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_status ON usage_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_sessions_started_at ON usage_sessions(started_at);

INSERT OR IGNORE INTO plans (
  id, name, monthly_price_jpy, monthly_minutes, daily_minutes,
  max_session_seconds, max_users, max_concurrent_sessions,
  overage_jpy_per_min, commercial_allowed
) VALUES
  ('free', 'Free Trial', 0, 10, 3, 180, 1, 1, 0, 0),
  ('lite', 'Business Lite', 9800, 300, 30, 600, 3, 1, 25, 1),
  ('standard', 'Business Standard', 29800, 1200, 100, 900, 10, 2, 22, 1),
  ('plus', 'Business Plus', 79800, 4000, 300, 1200, 30, 5, 18, 1);
