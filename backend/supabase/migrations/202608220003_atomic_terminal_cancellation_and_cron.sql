-- A terminal correlation transition and its proposal cancellation must commit
-- together. Keeping this in the correlation RPC removes the window in which
-- an operator could approve a proposal after a recovery/dispute was stored.
create or replace function public.payscope_persist_correlation(
  p_event_id uuid,
  p_organization_id uuid,
  p_incident jsonb,
  p_enqueue_investigation boolean,
  p_job_id uuid,
  p_job_payload jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  correlation_ids uuid[];
  terminal_reason text;
begin
  update public.payscope_events set processed_at = now()
  where id = p_event_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope event not found for correlation'; end if;

  if p_incident is not null then
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into correlation_ids
    from jsonb_array_elements_text(coalesce(p_incident->'correlated_event_ids', '[]'::jsonb));
    if cardinality(correlation_ids) = 0 then raise exception 'PayScope incident must reference at least one event'; end if;
    if exists (
      select 1
      from unnest(correlation_ids) as referenced_event(id)
      left join public.payscope_events e on e.id = referenced_event.id and e.organization_id = p_organization_id
      where e.id is null
    ) then raise exception 'PayScope incident references an event outside its organization'; end if;

    insert into public.payscope_incidents (
      id, organization_id, risk_tier, status, total_failed_amount_paise,
      recovered_amount_paise, correlated_event_ids, opened_at, resolved_at, updated_at
    ) values (
      (p_incident->>'id')::uuid, p_organization_id, p_incident->>'risk_tier',
      p_incident->>'status', (p_incident->>'total_failed_amount_paise')::integer,
      (p_incident->>'recovered_amount_paise')::integer,
      array(select jsonb_array_elements_text(p_incident->'correlated_event_ids')::uuid),
      (p_incident->>'opened_at')::timestamptz, nullif(p_incident->>'resolved_at', '')::timestamptz,
      (p_incident->>'updated_at')::timestamptz
    ) on conflict (id) do update set
      risk_tier = excluded.risk_tier,
      status = excluded.status,
      total_failed_amount_paise = excluded.total_failed_amount_paise,
      recovered_amount_paise = excluded.recovered_amount_paise,
      correlated_event_ids = excluded.correlated_event_ids,
      resolved_at = excluded.resolved_at,
      updated_at = excluded.updated_at
    where public.payscope_incidents.organization_id = p_organization_id;
    if not found then raise exception 'PayScope incident ID belongs to another organization'; end if;

    terminal_reason := case p_incident->>'status'
      when 'DISPUTE_OPENED' then 'dispute'
      when 'RESOLVED' then 'recovery'
      else null
    end;
    if terminal_reason is not null then
      perform public.payscope_cancel_pending_proposals(
        p_organization_id,
        (p_incident->>'id')::uuid,
        terminal_reason
      );
    end if;
  end if;

  if p_enqueue_investigation then
    if p_incident is null then raise exception 'PayScope investigation requires an incident'; end if;
    insert into public.payscope_queue_jobs (id, organization_id, job_key, job_type, payload)
    values (p_job_id, p_organization_id, 'investigate:' || (p_incident->>'id') || ':' || p_event_id::text, 'investigate_incident', p_job_payload)
    on conflict (job_key) do nothing;
  end if;
end;
$$;
revoke all on function public.payscope_persist_correlation(uuid, uuid, jsonb, boolean, uuid, jsonb) from public;
grant execute on function public.payscope_persist_correlation(uuid, uuid, jsonb, boolean, uuid, jsonb) to service_role;

-- Postgres only reclaims abandoned leases; the VPS QueueWorker remains the
-- sole component that calls Razorpay or a model provider.
create extension if not exists pg_cron;
select cron.schedule(
  'payscope-requeue-stale-locks',
  '* * * * *',
  $$select public.payscope_requeue_stale_jobs(30);$$
);
