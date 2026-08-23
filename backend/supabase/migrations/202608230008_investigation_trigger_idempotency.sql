-- A queue retry must resume a persisted investigation instead of generating a
-- second decision/proposal set for the same triggering provider event.

alter table public.payscope_investigations
  add column if not exists trigger_event_id uuid references public.payscope_events(id) on delete set null;

create unique index if not exists payscope_investigations_trigger_event_unique
  on public.payscope_investigations (organization_id, incident_id, trigger_event_id)
  where trigger_event_id is not null;

drop function if exists public.payscope_record_investigation_failure(uuid, uuid, uuid, text);
create function public.payscope_record_investigation_failure(
  p_organization_id uuid,
  p_incident_id uuid,
  p_trigger_event_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare persisted_investigation_id uuid;
begin
  if p_trigger_event_id is null then raise exception 'PayScope investigation failure requires a trigger event'; end if;
  if not exists (select 1 from public.payscope_events where id = p_trigger_event_id and organization_id = p_organization_id) then
    raise exception 'PayScope investigation failure trigger event is outside the organization';
  end if;
  insert into public.payscope_investigations (organization_id, incident_id, trigger_event_id, status, started_at, completed_at)
  values (p_organization_id, p_incident_id, p_trigger_event_id, 'FAILED', now(), now())
  on conflict (organization_id, incident_id, trigger_event_id) where trigger_event_id is not null do nothing
  returning id into persisted_investigation_id;
  if persisted_investigation_id is null then return; end if;

  update public.payscope_incidents
  set status = case when status = 'DISPUTE_OPENED' then status else 'DISMISSED' end,
      resolved_at = case when status = 'DISPUTE_OPENED' then resolved_at else now() end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation failure'; end if;

  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'autonomous_no_action_recorded', 'system',
    'payscope-worker', null, 'investigation_unavailable', left(p_reason, 1000), null,
    jsonb_build_object('trigger_event_id', p_trigger_event_id)
  );
end;
$$;
revoke all on function public.payscope_record_investigation_failure(uuid, uuid, uuid, text) from public;
grant execute on function public.payscope_record_investigation_failure(uuid, uuid, uuid, text) to service_role;

drop function if exists public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer);
create function public.payscope_persist_investigation_with_proposals(
  p_organization_id uuid,
  p_incident_id uuid,
  p_trigger_event_id uuid,
  p_plan jsonb,
  p_risk_analysis jsonb,
  p_recovery_plan jsonb,
  p_policy_decision jsonb,
  p_proposals jsonb,
  p_model_id text,
  p_tokens_used integer,
  p_latency_ms integer
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  proposal jsonb;
  proposal_id uuid;
  proposal_action text;
  policy_outcome text;
  no_action_reason text;
  persisted_investigation_id uuid;
begin
  if p_trigger_event_id is null then raise exception 'PayScope investigation requires a trigger event'; end if;
  if not exists (select 1 from public.payscope_events where id = p_trigger_event_id and organization_id = p_organization_id) then
    raise exception 'PayScope investigation trigger event is outside the organization';
  end if;
  if p_tokens_used < 0 or p_latency_ms < 0 then raise exception 'Invalid investigation telemetry'; end if;
  if jsonb_typeof(p_proposals) <> 'array' then raise exception 'Proposals must be a JSON array'; end if;
  policy_outcome := coalesce(p_policy_decision->>'outcome', 'auto_no_action');
  if policy_outcome not in ('auto_with_proposals', 'auto_no_action') then raise exception 'Invalid autonomous policy outcome'; end if;
  no_action_reason := nullif(left(coalesce(p_policy_decision->>'noActionReason', ''), 120), '');

  insert into public.payscope_investigations (
    organization_id, incident_id, trigger_event_id, status, plan, risk_analysis,
    recovery_plan, policy_decision, model_id, tokens_used, latency_ms, started_at, completed_at
  ) values (
    p_organization_id, p_incident_id, p_trigger_event_id, 'COMPLETE', p_plan,
    p_risk_analysis, p_recovery_plan, p_policy_decision, left(p_model_id, 160),
    p_tokens_used, p_latency_ms, now(), now()
  ) on conflict (organization_id, incident_id, trigger_event_id) where trigger_event_id is not null do nothing
  returning id into persisted_investigation_id;
  if persisted_investigation_id is null then return; end if;

  update public.payscope_incidents
  set status = case
        when status = 'DISPUTE_OPENED' then status
        when policy_outcome = 'auto_no_action' then 'DISMISSED'
        else status
      end,
      resolved_at = case
        when status = 'DISPUTE_OPENED' then resolved_at
        when policy_outcome = 'auto_no_action' then now()
        else resolved_at
      end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation'; end if;

  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'policy_decision_recorded', 'system', 'payscope-policy', null,
    policy_outcome, coalesce(no_action_reason, 'Deterministic policy permitted autonomous simulated actions.'),
    (p_risk_analysis->>'confidence')::numeric,
    jsonb_build_object('trigger_event_id', p_trigger_event_id, 'matched_policy_id', p_policy_decision->>'matchedPolicyId', 'permitted_action_count', jsonb_array_length(coalesce(p_policy_decision->'permittedActions', '[]'::jsonb)))
  );

  if policy_outcome = 'auto_with_proposals' then
    for proposal in select value from jsonb_array_elements(p_proposals) loop
      proposal_id := (proposal->>'id')::uuid;
      proposal_action := proposal->>'action_type';
      if proposal_id is null or proposal_action is null or proposal_action not in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script', 'merchant_email_notification', 'merchant_webhook_notification', 'flag_for_review', 'prepare_chargeback_evidence', 'auto_resolve_infrastructure') then raise exception 'Invalid proposal payload'; end if;
      insert into public.payscope_action_proposals (id, organization_id, incident_id, action_type, content)
      values (proposal_id, p_organization_id, p_incident_id, proposal_action, coalesce(proposal->'content', '{}'::jsonb));
      perform public.payscope_append_audit_entry(
        p_organization_id, p_incident_id, 'autonomous_action_queued', 'system', 'payscope-worker', null,
        'queued_for_autonomous_simulation', coalesce(proposal->>'rationale', 'Validated policy action queued for simulation.'),
        (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('proposal_id', proposal_id, 'action_type', proposal_action, 'trigger_event_id', p_trigger_event_id)
      );
    end loop;
  elsif jsonb_array_length(p_proposals) <> 0 then
    raise exception 'Proposals require auto_with_proposals policy outcome';
  else
    perform public.payscope_append_audit_entry(
      p_organization_id, p_incident_id, 'autonomous_no_action_recorded', 'system', 'payscope-policy', null,
      'no_action_terminalized', coalesce(no_action_reason, 'The deterministic policy allowed no autonomous action.'),
      (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('trigger_event_id', p_trigger_event_id)
    );
  end if;
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'investigation_completed', 'system', 'payscope-worker', null,
    policy_outcome, coalesce(no_action_reason, 'Validated autonomous investigation completed.'),
    (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('trigger_event_id', p_trigger_event_id)
  );
end;
$$;
revoke all on function public.payscope_persist_investigation_with_proposals(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) from public;
grant execute on function public.payscope_persist_investigation_with_proposals(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) to service_role;
