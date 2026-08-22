-- Queue payload is intentionally bounded JSON, but an event identifier held
-- only inside JSON cannot enforce lifecycle integrity.  Make the triggering
-- event a tenant-scoped foreign key so no enrich/correlate/investigate job can
-- outlive the event it operates on.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payscope_events_organization_id_id_key'
      and conrelid = 'public.payscope_events'::regclass
  ) then
    alter table public.payscope_events
      add constraint payscope_events_organization_id_id_key unique (organization_id, id);
  end if;
end;
$$;

alter table public.payscope_queue_jobs
  add column if not exists source_event_id uuid;

-- Every canonical queue payload carries either eventId or triggerEventId.
-- A UUID guard keeps a legacy malformed payload from aborting this migration.
update public.payscope_queue_jobs
set source_event_id = coalesce(payload->>'eventId', payload->>'triggerEventId')::uuid
where source_event_id is null
  and coalesce(payload->>'eventId', payload->>'triggerEventId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Remove only operational queue rows that cannot have a valid source event.
-- They are unrecoverable orphan work (including old integration fixtures),
-- not payment records; their audit entries and events remain untouched.
delete from public.payscope_queue_jobs jobs
where jobs.source_event_id is null
   or not exists (
     select 1 from public.payscope_events events
     where events.organization_id = jobs.organization_id
       and events.id = jobs.source_event_id
   );

alter table public.payscope_queue_jobs
  alter column source_event_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payscope_queue_jobs_source_event_fkey'
      and conrelid = 'public.payscope_queue_jobs'::regclass
  ) then
    alter table public.payscope_queue_jobs
      add constraint payscope_queue_jobs_source_event_fkey
      foreign key (organization_id, source_event_id)
      references public.payscope_events(organization_id, id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists payscope_queue_jobs_source_event_idx
  on public.payscope_queue_jobs (organization_id, source_event_id);

-- The normal one-argument call remains the VPS worker API.  The optional,
-- exact fixture ID is deliberately restricted to service_role and prevents
-- hosted integration checks from racing the live worker or claiming merchant
-- work while testing SKIP LOCKED semantics.
drop function if exists public.payscope_claim_queue_job(text);
create or replace function public.payscope_claim_queue_job(
  p_worker_id text,
  p_fixture_job_id uuid default null
)
returns setof public.payscope_queue_jobs
language sql security definer set search_path = public, pg_temp as $$
  with next_job as (
    select id from public.payscope_queue_jobs
    where status = 'pending'
      and next_attempt_at <= now()
      and (
        (p_fixture_job_id is null and coalesce((payload->>'testFixture')::boolean, false) = false)
        or (p_fixture_job_id is not null and id = p_fixture_job_id and coalesce((payload->>'testFixture')::boolean, false) = true)
      )
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.payscope_queue_jobs jobs
  set status = 'running', locked_at = now(), locked_by = p_worker_id, updated_at = now()
  from next_job
  where jobs.id = next_job.id
  returning jobs.*
$$;
revoke all on function public.payscope_claim_queue_job(text, uuid) from public;
grant execute on function public.payscope_claim_queue_job(text, uuid) to service_role;
