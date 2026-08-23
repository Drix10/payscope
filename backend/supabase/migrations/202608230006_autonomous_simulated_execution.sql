-- Autonomous MVP: the durable worker, not a browser operator, finalizes every
-- policy-permitted simulated action. This function is idempotent because only
-- pending rows are locked and transitioned.

drop function if exists public.payscope_approve_proposal(uuid, uuid, text, text, jsonb);

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

  select * into incident from public.payscope_incidents
  where id = p_incident_id and organization_id = p_organization_id for update;
  if not found then raise exception 'PayScope incident was not found for autonomous simulation'; end if;

  for proposal in
    select * from public.payscope_action_proposals
    where organization_id = p_organization_id and incident_id = p_incident_id and status = 'pending'
    order by proposed_at, id for update
  loop
    if incident.status in ('DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED') then
      update public.payscope_action_proposals set status = 'cancelled_by_recovery'
      where id = proposal.id returning * into proposal;
      perform public.payscope_append_audit_entry(
        p_organization_id, p_incident_id, 'autonomous_action_cancelled', 'system', 'payscope-autonomy', null,
        'terminal_incident', 'Autonomous simulation was cancelled because the incident is terminal.', null,
        jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type)
      );
      return next proposal;
      continue;
    end if;

    if proposal.action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script') then
      select e.normalized->>'customerHash' into v_customer_hash
      from public.payscope_events e
      where e.organization_id = p_organization_id and e.id = any(incident.correlated_event_ids)
        and e.normalized ? 'customerHash'
      order by (e.normalized->>'occurredAt')::timestamptz desc, e.id desc limit 1;
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
    set status = 'simulated', approved_at = now(), approved_by = null,
        delivery_result = jsonb_build_object('status', 'simulated', 'note', 'PayScope autonomously recorded this action; no customer message was sent.', 'simulatedAt', now())
    where id = proposal.id returning * into proposal;
    perform public.payscope_append_audit_entry(
      p_organization_id, p_incident_id, 'autonomous_action_simulated', 'system', 'payscope-autonomy', null,
      'simulated_autonomously', 'A deterministic policy-permitted action was recorded automatically; no customer message was sent.', null,
      jsonb_build_object('proposal_id', proposal.id, 'action_type', proposal.action_type)
    );
    return next proposal;
  end loop;
end;
$$;
revoke all on function public.payscope_autonomously_simulate_pending_proposals(uuid, uuid) from public;
grant execute on function public.payscope_autonomously_simulate_pending_proposals(uuid, uuid) to service_role;
