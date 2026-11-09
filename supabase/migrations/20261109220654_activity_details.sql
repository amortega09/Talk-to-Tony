-- Optional activity attributes; existing owner RLS and permissions continue to apply.
alter table public.blocks add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.blocks add constraint blocks_details_object check (jsonb_typeof(details)='object' and octet_length(details::text)<=4000);

create or replace function public.move_day_slots_previous_day(source_day date, expected jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare actor text := auth.uid()::text; entry record; found_count integer := 0; total integer;
begin
  if actor is null then raise exception 'Sign in to move entries'; end if;
  if jsonb_typeof(expected) is distinct from 'object' then raise exception 'Invalid selection'; end if;
  select count(*) into total from jsonb_object_keys(expected);
  if total<1 or total>48 or source_day is null then raise exception 'Select recorded time slots'; end if;
  for entry in select key,value from jsonb_each(expected) loop
    if entry.key !~ '^(0[0-9]|1[0-9]|2[0-3]):(00|30)$' then raise exception 'Invalid time slot'; end if;
  end loop;
  for entry in select start_time,category,note,subcategory,details from public.blocks
    where user_id=actor and date=source_day and expected ? start_time order by start_time for update loop
    found_count:=found_count+1;
    if (jsonb_build_object('category',entry.category,'note',coalesce(entry.note,''),'sub',coalesce(entry.subcategory,'')) || case when entry.details='{}'::jsonb then '{}'::jsonb else jsonb_build_object('details',entry.details) end) is distinct from expected->entry.start_time then
      raise exception 'An entry changed. Refresh and select it again';
    end if;
  end loop;
  if found_count<>total then raise exception 'An entry changed. Refresh and select it again'; end if;
  if exists(select 1 from public.blocks where user_id=actor and date=source_day-1 and expected ? start_time) then
    raise exception 'Yesterday already has entries at those times. Nothing moved';
  end if;
  update public.blocks set date=source_day-1,updated_at=clock_timestamp()
    where user_id=actor and date=source_day and expected ? start_time;
end $$;
revoke all on function public.move_day_slots_previous_day(date,jsonb) from public,anon;
grant execute on function public.move_day_slots_previous_day(date,jsonb) to authenticated;

create or replace function public.overwrite_day_slots_previous_day(source_day date, expected jsonb, destination_expected jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare actor text := auth.uid()::text; entry record; actual jsonb;
begin
  if actor is null then raise exception 'Sign in to move entries'; end if;
  if jsonb_typeof(expected) is distinct from 'object' or jsonb_typeof(destination_expected) is distinct from 'object' then raise exception 'Invalid selection'; end if;
  if (select count(*) from jsonb_object_keys(expected)) not between 1 and 48 then raise exception 'Invalid selection'; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(expected) key) is distinct from
     (select array_agg(key order by key) from jsonb_object_keys(destination_expected) key) then raise exception 'Invalid destination selection'; end if;
  for entry in select key,value from jsonb_each(destination_expected) order by key loop
    actual:=null;
    select jsonb_build_object('category',category,'note',coalesce(note,''),'sub',coalesce(subcategory,'')) || case when details='{}'::jsonb then '{}'::jsonb else jsonb_build_object('details',details) end into actual
      from public.blocks where user_id=actor and date=source_day-1 and start_time=entry.key for update;
    if coalesce(actual,'null'::jsonb) is distinct from entry.value then
      raise exception 'Yesterday changed since the preview. Try the move again to review it';
    end if;
  end loop;
  delete from public.blocks where user_id=actor and date=source_day-1 and expected ? start_time;
  perform public.move_day_slots_previous_day(source_day,expected);
end $$;
revoke all on function public.overwrite_day_slots_previous_day(date,jsonb,jsonb) from public,anon;
grant execute on function public.overwrite_day_slots_previous_day(date,jsonb,jsonb) to authenticated;

create or replace function public.capture_agent_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and row(old.user_id,old.date,old.start_time,old.category,old.note,old.subcategory,old.details) is not distinct from row(new.user_id,new.date,new.start_time,new.category,new.note,new.subcategory,new.details) then return null; end if;
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
