-- Metadata-only reconciliation queue. Source contents are never copied here.
create table public.agent_change_events (
 id bigint generated always as identity primary key,
 user_id text not null,
 date date not null,
 slot text not null,
 operation text not null check(operation in ('INSERT','UPDATE','DELETE')),
 created_at timestamptz not null default now()
);
revoke all on public.agent_change_events from public,anon,authenticated;
revoke all on sequence public.agent_change_events_id_seq from public,anon,authenticated;
alter table public.agent_change_events enable row level security;
create index agent_change_events_owner_id on public.agent_change_events(user_id,id);
create policy own_change_insert on public.agent_change_events for insert to authenticated with check(user_id=(select auth.uid())::text);
create policy scoped_change_insert on public.agent_change_events for insert to day_telegram with check(user_id=(select owner from day_bot.role_owners where role_name=current_user));
create policy scoped_change_read on public.agent_change_events for select to day_telegram using(user_id=(select owner from day_bot.role_owners where role_name=current_user));
create policy scoped_change_delete on public.agent_change_events for delete to day_telegram using(user_id=(select owner from day_bot.role_owners where role_name=current_user));
grant insert on public.agent_change_events to authenticated;
grant select,insert,delete on public.agent_change_events to day_telegram;
grant usage on sequence public.agent_change_events_id_seq to authenticated,day_telegram;
create function public.capture_agent_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and row(old.user_id,old.date,old.start_time,old.category,old.note,old.subcategory) is not distinct from row(new.user_id,new.date,new.start_time,new.category,new.note,new.subcategory) then return null; end if;
 if tg_op<>'INSERT' and old.category not in ('agent_memory','agent_commitment','agent_history','agent_selection','agent_preferences') then
   insert into public.agent_change_events(user_id,date,slot,operation) values(old.user_id,old.date,old.start_time,tg_op);
 end if;
 if tg_op='INSERT' or (tg_op='UPDATE' and row(old.user_id,old.date,old.start_time) is distinct from row(new.user_id,new.date,new.start_time)) then
   if new.category not in ('agent_memory','agent_commitment','agent_history','agent_selection','agent_preferences') then
     insert into public.agent_change_events(user_id,date,slot,operation) values(new.user_id,new.date,new.start_time,tg_op);
   end if;
 end if;
 return null;
end $$;
revoke all on function public.capture_agent_change() from public,anon,authenticated;
create trigger capture_agent_change after insert or update or delete on public.blocks for each row execute function public.capture_agent_change();
