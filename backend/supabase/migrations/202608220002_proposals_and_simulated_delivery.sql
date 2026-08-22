-- Durable, proposal-only operations. This migration deliberately has no
-- customer-contact integration: approval can only record a simulated result.

create table if not exists public.payscope_merchant_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.payscope_organizations(id) on delete cascade,
  enabled boolean not null default true,
  minimum_confidence numeric(4,3) not null default 0.800 check (minimum_confidence >= 0 and minimum_confidence <= 1),
  root_causes text[] not null default array['gateway_degraded']::text[] check (cardinality(root_causes) between 1 and 7),
  allowed_actions text[] not null default array['auto_resolve_infrastructure', 'flag_for_review']::text[] check (cardinality(allowed_actions) between 1 and 8),
  merchant_opted_in_to_recovery boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payscope_merchant_policies_org_idx on public.payscope_merchant_policies (organization_id);

alter table public.payscope_merchant_policies enable row level security;
create policy payscope_merchant_policies_isolation on public.payscope_merchant_policies for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());

create or replace function public.payscope_create_default_merchant_policy()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.payscope_merchant_policies (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;
drop trigger if exists payscope_organization_default_policy on public.payscope_organizations;
create trigger payscope_organization_default_policy after insert on public.payscope_organizations for each row execute function public.payscope_create_default_merchant_policy();
insert into public.payscope_merchant_policies (organization_id)
select id from public.payscope_organizations on conflict (organization_id) do nothing;

create or replace function public.payscope_policy_context(
  p_organization_id uuid,
  p_incident_id uuid,
  p_customer_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  policy_row public.payscope_merchant_policies;
  daily_incidents integer := 0;
  daily_auto_resolved integer := 0;
  daily_human_review integer := 0;
  incident_attempts integer := 0;
  attempts_24h integer := 0;
  attempts_7d integer := 0;
begin
  select * into policy_row from public.payscope_merchant_policies where organization_id = p_organization_id;
  if not found then raise exception 'PayScope merchant policy was not found'; end if;
  perform 1 from public.payscope_incidents where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident was not found for policy context'; end if;
  select count(*) into daily_incidents from public.payscope_incidents
  where organization_id = p_organization_id and opened_at >= date_trunc('day', now());
  select count(*) into daily_auto_resolved from public.payscope_audit_entries
  where organization_id = p_organization_id and created_at >= date_trunc('day', now()) and decision in ('auto_with_proposals', 'auto_no_action');
  select count(*) into daily_human_review from public.payscope_incidents
  where organization_id = p_organization_id and opened_at >= date_trunc('day', now()) and status in ('ESCALATED', 'HUMAN_RESOLVED');
  if p_customer_hash is not null then
    select count(*) into incident_attempts from public.payscope_contact_attempts
    where organization_id = p_organization_id and incident_id = p_incident_id;
    select count(*) into attempts_24h from public.payscope_contact_attempts
    where organization_id = p_organization_id and customer_hash = p_customer_hash and attempted_at >= now() - interval '24 hours';
    select count(*) into attempts_7d from public.payscope_contact_attempts
    where organization_id = p_organization_id and customer_hash = p_customer_hash and attempted_at >= now() - interval '7 days';
  end if;
  return jsonb_build_object(
    'policy', jsonb_build_object('id', policy_row.id, 'enabled', policy_row.enabled, 'minimumConfidence', policy_row.minimum_confidence, 'rootCauses', policy_row.root_causes, 'allowedActions', policy_row.allowed_actions, 'merchantOptedIn', policy_row.merchant_opted_in_to_recovery),
    'stats', jsonb_build_object('autoResolveFraction', case when daily_incidents = 0 then 0 else least(1, daily_auto_resolved::numeric / daily_incidents) end, 'humanReviewFraction', case when daily_incidents = 0 then 0 else least(1, daily_human_review::numeric / daily_incidents) end),
    'contact', jsonb_build_object('incidentAttempts', incident_attempts, 'attemptsLast24Hours', attempts_24h, 'attemptsLast7Days', attempts_7d, 'merchantOptedIn', policy_row.merchant_opted_in_to_recovery)
  );
end;
$$;
revoke all on function public.payscope_policy_context(uuid, uuid, text) from public;
grant execute on function public.payscope_policy_context(uuid, uuid, text) to service_role;

create or replace function public.payscope_persist_investigation_with_proposals(
  p_organization_id uuid,
  p_incident_id uuid,
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
begin
  if p_tokens_used < 0 or p_latency_ms < 0 then raise exception 'Invalid investigation telemetry'; end if;
  if jsonb_typeof(p_proposals) <> 'array' then raise exception 'Proposals must be a JSON array'; end if;
  update public.payscope_incidents
  set status = case when status = 'DISPUTE_OPENED' then status when p_policy_decision->>'outcome' = 'escalate' then 'ESCALATED' else status end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation'; end if;
  insert into public.payscope_investigations (organization_id, incident_id, status, plan, risk_analysis, recovery_plan, policy_decision, model_id, tokens_used, latency_ms, started_at, completed_at)
  values (p_organization_id, p_incident_id, 'COMPLETE', p_plan, p_risk_analysis, p_recovery_plan, p_policy_decision, left(p_model_id, 160), p_tokens_used, p_latency_ms, now(), now());
  if p_policy_decision->>'outcome' = 'auto_with_proposals' then
    for proposal in select value from jsonb_array_elements(p_proposals) loop
      proposal_id := (proposal->>'id')::uuid;
      proposal_action := proposal->>'action_type';
      if proposal_id is null or proposal_action not in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script', 'merchant_email_notification', 'merchant_webhook_notification', 'flag_for_review', 'prepare_chargeback_evidence', 'auto_resolve_infrastructure') then
        raise exception 'Invalid proposal payload';
      end if;
      insert into public.payscope_action_proposals (id, organization_id, incident_id, action_type, content)
      values (proposal_id, p_organization_id, p_incident_id, proposal_action, coalesce(proposal->'content', '{}'::jsonb));
      perform public.payscope_append_audit_entry(
        p_organization_id, p_incident_id, 'proposal_created', 'system', 'payscope-worker', null,
        'proposal_pending', coalesce(proposal->>'rationale', 'Validated policy proposal created.'),
        (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('proposal_id', proposal_id, 'action_type', proposal_action)
      );
    end loop;
  elsif jsonb_array_length(p_proposals) <> 0 then
    raise exception 'Proposals require auto_with_proposals policy outcome';
  end if;
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'investigation_completed', 'system', 'payscope-worker', null,
    coalesce(p_policy_decision->>'outcome', 'escalate'),
    coalesce(p_policy_decision->>'escalationReason', 'Validated investigation completed.'),
    (p_risk_analysis->>'confidence')::numeric, null
  );
end;
$$;
revoke all on function public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) from public;
grant execute on function public.payscope_persist_investigation_with_proposals(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) to service_role;

create or replace function public.payscope_approve_proposal(
  p_organization_id uuid,
  p_proposal_id uuid,
  p_actor_id text,
  p_actor_session_hash text,
  p_delivery_result jsonb
) returns public.payscope_action_proposals
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  proposal public.payscope_action_proposals;
  incident_status text;
begin
  select p.* into proposal
  from public.payscope_action_proposals p
  where p.id = p_proposal_id and p.organization_id = p_organization_id
  for update;
  if not found then raise exception 'PayScope proposal was not found'; end if;
  select status into incident_status from public.payscope_incidents
  where id = proposal.incident_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'PayScope proposal incident was not found'; end if;
  if proposal.status <> 'pending' then raise exception 'PayScope proposal is no longer pending'; end if;
  if incident_status in ('DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED') then raise exception 'PayScope proposal cannot be approved for a terminal incident'; end if;
  if coalesce(p_delivery_result->>'status', '') <> 'simulated' then raise exception 'PayScope MVP permits simulated delivery only'; end if;
  update public.payscope_action_proposals
  set status = 'simulated', approved_at = now(), delivery_result = p_delivery_result
  where id = proposal.id
  returning * into proposal;
  perform public.payscope_append_audit_entry(
    p_organization_id, proposal.incident_id, 'proposal_approved', 'human', left(p_actor_id, 160), p_actor_session_hash,
    'approved_for_simulation', 'Operator approved a proposal for simulated-only delivery.', null,
    jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type)
  );
  perform public.payscope_append_audit_entry(
    p_organization_id, proposal.incident_id, 'simulated_delivery_recorded', 'system', 'logging-communications-adapter', null,
    'delivered_simulated', 'No customer message was sent. Delivery is an MVP simulation.', null,
    jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type)
  );
  return proposal;
end;
$$;
revoke all on function public.payscope_approve_proposal(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.payscope_approve_proposal(uuid, uuid, text, text, jsonb) to service_role;

create or replace function public.payscope_cancel_pending_proposals(
  p_organization_id uuid,
  p_incident_id uuid,
  p_reason text
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cancelled_count integer;
  cancellation_status text;
begin
  if p_reason not in ('dispute', 'recovery') then raise exception 'Invalid PayScope proposal cancellation reason'; end if;
  cancellation_status := case when p_reason = 'dispute' then 'cancelled_by_dispute' else 'cancelled_by_recovery' end;
  update public.payscope_action_proposals set status = cancellation_status
  where organization_id = p_organization_id and incident_id = p_incident_id and status = 'pending';
  get diagnostics cancelled_count = row_count;
  if cancelled_count > 0 then
    perform public.payscope_append_audit_entry(
      p_organization_id, p_incident_id, 'proposal_cancelled', 'system', 'payscope-correlation', null,
      cancellation_status, format('%s pending proposal(s) cancelled after %s.', cancelled_count, p_reason), null,
      jsonb_build_object('cancelled_count', cancelled_count, 'reason', p_reason)
    );
  end if;
  return cancelled_count;
end;
$$;
revoke all on function public.payscope_cancel_pending_proposals(uuid, uuid, text) from public;
grant execute on function public.payscope_cancel_pending_proposals(uuid, uuid, text) to service_role;
