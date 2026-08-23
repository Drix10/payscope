-- Canonical autonomous MVP lifecycle. The worker records an action or a
-- terminal no-action; it never leaves an incident in a manual-work state.

alter table public.payscope_action_proposals
  add column if not exists simulated_at timestamptz;

-- Preserve the historical timestamp for existing simulation records without
-- exposing the retired approval fields through the MVP API.
update public.payscope_action_proposals
set simulated_at = approved_at
where status = 'simulated' and simulated_at is null and approved_at is not null;

do $$
declare legacy_incident record;
begin
  for legacy_incident in
    select id, organization_id, status from public.payscope_incidents
    where status in ('ESCALATED', 'HUMAN_RESOLVED')
    for update
  loop
    update public.payscope_incidents
    set status = case when legacy_incident.status = 'ESCALATED' then 'DISMISSED' else 'RESOLVED' end,
        resolved_at = case when legacy_incident.status = 'ESCALATED' then now() else coalesce(resolved_at, now()) end,
        updated_at = now()
    where id = legacy_incident.id and organization_id = legacy_incident.organization_id;
    perform public.payscope_append_audit_entry(
      legacy_incident.organization_id, legacy_incident.id, 'legacy_lifecycle_normalized',
      'system', 'payscope-autonomy-migration', null, 'legacy_state_normalized',
      'A retired lifecycle state was normalized to the autonomous MVP lifecycle.', null,
      jsonb_build_object('prior_status', legacy_incident.status)
    );
  end loop;
end;
$$;

alter table public.payscope_incidents drop constraint if exists payscope_incidents_status_check;
alter table public.payscope_incidents add constraint payscope_incidents_status_check
  check (status in ('OPEN', 'MONITORING', 'DISPUTE_OPENED', 'RESOLVED', 'DISMISSED'));
alter table public.payscope_action_proposals drop constraint if exists payscope_action_proposals_status_check;
alter table public.payscope_action_proposals add constraint payscope_action_proposals_status_check
  check (status in ('pending', 'simulated', 'cancelled_by_dispute', 'cancelled_by_recovery', 'failed'));

create or replace function public.payscope_record_investigation_failure(
  p_organization_id uuid,
  p_incident_id uuid,
  p_trigger_event_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.payscope_incidents
  set status = case when status = 'DISPUTE_OPENED' then status else 'DISMISSED' end,
      resolved_at = case when status = 'DISPUTE_OPENED' then resolved_at else now() end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation failure'; end if;
  insert into public.payscope_investigations (organization_id, incident_id, status, started_at, completed_at)
  values (p_organization_id, p_incident_id, 'FAILED', now(), now());
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'autonomous_no_action_recorded', 'system',
    'payscope-worker', null, 'investigation_unavailable', left(p_reason, 1000), null,
    jsonb_build_object('trigger_event_id', p_trigger_event_id)
  );
end;
$$;
revoke all on function public.payscope_record_investigation_failure(uuid, uuid, uuid, text) from public;
grant execute on function public.payscope_record_investigation_failure(uuid, uuid, uuid, text) to service_role;

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
  no_action_reason text;
begin
  if p_tokens_used < 0 or p_latency_ms < 0 then raise exception 'Invalid investigation telemetry'; end if;
  if jsonb_typeof(p_proposals) <> 'array' then raise exception 'Proposals must be a JSON array'; end if;
  policy_outcome := coalesce(p_policy_decision->>'outcome', 'auto_no_action');
  if policy_outcome not in ('auto_with_proposals', 'auto_no_action') then raise exception 'Invalid autonomous policy outcome'; end if;
  no_action_reason := nullif(left(coalesce(p_policy_decision->>'noActionReason', ''), 120), '');

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

  insert into public.payscope_investigations (organization_id, incident_id, status, plan, risk_analysis, recovery_plan, policy_decision, model_id, tokens_used, latency_ms, started_at, completed_at)
  values (p_organization_id, p_incident_id, 'COMPLETE', p_plan, p_risk_analysis, p_recovery_plan, p_policy_decision, left(p_model_id, 160), p_tokens_used, p_latency_ms, now(), now());
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'policy_decision_recorded', 'system', 'payscope-policy', null,
    policy_outcome, coalesce(no_action_reason, 'Deterministic policy permitted autonomous simulated actions.'),
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
      perform public.payscope_append_audit_entry(
        p_organization_id, p_incident_id, 'autonomous_action_queued', 'system', 'payscope-worker', null,
        'queued_for_autonomous_simulation', coalesce(proposal->>'rationale', 'Validated policy action queued for simulation.'),
        (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('proposal_id', proposal_id, 'action_type', proposal_action)
      );
    end loop;
  elsif jsonb_array_length(p_proposals) <> 0 then
    raise exception 'Proposals require auto_with_proposals policy outcome';
  else
    perform public.payscope_append_audit_entry(
      p_organization_id, p_incident_id, 'autonomous_no_action_recorded', 'system', 'payscope-policy', null,
      'no_action_terminalized', coalesce(no_action_reason, 'The deterministic policy allowed no autonomous action.'),
      (p_risk_analysis->>'confidence')::numeric, null
    );
  end if;
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'investigation_completed', 'system', 'payscope-worker', null,
    policy_outcome, coalesce(no_action_reason, 'Validated autonomous investigation completed.'),
    (p_risk_analysis->>'confidence')::numeric, null
  );
end;
$$;
revoke all on function public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) from public;
grant execute on function public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) to service_role;

create or replace function public.payscope_autonomously_simulate_pending_proposals(
  p_organization_id uuid,
  p_incident_id uuid
) returns setof public.payscope_action_proposals
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  proposal public.payscope_action_proposals;
  incident public.payscope_incidents;
  v_customer_hash text;
  incident_attempts integer;
  attempts_24h integer;
  attempts_7d integer;
  merchant_opted_in boolean;
begin
  if exists (select 1 from public.payscope_verify_audit_chain(p_organization_id) where not valid) then
    raise exception 'PayScope audit integrity is broken; autonomous simulation is blocked';
  end if;
  select * into incident from public.payscope_incidents where id = p_incident_id and organization_id = p_organization_id for update;
  if not found then raise exception 'PayScope incident was not found for autonomous simulation'; end if;
  for proposal in select * from public.payscope_action_proposals where organization_id = p_organization_id and incident_id = p_incident_id and status = 'pending' order by proposed_at, id for update loop
    if incident.status in ('DISPUTE_OPENED', 'RESOLVED', 'DISMISSED') then
      update public.payscope_action_proposals set status = case when incident.status = 'DISPUTE_OPENED' then 'cancelled_by_dispute' else 'cancelled_by_recovery' end where id = proposal.id returning * into proposal;
      perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'autonomous_action_cancelled', 'system', 'payscope-autonomy', null, 'terminal_incident', 'Autonomous simulation was cancelled because the incident is terminal.', null, jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type));
      return next proposal;
      continue;
    end if;
    if proposal.action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script') then
      select e.normalized->>'customerHash' into v_customer_hash from public.payscope_events e where e.organization_id = p_organization_id and e.id = any(incident.correlated_event_ids) and e.normalized ? 'customerHash' order by (e.normalized->>'occurredAt')::timestamptz desc, e.id desc limit 1;
      if v_customer_hash is null or v_customer_hash !~ '^[a-f0-9]{64}$' then
        update public.payscope_action_proposals set status = 'failed', delivery_result = jsonb_build_object('status', 'failed', 'reason', 'No customer hash for simulated outreach.') where id = proposal.id returning * into proposal;
        perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'autonomous_action_blocked', 'system', 'payscope-autonomy', null, 'missing_customer_reference', 'Autonomous outreach simulation was blocked because no tenant-scoped customer hash exists.', null, jsonb_build_object('proposal_id', proposal.id));
        return next proposal;
        continue;
      end if;
      perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_customer_hash, 0));
      select merchant_opted_in_to_recovery into merchant_opted_in from public.payscope_merchant_policies where organization_id = p_organization_id;
      select count(*) into incident_attempts from public.payscope_contact_attempts where organization_id = p_organization_id and incident_id = p_incident_id;
      select count(*) into attempts_24h from public.payscope_contact_attempts where organization_id = p_organization_id and customer_hash = v_customer_hash and attempted_at >= now() - interval '24 hours';
      select count(*) into attempts_7d from public.payscope_contact_attempts where organization_id = p_organization_id and customer_hash = v_customer_hash and attempted_at >= now() - interval '7 days';
      if not coalesce(merchant_opted_in, false) or incident_attempts >= 2 or attempts_24h >= 1 or attempts_7d >= 3 then
        update public.payscope_action_proposals set status = 'failed', delivery_result = jsonb_build_object('status', 'failed', 'reason', 'Autonomous stopping rule blocked simulated outreach.') where id = proposal.id returning * into proposal;
        perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'autonomous_action_blocked', 'system', 'payscope-autonomy', null, 'stopping_rule_blocked', 'Autonomous outreach simulation was blocked by merchant opt-in or contact limits.', null, jsonb_build_object('proposal_id', proposal.id));
        return next proposal;
        continue;
      end if;
      insert into public.payscope_contact_attempts (organization_id, customer_hash, incident_id) values (p_organization_id, v_customer_hash, p_incident_id);
    end if;
    update public.payscope_action_proposals
    set status = 'simulated', simulated_at = now(), approved_by = null,
        delivery_result = jsonb_build_object('status', 'simulated', 'note', 'PayScope autonomously recorded this action; no customer message was sent.', 'simulatedAt', now())
    where id = proposal.id returning * into proposal;
    perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'autonomous_action_simulated', 'system', 'payscope-autonomy', null, 'simulated_autonomously', 'A deterministic policy-permitted action was recorded automatically; no customer message was sent.', null, jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type));
    return next proposal;
  end loop;
end;
$$;
revoke all on function public.payscope_autonomously_simulate_pending_proposals(uuid, uuid) from public;
grant execute on function public.payscope_autonomously_simulate_pending_proposals(uuid, uuid) to service_role;

-- Pending records created by the retired workflow are resolved in the same
-- safe, idempotent path during migration. Each record is either simulated or
-- terminally blocked by the current contact and incident safeguards.
do $$
declare pending_incident record;
begin
  for pending_incident in
    select distinct organization_id, incident_id
    from public.payscope_action_proposals
    where status = 'pending'
  loop
    perform public.payscope_autonomously_simulate_pending_proposals(pending_incident.organization_id, pending_incident.incident_id);
  end loop;
end;
$$;

create or replace function public.payscope_dashboard_metrics(p_organization_id uuid)
returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with incident_totals as (
    select coalesce(sum(total_failed_amount_paise), 0)::numeric as total_at_risk
    from public.payscope_incidents where organization_id = p_organization_id
  ), proposal_totals as (
    select
      (count(*) filter (where action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script')))::numeric as generated,
      (count(*) filter (where action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script') and status = 'simulated' and simulated_at is not null))::numeric as simulated
    from public.payscope_action_proposals where organization_id = p_organization_id
  ), recovery_candidates as (
    select distinct on (event_id)
      p.id as proposal_id, p.incident_id, e.id as event_id,
      i.total_failed_amount_paise::numeric as incident_total_paise,
      (e.normalized->>'amountPaise')::numeric as captured_amount_paise,
      (e.normalized->>'occurredAt')::timestamptz as captured_at,
      p.simulated_at,
      case when e.normalized->'providerData'->>'payment_link_reference_id' = 'ps:' || p.id::text then 1 else 0 end as exact_reference
    from public.payscope_action_proposals p
    join public.payscope_incidents i on i.id = p.incident_id and i.organization_id = p.organization_id
    join public.payscope_events e on e.organization_id = p.organization_id and e.event_type = 'payment.captured'
    where p.organization_id = p_organization_id
      and p.action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script')
      and p.status = 'simulated' and p.simulated_at is not null
      and (e.normalized->>'amountPaise') ~ '^[0-9]+$'
      and (e.normalized->>'occurredAt')::timestamptz >= p.simulated_at
      and (e.normalized->>'occurredAt')::timestamptz <= p.simulated_at + interval '24 hours'
      and (e.id = any(i.correlated_event_ids) or e.normalized->'providerData'->>'payment_link_reference_id' = 'ps:' || p.id::text)
      and not exists (
        select 1 from public.payscope_events dispute where dispute.organization_id = p.organization_id and dispute.id = any(i.correlated_event_ids)
          and dispute.event_type in ('payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required')
          and (dispute.normalized->>'occurredAt')::timestamptz <= (e.normalized->>'occurredAt')::timestamptz
      )
    order by event_id, exact_reference desc, p.simulated_at desc, p.id
  ), bounded_recoveries as (
    select proposal_id, incident_id, event_id, least(captured_amount_paise, greatest(0::numeric, incident_total_paise - coalesce(sum(captured_amount_paise) over (partition by incident_id order by captured_at, event_id rows between unbounded preceding and 1 preceding), 0::numeric))) as recovered_paise
    from recovery_candidates
  ), attribution_totals as (
    select (count(*) filter (where recovered_paise > 0))::numeric as attributed_recoveries, coalesce(sum(recovered_paise) filter (where recovered_paise > 0), 0)::numeric as recovered_paise from bounded_recoveries
  ), latest_evaluation as (
    select * from public.payscope_evaluation_reports where organization_id = p_organization_id order by case split when 'held_out' then 0 else 1 end, run_at desc limit 1
  )
  select jsonb_build_object(
    'operations', jsonb_build_object(
      'totalAtRiskPaise', case when total_at_risk <= 9007199254740991 then total_at_risk else null end,
      'proposalsGenerated', case when generated <= 9007199254740991 then generated else null end,
      'proposalsSimulated', case when simulated <= 9007199254740991 then simulated else null end,
      'attributedRecoveries', case when attributed_recoveries <= 9007199254740991 then attributed_recoveries else null end,
      'recoveredPaise', case when recovered_paise <= 9007199254740991 then recovered_paise else null end,
      'recoveryRate', case when total_at_risk > 0 then recovered_paise / total_at_risk else null end,
      'contactToRecoveryRatio', case when attributed_recoveries > 0 then simulated / attributed_recoveries else null end
    ),
    'evaluation', case when latest_evaluation.id is null then jsonb_build_object('status', 'not_run', 'split', null, 'fixtureSetVersion', null, 'runAt', null, 'configurationHash', null, 'modelId', null, 'sampleCount', 0, 'precision', null, 'recall', null, 'f1', null, 'falsePositiveCostPaise', null)
      else jsonb_build_object('status', 'available', 'split', latest_evaluation.split, 'fixtureSetVersion', latest_evaluation.fixture_set_version, 'runAt', latest_evaluation.run_at, 'configurationHash', latest_evaluation.configuration_hash, 'modelId', latest_evaluation.model_id, 'sampleCount', latest_evaluation.sample_count, 'precision', latest_evaluation.precision, 'recall', latest_evaluation.recall, 'f1', latest_evaluation.f1, 'falsePositiveCostPaise', latest_evaluation.false_positive_cost_paise) end,
    'exceptions', jsonb_build_array(
      'No COD/RTO decisioning: shipping data is outside this MVP.',
      'Dispute-opened incidents are not eligible for recovery outreach.',
      'Fraud-confirmed incidents are automatically dismissed with no outreach.',
      'Incidents without a matching policy are automatically terminalized with no action.',
      'Communications are simulated; no customer message is sent.',
      'Recovery attribution requires a causal simulated-action record; no revenue is claimed without that evidence.',
      'Razorpay Live Mode and financial execution are out of scope.'
    )
  ) from incident_totals cross join proposal_totals cross join attribution_totals left join latest_evaluation on true
$$;
revoke all on function public.payscope_dashboard_metrics(uuid) from public;
grant execute on function public.payscope_dashboard_metrics(uuid) to service_role;
