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

-- Row-level security: each logged-in user can only touch their OWN rows.
-- (user_id holds the authenticated user's id, i.e. auth.uid().)
alter table blocks enable row level security;

drop policy if exists "anon can do everything" on blocks;

create policy "own rows" on blocks
  for all to authenticated
  using ((auth.uid())::text = user_id)
  with check ((auth.uid())::text = user_id);
