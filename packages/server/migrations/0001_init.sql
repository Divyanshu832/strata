-- Strata initial schema.
-- Facts are never hard-deleted: replacing a fact closes its valid_to and links superseded_by.
-- Only the forget API deletes rows, and it writes to audit_log first.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- Workspaces and API keys (multi-tenant) ----------------------------------

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table api_keys (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  prefix        text not null,              -- first chars, shown in the UI
  key_hash      text not null unique,       -- sha256 of the full key
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- Sources: the raw input, stored as-is ------------------------------------

create table sources (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  scope         text not null default 'user',
  kind          text not null check (kind in ('message', 'session', 'document')),
  external_id   text,                       -- caller's id, makes ingest idempotent
  author        text,                       -- who said it (user, agent name, person)
  content       text not null,
  metadata      jsonb not null default '{}',
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  extracted_at  timestamptz,
  unique (workspace_id, external_id)
);

-- Entities: one per person / project / place / topic (a "note") ------------

create table entities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  type          text not null default 'thing',  -- person | org | project | place | topic | thing
  aliases       text[] not null default '{}',
  summary       text,
  tags          text[] not null default '{}',
  embedding     vector(1536),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index entities_ws_name_idx on entities (workspace_id, lower(name));
create index entities_name_trgm_idx on entities using gin (name gin_trgm_ops);

-- Facts: subject - predicate - object, with valid time and learned time -----

create table facts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  scope            text not null default 'user',
  kind             text not null default 'fact' check (kind in ('fact', 'preference', 'event')),
  subject_id       uuid not null references entities(id) on delete cascade,
  predicate        text not null,             -- snake_case, e.g. lives_in, works_on
  object_id        uuid references entities(id) on delete set null,  -- when the object is an entity (a link)
  object_value     text,                      -- when the object is a plain value
  statement        text not null,             -- human-readable sentence
  context          text,                      -- preference context, e.g. "chat"
  strength         real,                      -- preference strength 0..1
  valid_from       timestamptz not null,      -- when it became true
  valid_to         timestamptz,               -- null = still true
  recorded_at      timestamptz not null default now(),  -- when Strata learned it
  status           text not null default 'active'
                   check (status in ('active', 'replaced', 'contradiction')),
  superseded_by    uuid references facts(id),
  confidence       real not null default 1,
  pinned           boolean not null default false,
  source_id        uuid references sources(id) on delete set null,
  extractor_version text not null,
  embedding        vector(1536),
  tsv              tsvector generated always as (to_tsvector('english', statement)) stored,
  check (object_id is not null or object_value is not null)
);
create index facts_current_idx   on facts (workspace_id, subject_id, predicate) where valid_to is null;
create index facts_valid_idx     on facts (workspace_id, valid_from, valid_to);
create index facts_object_idx    on facts (workspace_id, object_id);
create index facts_tsv_idx       on facts using gin (tsv);
create index facts_embedding_idx on facts using hnsw (embedding vector_cosine_ops);

-- Document chunks ----------------------------------------------------------

create table chunks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  scope         text not null default 'user',
  source_id     uuid not null references sources(id) on delete cascade,
  ordinal       int not null,
  content       text not null,
  embedding     vector(1536),
  tsv           tsvector generated always as (to_tsvector('english', content)) stored
);
create index chunks_tsv_idx       on chunks using gin (tsv);
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

-- Audit log: every forget and edit -------------------------------------------

create table audit_log (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  actor         text not null,               -- api key name or "web"
  action        text not null,               -- forget | edit | pin | unpin | reextract
  target_type   text not null,               -- fact | source | entity
  target_id     uuid not null,
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);

-- Row-level security: every query runs with app.workspace_id set -------------
-- The API sets it per transaction (see src/db/client.ts). Superusers bypass RLS,
-- so production connects as the non-superuser role created below.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'strata_app') then
    create role strata_app nologin;
  end if;
end $$;

grant usage on schema public to strata_app;
grant select, insert, update, delete on sources, entities, facts, chunks, audit_log to strata_app;
grant select on workspaces, api_keys to strata_app;
grant usage on all sequences in schema public to strata_app;

alter table sources   enable row level security;
alter table entities  enable row level security;
alter table facts     enable row level security;
alter table chunks    enable row level security;
alter table audit_log enable row level security;

create policy ws_isolation on sources   using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy ws_isolation on entities  using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy ws_isolation on facts     using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy ws_isolation on chunks    using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy ws_isolation on audit_log using (workspace_id = current_setting('app.workspace_id', true)::uuid);
