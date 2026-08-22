-- Complete the audit trace without introducing a second, mutable lifecycle
-- path. All entries are appended from the existing atomic RPC transactions.

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
    select id into event_id from public.payscope_events
    where organization_id = p_organization_id and razorpay_event_id = p_razorpay_event_id;
    duplicate := true;
    return next;
    return;
  end if;
  insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
  values (p_job_id, p_organization_id, p_event_id, 'enrich:' || p_event_id::text, 'enrich_event', p_job_payload)
  on conflict (job_key) do nothing;
  perform public.payscope_append_audit_entry(
    p_organization_id, null, 'event_received', 'system', 'payscope-webhook', null,
    'signed_test_mode_event_accepted', 'Signed in-scope Razorpay Test Mode event accepted for durable processing.', null,
    jsonb_build_object('event_id', p_event_id, 'event_type', p_event_type)
  );
  event_id := inserted_event_id;
  duplicate := false;
  return next;
end;
$$;
revoke all on function public.payscope_ingest_event_and_enqueue(uuid, uuid, text, text, text, jsonb, uuid, jsonb) from public;
grant execute on function public.payscope_ingest_event_and_enqueue(uuid, uuid, text, text, text, jsonb, uuid, jsonb) to service_role;

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
  prior_status text;
  prior_risk_tier text;
  prior_recovered_amount integer;
  transition_event_type text;
  transition_decision text;
begin
  update public.payscope_events set processed_at = now()
  where id = p_event_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope event not found for correlation'; end if;

  if p_incident is not null then
    select status, risk_tier, recovered_amount_paise into prior_status, prior_risk_tier, prior_recovered_amount
    from public.payscope_incidents where id = (p_incident->>'id')::uuid and organization_id = p_organization_id;
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into correlation_ids
    from jsonb_array_elements_text(coalesce(p_incident->'correlated_event_ids', '[]'::jsonb));
    if cardinality(correlation_ids) = 0 then raise exception 'PayScope incident must reference at least one event'; end if;
    if exists (
      select 1 from unnest(correlation_ids) as referenced_event(id)
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
      risk_tier = excluded.risk_tier, status = excluded.status,
      total_failed_amount_paise = excluded.total_failed_amount_paise,
      recovered_amount_paise = excluded.recovered_amount_paise,
      correlated_event_ids = excluded.correlated_event_ids,
      resolved_at = excluded.resolved_at, updated_at = excluded.updated_at
    where public.payscope_incidents.organization_id = p_organization_id;
    if not found then raise exception 'PayScope incident ID belongs to another organization'; end if;

    transition_event_type := case
      when prior_status is null then 'incident_opened'
      when p_incident->>'status' = 'HUMAN_RESOLVED' and prior_status is distinct from 'HUMAN_RESOLVED' then 'human_resolution_recorded'
      when prior_status is distinct from p_incident->>'status'
        or prior_risk_tier is distinct from p_incident->>'risk_tier'
        or prior_recovered_amount is distinct from (p_incident->>'recovered_amount_paise')::integer then 'correlation_transition'
      else null
    end;
    if transition_event_type is not null then
      transition_decision := case transition_event_type
        when 'incident_opened' then 'incident_opened_from_correlated_event'
        when 'human_resolution_recorded' then 'human_resolution_recorded'
        else 'incident_state_transition'
      end;
      perform public.payscope_append_audit_entry(
        p_organization_id, (p_incident->>'id')::uuid, transition_event_type, 'system', 'payscope-correlation', null,
        transition_decision, 'Correlation state persisted from tenant-scoped normalized events.', null,
        jsonb_build_object('trigger_event_id', p_event_id, 'status', p_incident->>'status', 'risk_tier', p_incident->>'risk_tier', 'recovered_amount_paise', p_incident->>'recovered_amount_paise')
      );
    end if;

    terminal_reason := case p_incident->>'status'
      when 'DISPUTE_OPENED' then 'dispute'
      when 'RESOLVED' then 'recovery'
      else null
    end;
    if terminal_reason is not null then
      perform public.payscope_cancel_pending_proposals(p_organization_id, (p_incident->>'id')::uuid, terminal_reason);
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

create or replace function public.payscope_persist_investigation_with_proposals(
  p_organization_id uuid, p_incident_id uuid, p_plan jsonb, p_risk_analysis jsonb,
  p_recovery_plan jsonb, p_policy_decision jsonb, p_proposals jsonb, p_model_id text,
  p_tokens_used integer, p_latency_ms integer
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  proposal jsonb;
  proposal_id uuid;
  proposal_action text;
  policy_outcome text;
begin
  if p_tokens_used < 0 or p_latency_ms < 0 then raise exception 'Invalid investigation telemetry'; end if;
  if jsonb_typeof(p_proposals) <> 'array' then raise exception 'Proposals must be a JSON array'; end if;
  policy_outcome := coalesce(p_policy_decision->>'outcome', 'escalate');
  update public.payscope_incidents
  set status = case when status = 'DISPUTE_OPENED' then status when policy_outcome = 'escalate' then 'ESCALATED' else status end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation'; end if;
  insert into public.payscope_investigations (organization_id, incident_id, status, plan, risk_analysis, recovery_plan, policy_decision, model_id, tokens_used, latency_ms, started_at, completed_at)
  values (p_organization_id, p_incident_id, 'COMPLETE', p_plan, p_risk_analysis, p_recovery_plan, p_policy_decision, left(p_model_id, 160), p_tokens_used, p_latency_ms, now(), now());
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'policy_decision_recorded', 'system', 'payscope-policy', null,
    policy_outcome, coalesce(p_policy_decision->>'escalationReason', 'Deterministic policy evaluated the validated investigation.'),
    (p_risk_analysis->>'confidence')::numeric,
    jsonb_build_object('matched_policy_id', p_policy_decision->>'matchedPolicyId', 'permitted_action_count', jsonb_array_length(coalesce(p_policy_decision->'permittedActions', '[]'::jsonb)))
  );
  if policy_outcome = 'auto_with_proposals' then
    for proposal in select value from jsonb_array_elements(p_proposals) loop
      proposal_id := (proposal->>'id')::uuid;
      proposal_action := proposal->>'action_type';
      if proposal_id is null or proposal_action is null or proposal_action not in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script', 'merchant_email_notification', 'merchant_webhook_notification', 'flag_for_review', 'prepare_chargeback_evidence', 'auto_resolve_infrastructure') then raise exception 'Invalid proposal payload'; end if;
      insert into public.payscope_action_proposals (id, organization_id, incident_id, action_type, content)
      values (proposal_id, p_organization_id, p_incident_id, proposal_action, coalesce(proposal->'content', '{}'::jsonb));
      perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'proposal_created', 'system', 'payscope-worker', null, 'proposal_pending', coalesce(proposal->>'rationale', 'Validated policy proposal created.'), (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('proposal_id', proposal_id, 'action_type', proposal_action));
    end loop;
  elsif jsonb_array_length(p_proposals) <> 0 then
    raise exception 'Proposals require auto_with_proposals policy outcome';
  end if;
  if policy_outcome = 'escalate' then
    perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'incident_escalated', 'system', 'payscope-policy', null, 'escalated_for_human_review', coalesce(p_policy_decision->>'escalationReason', 'Deterministic policy escalated the incident.'), (p_risk_analysis->>'confidence')::numeric, null);
  end if;
  perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'investigation_completed', 'system', 'payscope-worker', null, policy_outcome, coalesce(p_policy_decision->>'escalationReason', 'Validated investigation completed.'), (p_risk_analysis->>'confidence')::numeric, null);
end;
$$;
revoke all on function public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) from public;
grant execute on function public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) to service_role;
