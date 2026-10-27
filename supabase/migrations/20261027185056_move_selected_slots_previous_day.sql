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
  for entry in select start_time,category,note,subcategory from public.blocks
    where user_id=actor and date=source_day and expected ? start_time order by start_time for update loop
    found_count:=found_count+1;
    if jsonb_build_object('category',entry.category,'note',coalesce(entry.note,''),'sub',coalesce(entry.subcategory,'')) is distinct from expected->entry.start_time then
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
