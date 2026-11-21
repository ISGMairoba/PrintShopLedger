-- A shelf item sold as collected (Quick sale with Collected ticked, or any checkout of a shelf item)
-- went back to the first stage after the next sync. apply_checkout_event writes 'Collected' into the
-- job's metadata (productionStatus) but never sets the production_status column, which defaults to
-- 'Added', and the download (get_ledger) takes the column. So the device showed the sale as collected
-- until it synced, then at its first stage.
-- Fix: when a job is created, a shelf item whose metadata says Collected gets the Collected column
-- too. Done with a trigger, so every way of creating jobs is covered without rewriting
-- apply_checkout_event. Then the jobs still untouched since the sale are repaired (version 1: nobody
-- moved them by hand since; jobs staff already moved on are left as they are).

create or replace function private.shelf_collected_status() returns trigger
language plpgsql set search_path to '' as $f$
begin
  if coalesce((new.metadata->>'shelfItem')::boolean, false)
     and new.metadata->>'productionStatus' = 'Collected'
     and new.production_status = 'Added' then
    new.production_status := 'Collected';
  end if;
  return new;
end $f$;

drop trigger if exists shelf_collected_status on public.jobs;
create trigger shelf_collected_status before insert on public.jobs
  for each row execute function private.shelf_collected_status();

update public.jobs
   set production_status = 'Collected'
 where coalesce((metadata->>'shelfItem')::boolean, false)
   and metadata->>'productionStatus' = 'Collected'
   and production_status = 'Added'
   and version = 1;
