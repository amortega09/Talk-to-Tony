-- Run this in Supabase → SQL Editor → New query → Run.
-- One row per 30-minute block. Structured for easy querying / LLM analysis.

create table if not exists blocks (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  date        date        not null,
  start_time  text        not null,          -- "HH:MM", e.g. "08:30"
  category    text        not null,
  note        text        default '',
  updated_at  timestamptz default now(),
  unique (user_id, date, start_time)
);

create index if not exists blocks_user_date_idx on blocks (user_id, date);

-- Personal single-user app: allow the anon key to read/write.
-- (Rows are namespaced by the device user_id.)
alter table blocks enable row level security;

create policy "anon can do everything" on blocks
  for all using (true) with check (true);
