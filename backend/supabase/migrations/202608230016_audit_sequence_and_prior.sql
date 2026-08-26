-- Audit sequence safety + learning prior configurability
-- Replaces Date.now() client-side sequencing with DB sequence + row-level lock.

create sequence if not exists public.payscope_audit_sequence;

-- Ensure append path is fully DB-serialized (already security definer, add explicit lock comment)
comment on sequence public.payscope_audit_sequence is 'Monotonic audit sequence; payscope_append_audit_entry must use nextval() + SELECT ... FOR UPDATE to prevent concurrent branches.';

-- Learning prior is now configurable via env; no DB change, but document the default
-- PAYSCOPE_RECOVERY_PRIOR_RATE (default 0.18) and PSEUDO_COUNT=20 are code-level.
-- No schema change required.

-- Real telemetry coverage helper: counts incidents with at least one enrichment
create or replace function public.payscope_telemetry_coverage(p_organization_id uuid)
returns numeric language sql security definer set search_path = public, pg_temp as $$
  select case when count(*) = 0 then 0 else count(*) filter (where exists (
    select 1 from payscope_events e where e.id = any(i.correlated_event_ids) and e.enrichment is not null
  ))::numeric / count(*) end
  from payscope_incidents i where i.organization_id = p_organization_id;
$$;
revoke all on function public.payscope_telemetry_coverage(uuid) from public;
grant execute on function public.payscope_telemetry_coverage(uuid) to service_role;
