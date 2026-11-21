import { MEMORY_TABLES_SQL } from "./memory-store.ts";

// herd.db schema text and version. The Store applies it on open.

// Added in schema version 2 so databases created before plan 008 get the table too.
export const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS state(
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

/** What the owner, the agent and its tools said in each task, for the app's task view. */
export const TRANSCRIPT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS transcript(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  at TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  tool_call_id TEXT,
  status TEXT
);
CREATE INDEX IF NOT EXISTS transcript_task ON transcript(task_id, id);`;

/** The Herder's conversation with the owner, searchable (docs/spec/08-herder-interaction.md §2). */
export const HERDER_TURNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS herder_turns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  task_id TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS herder_turns_fts USING fts5(
  text, content='herder_turns', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS herder_turns_ai AFTER INSERT ON herder_turns BEGIN
  INSERT INTO herder_turns_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS herder_turns_ad AFTER DELETE ON herder_turns BEGIN
  INSERT INTO herder_turns_fts(herder_turns_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;`;

/** Tasks the owner started, kept across restarts so they can be seen and continued (ADR 0039). */
export const TASKS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  cwd TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT,
  stage TEXT NOT NULL,
  last_report TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  ended_why TEXT,
  failed INTEGER NOT NULL DEFAULT 0,
  agent_session_id TEXT,
  automatic_decisions_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_updated ON tasks(updated_at);`;

/** Schema 7: where each task's agent works (ADR 0043). */
export const TASK_WORKSPACE_SQL = "ALTER TABLE tasks ADD COLUMN workspace_json TEXT;";

/** Schema 7: the task a message the owner can reply to is about (ADR 0043). */
export const MESSAGE_TASKS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS message_tasks(
  message_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  at TEXT NOT NULL
);`;

/**
 * Schema 8: the Herder's whole conversation as the model saw it, one message per row, oldest
 * first. Nothing is cut: old parts are folded into summaries the model writes (ADR 0045).
 */
export const HERDER_LOG_TABLE_SQL = `CREATE TABLE IF NOT EXISTS herder_log(
  seq INTEGER PRIMARY KEY,
  message_json TEXT NOT NULL
);`;

/** Where the Herder kept the tail of its conversation before schema version 8. */
export const LEGACY_HERDER_STATE_KEY = "herder.messages";

/**
 * Schema 9: messages for the owner that are stored before they are sent and kept until the
 * channel took them (docs/spec/04-herder.md "Delivery").
 */
export const OUTBOX_TABLE_SQL = `CREATE TABLE IF NOT EXISTS outbox(
  id TEXT PRIMARY KEY,
  view_json TEXT NOT NULL,
  task_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  error TEXT
);`;

/** Schema 10: pull requests tasks opened, followed on GitHub (docs/spec/04-herder.md "Pull requests"). */
export const PR_WATCHES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS pr_watches(
  key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

/** Schema 11: mail the owner asked to be told about (docs/spec/04-herder.md "Mail"). */
export const MAIL_WATCHES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS mail_watches(
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;

/** New-work watches the owner asked for (ADR 0052). */
export const INTAKE_WATCHES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS intake_watches(
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;

/** Schema 13: what the Herder does at set times, as the owner asked (ADR 0055). */
export const SCHEDULES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schedules(
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;

/** Schema 14: steps leaving the Mac the owner allowed for a task (ADR 0056). */
export const TASK_ALLOWED_STEPS_SQL = "ALTER TABLE tasks ADD COLUMN allowed_steps_json TEXT;";

/**
 * Schema 15: the cards sent to the owner (reports, approvals, questions, offers), each in its
 * latest form, so the desktop pet shows them after a restart (ADR 0072).
 */
export const OWNER_CARDS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS owner_cards(
  ref TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  task_id TEXT,
  view_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_cards_at ON owner_cards(at);`;

/** Schema 16: one row per request to the Herder's model (ADR 0093); replaced in schema 17. */
export const HERDER_REQUESTS_V16_SQL = `CREATE TABLE IF NOT EXISTS herder_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  model TEXT NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  parts_json TEXT NOT NULL
);`;

/**
 * Schema 17: the Herder's conversation and context, all in herd.db (ADR 0095).
 * - herder_messages: every message, oldest first, with what it is next to it (replaces herder_log).
 * - herder_rounds: one row per round (the message that started it: the owner, a task's result, …).
 * - herder_requests: every request to the model with what the provider counted; the only usage.
 * - herder_folds: every fold ever made, kept after it is taken into a bigger one.
 * - herder_events: what happened to the conversation (folds, repairs, starts).
 * - herder_prompts: each system prompt and tool list once, by hash.
 */
export const HERDER_TABLES_SQL = `CREATE TABLE IF NOT EXISTS herder_messages(
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT,
  round INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  chars INTEGER NOT NULL,
  message_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS herder_messages_round ON herder_messages(round);
CREATE TABLE IF NOT EXISTS herder_rounds(
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS herder_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  seq INTEGER,
  round INTEGER,
  model TEXT NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL,
  window INTEGER,
  parts_json TEXT,
  prompt TEXT,
  failed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS herder_requests_at ON herder_requests(at);
CREATE INDEX IF NOT EXISTS herder_requests_round ON herder_requests(round);
CREATE TABLE IF NOT EXISTS herder_folds(
  block_id TEXT PRIMARY KEY,
  num INTEGER NOT NULL,
  parent TEXT,
  level INTEGER NOT NULL,
  state TEXT NOT NULL,
  made_by TEXT NOT NULL,
  topic TEXT,
  summary TEXT NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  direct_start INTEGER,
  direct_end INTEGER,
  messages INTEGER NOT NULL,
  call_seq INTEGER,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  block_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS herder_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  round INTEGER,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS herder_events_at ON herder_events(at);
CREATE TABLE IF NOT EXISTS herder_prompts(
  hash TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  system TEXT NOT NULL,
  tools_json TEXT NOT NULL
);`;

export const LATEST_SCHEMA_VERSION = 17;

export const SCHEMA_SQL = `
CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE items(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  tool_call_json TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  risk TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  message_ref_json TEXT
);
CREATE TABLE decisions(
  item_id TEXT NOT NULL,
  action TEXT NOT NULL,
  text TEXT,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  risk TEXT NOT NULL,
  rule_id TEXT,
  owner_id TEXT,
  precedents_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE rules(
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  match_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL
);
${STATE_TABLE_SQL}
${TRANSCRIPT_TABLE_SQL}
${HERDER_TURNS_TABLE_SQL}
${MEMORY_TABLES_SQL}
${TASKS_TABLE_SQL}
${TASK_WORKSPACE_SQL}
${MESSAGE_TASKS_TABLE_SQL}
${OUTBOX_TABLE_SQL}
${PR_WATCHES_TABLE_SQL}
${MAIL_WATCHES_TABLE_SQL}
${INTAKE_WATCHES_TABLE_SQL}
${SCHEDULES_TABLE_SQL}
${TASK_ALLOWED_STEPS_SQL}
${OWNER_CARDS_TABLE_SQL}
${HERDER_TABLES_SQL}
`;
