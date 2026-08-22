-- Migration 009 adds a required source_event_id.  Existing database function
-- bodies retain their original SQL after an ALTER TABLE, so replace every
-- enqueue RPC in the same release train before accepting new webhook work.

create or replace function public.payscope_ingest_event_and_enqueue(
  p_event_id uuid,
  p_organization_id uuid,
  p_razorpay_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_normalized jsonb,
  p_job_id uuid,
  p_job_payload jsonb
) returns table(event_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inserted_event_id uuid;
begin
  insert into public.payscope_events (id, organization_id, razorpay_event_id, event_type, payload_hash, normalized)
  values (p_event_id, p_organization_id, p_razorpay_event_id, p_event_type, p_payload_hash, p_normalized)
  on conflict (organization_id, razorpay_event_id) do nothing
  returning id into inserted_event_id;
  if inserted_event_id is null then
    select id into event_id from public.payscope_events where organization_id = p_organization_id and razorpay_event_id = p_razorpay_event_id;
    duplicate := true;
    return next;
    return;
  end if;
  insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
  values (p_job_id, p_organization_id, p_event_id, 'enrich:' || p_event_id::text, 'enrich_event', p_job_payload)
  on conflict (job_key) do nothing;
  event_id := inserted_event_id;
  duplicate := false;
  return next;
end;
$$;
revoke all on function public.payscope_ingest_event_and_enqueue(uuid, uuid, text, text, text, jsonb, uuid, jsonb) from public;
grant execute on function public.payscope_ingest_event_and_enqueue(uuid, uuid, text, text, text, jsonb, uuid, jsonb) to service_role;

create or replace function public.payscope_complete_enrichment_and_enqueue(
  p_event_id uuid,
  p_organization_id uuid,
  p_enrichment jsonb,
  p_enrichment_source text,
  p_job_id uuid,
  p_job_payload jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  newly_enriched boolean := false;
begin
  update public.payscope_events
  set enrichment = p_enrichment, enrichment_source = p_enrichment_source, processed_at = null
  where id = p_event_id and organization_id = p_organization_id and enrichment_source is null;
  newly_enriched := found;

  if not newly_enriched and not exists (
    select 1 from public.payscope_events where id = p_event_id and organization_id = p_organization_id
  ) then
    raise exception 'PayScope event not found for enrichment';
  end if;

  insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
  values (p_job_id, p_organization_id, p_event_id, 'correlate:' || p_event_id::text, 'correlate_event', p_job_payload)
  on conflict (job_key) do nothing;

  if newly_enriched then
    perform public.payscope_append_audit_entry(
      p_organization_id, null, 'event_enriched', 'system', 'payscope-enrichment', null,
      case when p_enrichment_source = 'unavailable' then 'enrichment_unavailable' else 'enrichment_available' end,
      case when p_enrichment_source = 'unavailable' then 'Enrichment unavailable; incident continues to deterministic correlation and requires human review if investigated.' else 'Enrichment completed from the recorded source.' end,
      case when p_enrichment_source = 'unavailable' then 0.300 else null end,
      jsonb_build_object('event_id', p_event_id, 'source', p_enrichment_source, 'signals_used', coalesce(p_enrichment->'signalsUsed', '[]'::jsonb))
    );
  end if;
end;
$$;
revoke all on function public.payscope_complete_enrichment_and_enqueue(uuid, uuid, jsonb, text, uuid, jsonb) from public;
grant execute on function public.payscope_complete_enrichment_and_enqueue(uuid, uuid, jsonb, text, uuid, jsonb) to service_role;

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
    insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
    values (p_job_id, p_organization_id, p_event_id, 'investigate:' || (p_incident->>'id') || ':' || p_event_id::text, 'investigate_incident', p_job_payload)
    on conflict (job_key) do nothing;
  end if;
end;
$$;
revoke all on function public.payscope_persist_correlation(uuid, uuid, jsonb, boolean, uuid, jsonb) from public;
grant execute on function public.payscope_persist_correlation(uuid, uuid, jsonb, boolean, uuid, jsonb) to service_role;
