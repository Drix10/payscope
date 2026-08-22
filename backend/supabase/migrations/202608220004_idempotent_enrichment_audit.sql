-- Completion is retry-safe: after the event carries a source, another lease
-- replay only ensures its existing correlation job remains deduplicated.
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

  insert into public.payscope_queue_jobs (id, organization_id, job_key, job_type, payload)
  values (p_job_id, p_organization_id, 'correlate:' || p_event_id::text, 'correlate_event', p_job_payload)
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
