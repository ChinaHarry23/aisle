/**
 * Schema.
 *
 * Two tables carry the whole application. Keeping accounts as real rows (rather
 * than a JSON document) is what makes email uniqueness a database constraint
 * instead of a read-then-write race, which is exactly the bug the old Blob store
 * could not avoid.
 *
 * `CREATE TABLE IF NOT EXISTS` plus an additive `ALTER TABLE` for each new column
 * means the file can be opened by a newer build without a migration tool: the
 * statement is idempotent and a duplicate-column error is ignored.
 */

import type { Database } from "./types";

const TABLES = `
create table if not exists users (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  role          text not null default 'beta',
  password_hash text not null,
  created_at    text not null
);

create index if not exists users_email_idx on users (email);

create table if not exists kv (
  key        text primary key,
  value      text not null,
  updated_at text not null
);

create table if not exists credit_accounts (
  user_id         text primary key,
  balance_milli   integer not null default 0,
  free_granted_at text,
  last_grant_ref  text,
  grant_epoch     integer not null default 0,
  updated_at      text not null
);

create table if not exists credit_holds (
  ref        text primary key,
  user_id    text not null,
  milli      integer not null,
  epoch      integer not null,
  status     text not null,
  charged_milli integer,
  created_at text not null
);

create index if not exists credit_holds_user_idx on credit_holds (user_id, status, created_at);

create table if not exists free_grants (
  identity_key text primary key,
  user_id      text not null,
  granted_at   text not null
);

create index if not exists free_grants_day_idx on free_grants (granted_at);

create table if not exists signup_attempts (
  id         text primary key,
  ip_key     text not null,
  created_at text not null
);

create index if not exists signup_attempts_ip_idx on signup_attempts (ip_key, created_at);

create table if not exists credit_ledger (
  id                  text primary key,
  user_id             text not null,
  delta_milli         integer not null,
  reason              text not null,
  ref                 text,
  model_id            text,
  cost_usd            real,
  balance_after_milli integer,
  note                text,
  created_at          text not null
);

create index if not exists credit_ledger_user_idx on credit_ledger (user_id, created_at);

create unique index if not exists credit_ledger_ref_idx on credit_ledger (reason, ref) where ref is not null;

create table if not exists billing_customers (
  user_id                text primary key,
  stripe_customer_id     text not null unique,
  stripe_subscription_id text,
  status                 text,
  cancel_at_period_end   integer not null default 0,
  current_period_end     text,
  stripe_livemode        integer,
  subscription_event_at  bigint,
  updated_at             text not null
);

create table if not exists stripe_events (
  id          text primary key,
  type        text not null,
  received_at text not null
);

create table if not exists whichgrocer_connections (
  user_id       text primary key,
  access_token  text not null,
  refresh_token text,
  expires_at    text,
  client_id     text not null,
  redirect_uri  text not null,
  updated_at    text not null
);

create table if not exists media_objects (
  id            text primary key,
  owner_user_id text not null,
  kind          text not null,
  mime          text not null,
  size          integer not null,
  driver        text not null,
  bytes         bytea,
  created_at    text not null
);

create table if not exists account_assets (
  id             text primary key,
  owner_user_id  text not null,
  kind           text not null,
  media_url      text not null,
  mime           text not null,
  campaign_id    text,
  campaign_name  text,
  product        text,
  label          text,
  prompt         text,
  model_id       text,
  model_name     text,
  creative_id    text,
  created_at     text not null,
  removed_at     text,
  cost_usd       real,
  cost_estimated integer,
  input_tokens   integer,
  output_tokens  integer
);

create index if not exists account_assets_owner_idx on account_assets (owner_user_id, created_at);
`;

/** Columns added after the first release. Duplicates are expected and ignored. */
const ADDITIVE = [
  "alter table users add column updated_at text",
  "alter table users add column last_login_at text",
  "alter table users add column password_login integer not null default 1",
  "alter table users add column google_sub text",
  "alter table users add column apple_sub text",
  "create unique index if not exists users_google_sub_idx on users (google_sub) where google_sub is not null",
  "create unique index if not exists users_apple_sub_idx on users (apple_sub) where apple_sub is not null",
  // Bumped by every monthly reset and expiry, so a hold from an earlier grant refunds nothing.
  "alter table credit_accounts add column grant_epoch integer not null default 0",
  // Test-mode and live-mode customer ids are different objects; a row from the other mode is stale.
  "alter table billing_customers add column stripe_livemode integer",
  // A settle that failed twice parks its charge here, so the sweeper applies it instead of refunding.
  "alter table credit_holds add column charged_milli integer",
  // Stripe's `created` (unix seconds) of the newest event that wrote the subscription's status.
  "alter table billing_customers add column subscription_event_at bigint",
  // Bumped when a password is replaced or an email is claimed by Google/Apple, which ends every older session.
  "alter table users add column session_version integer not null default 0",
  "alter table account_assets add column cost_usd real",
  "alter table account_assets add column cost_estimated integer",
  "alter table account_assets add column input_tokens integer",
  "alter table account_assets add column output_tokens integer",
];

export async function migrate(db: Database) {
  // Each statement is issued separately: `exec`-style multi-statement calls are
  // not portable between the two drivers.
  for (const statement of TABLES.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(statement);
  }
  for (const statement of ADDITIVE) {
    try {
      await db.execute(statement);
    } catch {
      // Column already exists.
    }
  }
}
