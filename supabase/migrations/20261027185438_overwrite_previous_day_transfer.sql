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
    select jsonb_build_object('category',category,'note',coalesce(note,''),'sub',coalesce(subcategory,'')) into actual
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
