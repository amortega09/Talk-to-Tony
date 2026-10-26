-- Additive, disabled by default. Configure owner/password separately with admin access.
-- The existing application's policies and block representation are unchanged.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'day_telegram') then
    create role day_telegram nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  elsif exists (select 1 from pg_roles where rolname='day_telegram' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)) then
    raise exception 'Existing day_telegram role has unsafe privileges';
  end if;
end $$;

do $$ begin
  if exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='day_telegram')) then
    raise exception 'day_telegram must not be a member of another role';
  end if;
  if not exists(select 1 from pg_class where oid='public.blocks'::regclass and relrowsecurity) then
    raise exception 'Enable and verify blocks RLS before installing the bot';
  end if;
end $$;

create schema day_bot;
revoke all on schema day_bot from public, anon, authenticated;
grant usage on schema day_bot, public to day_telegram;

create table day_bot.role_owners (
  role_name name primary key,
  owner text not null unique,
  writes_enabled boolean not null default false
);
alter table day_bot.role_owners enable row level security;
create policy own_role on day_bot.role_owners for select to day_telegram using (role_name = current_user);
grant select on day_bot.role_owners to day_telegram;

create table day_bot.links (
  hash text primary key,
  owner text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create table day_bot.connections (
  id uuid primary key,
  owner text not null unique,
  telegram_user bigint not null,
  chat_id bigint not null unique,
  active boolean not null default true,
  generation integer not null default 1,
  lease_job uuid,
  lease_token uuid,
  lease_until timestamptz,
  last_message_id bigint not null default 0,
  created_at timestamptz not null default now()
);
create table day_bot.jobs (
  id uuid primary key,
  owner text not null,
  connection uuid not null references day_bot.connections(id),
  generation integer not null,
  bot_id text not null,
  update_id bigint not null,
  message_id bigint not null,
  input jsonb not null,
  transcript text,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  error_code text,
  retry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(bot_id, update_id)
);
create index jobs_pending on day_bot.jobs(connection, message_id, created_at) where status in ('pending','processing');
create table day_bot.drafts (
  id uuid primary key,
  owner text not null,
  connection uuid not null references day_bot.connections(id),
  generation integer not null,
  status text not null default 'pending' check (status in ('pending','superseded','cancelled','saved','expired')),
  data jsonb not null,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);
create unique index one_pending_draft on day_bot.drafts(connection) where status = 'pending';
create table day_bot.receipts (
  id uuid primary key references day_bot.drafts(id),
  owner text not null,
  connection uuid not null references day_bot.connections(id),
  patches jsonb not null,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);
create table day_bot.outbox (
  id uuid primary key,
  ordinal bigint generated always as identity unique,
  owner text not null,
  connection uuid not null references day_bot.connections(id),
  generation integer not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  message_id bigint,
  delivered_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index outbox_pending on day_bot.outbox(created_at) where delivered_at is null;
grant usage on sequence day_bot.outbox_ordinal_seq to day_telegram;
create table day_bot.usage (
  owner text not null,
  day date not null,
  requests integer not null default 0,
  audio_seconds integer not null default 0,
  primary key (owner, day)
);

do $$ declare t text; begin
  foreach t in array array['links','connections','jobs','drafts','receipts','outbox','usage'] loop
    execute format('alter table day_bot.%I enable row level security', t);
    execute format('create policy bot_owner on day_bot.%I for all to day_telegram using (owner = (select owner from day_bot.role_owners where role_name = current_user)) with check (owner = (select owner from day_bot.role_owners where role_name = current_user))', t);
    execute format('grant select, insert, update, delete on day_bot.%I to day_telegram', t);
  end loop;
end $$;

-- Only the bot's role receives this policy. Browser authorization is untouched.
grant select, insert, update, delete on public.blocks to day_telegram;
grant usage on sequence public.blocks_id_seq to day_telegram;
create policy telegram_owner on public.blocks for all to day_telegram
  using (user_id = (select owner from day_bot.role_owners where role_name = current_user))
  with check (user_id = (select owner from day_bot.role_owners where role_name = current_user));

-- No new public RPCs and no SECURITY DEFINER routines. Runtime transactions use
-- the scoped login role; role_owners and writes_enabled remain administrator-only.
