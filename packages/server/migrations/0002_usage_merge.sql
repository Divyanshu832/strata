-- Usage log (Usage tab: tokens, cost, latency) and the 'merged' fact status (duplicate merge job).

alter table facts drop constraint facts_status_check;
alter table facts add constraint facts_status_check
  check (status in ('active', 'replaced', 'contradiction', 'merged'));

create table usage_events (
  id            bigserial primary key,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  kind          text not null,             -- remember | recall | answer | extract
  route         text,                      -- recall question type
  items         int not null default 0,    -- facts written or returned
  tokens        int not null default 0,    -- memory tokens returned to the agent
  input_tokens  int not null default 0,    -- LLM tokens (answer / extract only)
  output_tokens int not null default 0,
  cost_usd      numeric(12, 6) not null default 0,
  latency_ms    int not null default 0,
  at            timestamptz not null default now()
);
create index usage_events_ws_at_idx on usage_events (workspace_id, at);

create index sources_ws_occurred_idx on sources (workspace_id, occurred_at desc);
create index facts_ws_recorded_idx on facts (workspace_id, recorded_at desc);

grant select, insert on usage_events to strata_app;
grant usage on all sequences in schema public to strata_app;
alter table usage_events enable row level security;
create policy ws_isolation on usage_events using (workspace_id = current_setting('app.workspace_id', true)::uuid);
