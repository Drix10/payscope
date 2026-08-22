-- A broken audit chain is a hard stop for the one simulated approval action.
-- Recreate the approval RPC with the same lock order and stopping rules from
-- migration 006, adding verification before any proposal state change.
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
  proposal_incident_id uuid;
  incident public.payscope_incidents;
  v_customer_hash text;
  incident_attempts integer;
  attempts_24h integer;
  attempts_7d integer;
  merchant_opted_in boolean;
begin
  if exists (select 1 from public.payscope_verify_audit_chain(p_organization_id) where not valid) then
    raise exception 'PayScope audit integrity is broken; proposal approval is blocked';
  end if;
  select incident_id into proposal_incident_id from public.payscope_action_proposals
  where id = p_proposal_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope proposal was not found'; end if;
  select * into incident from public.payscope_incidents
  where id = proposal_incident_id and organization_id = p_organization_id for update;
  if not found then raise exception 'PayScope proposal incident was not found'; end if;
  select * into proposal from public.payscope_action_proposals
  where id = p_proposal_id and organization_id = p_organization_id for update;
  if not found then raise exception 'PayScope proposal was not found'; end if;
  if proposal.status <> 'pending' then raise exception 'PayScope proposal is no longer pending'; end if;
  if incident.status in ('DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED') then raise exception 'PayScope proposal cannot be approved for a terminal incident'; end if;
  if coalesce(p_delivery_result->>'status', '') <> 'simulated' then raise exception 'PayScope MVP permits simulated delivery only'; end if;

  if proposal.action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script') then
    select e.normalized->>'customerHash' into v_customer_hash
    from public.payscope_events e
    where e.organization_id = p_organization_id and e.id = any(incident.correlated_event_ids) and e.normalized ? 'customerHash'
    order by (e.normalized->>'occurredAt')::timestamptz desc, e.id desc limit 1;
    if v_customer_hash is null or v_customer_hash !~ '^[a-f0-9]{64}$' then raise exception 'PayScope outreach proposal has no customer reference'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_customer_hash, 0));
    select merchant_opted_in_to_recovery into merchant_opted_in from public.payscope_merchant_policies where organization_id = p_organization_id;
    select count(*) into incident_attempts from public.payscope_contact_attempts where organization_id = p_organization_id and incident_id = proposal_incident_id;
    select count(*) into attempts_24h from public.payscope_contact_attempts attempts where attempts.organization_id = p_organization_id and attempts.customer_hash = v_customer_hash and attempts.attempted_at >= now() - interval '24 hours';
    select count(*) into attempts_7d from public.payscope_contact_attempts attempts where attempts.organization_id = p_organization_id and attempts.customer_hash = v_customer_hash and attempts.attempted_at >= now() - interval '7 days';
    if not coalesce(merchant_opted_in, false) or incident_attempts >= 2 or attempts_24h >= 1 or attempts_7d >= 3 then raise exception 'PayScope contact stopping rule prevents simulated outreach approval'; end if;
    insert into public.payscope_contact_attempts (organization_id, customer_hash, incident_id) values (p_organization_id, v_customer_hash, proposal_incident_id);
  end if;

  update public.payscope_action_proposals set status = 'simulated', approved_at = now(), delivery_result = p_delivery_result where id = proposal.id returning * into proposal;
  perform public.payscope_append_audit_entry(p_organization_id, proposal.incident_id, 'proposal_approved', 'human', left(p_actor_id, 160), p_actor_session_hash, 'approved_for_simulation', 'Operator approved a proposal for simulated-only delivery.', null, jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type));
  perform public.payscope_append_audit_entry(p_organization_id, proposal.incident_id, 'simulated_delivery_recorded', 'system', 'logging-communications-adapter', null, 'delivered_simulated', 'No customer message was sent. Delivery is an MVP simulation.', null, jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type));
  return proposal;
end;
$$;
revoke all on function public.payscope_approve_proposal(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.payscope_approve_proposal(uuid, uuid, text, text, jsonb) to service_role;
