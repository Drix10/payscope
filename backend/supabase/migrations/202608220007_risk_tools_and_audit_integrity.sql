-- Bounded, tenant-scoped aggregates for the Risk Analyst. The model never
-- receives an organization ID and cannot choose database filters; only this
-- service-role RPC supplies the aggregate facts used in its prompt.
create or replace function public.payscope_risk_tool_metrics(
  p_organization_id uuid,
  p_gateway text,
  p_customer_hash text,
  p_window_hours integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  merchant_total bigint := 0;
  merchant_failed bigint := 0;
  gateway_total bigint := 0;
  gateway_failed bigint := 0;
  customer_incidents bigint := 0;
  merchant_rate numeric;
  gateway_rate numeric;
begin
  if p_window_hours not in (1, 4, 24) then raise exception 'PayScope risk-tool window must be 1, 4, or 24 hours'; end if;
  if p_gateway is not null and char_length(p_gateway) > 80 then raise exception 'PayScope gateway value is too long'; end if;
  if p_customer_hash is not null and p_customer_hash !~ '^[a-f0-9]{64}$' then raise exception 'PayScope customer hash is invalid'; end if;
  perform 1 from public.payscope_organizations where id = p_organization_id;
  if not found then raise exception 'PayScope organization was not found for risk tools'; end if;

  select
    count(*) filter (where event_type in ('payment.failed', 'payment.captured', 'order.paid')),
    count(*) filter (where event_type = 'payment.failed')
  into merchant_total, merchant_failed
  from public.payscope_events
  where organization_id = p_organization_id
    and created_at >= now() - make_interval(hours => p_window_hours);
  merchant_rate := case when merchant_total = 0 then null else merchant_failed::numeric / merchant_total end;

  if nullif(trim(p_gateway), '') is not null then
    select
      count(*) filter (where event_type in ('payment.failed', 'payment.captured', 'order.paid')),
      count(*) filter (where coalesce(enrichment ->> 'failureAttribution', '') in ('gateway_degraded', 'routing_suboptimal'))
    into gateway_total, gateway_failed
    from public.payscope_events
    where organization_id = p_organization_id
      and normalized ->> 'paymentMethod' = p_gateway
      and created_at >= now() - make_interval(hours => p_window_hours);
    gateway_rate := case when gateway_total = 0 then null else gateway_failed::numeric / gateway_total end;
  end if;

  if p_customer_hash is not null then
    select count(distinct incident.id) into customer_incidents
    from public.payscope_incidents incident
    join public.payscope_events event on event.organization_id = incident.organization_id
      and event.id = any(incident.correlated_event_ids)
    where incident.organization_id = p_organization_id
      and event.normalized ->> 'customerHash' = p_customer_hash;
  end if;

  return jsonb_build_object(
    'merchantFailureRate', merchant_rate,
    'networkFailureRate', gateway_rate,
    'customerIncidentCount', case when p_customer_hash is null then null else customer_incidents end
  );
end;
$$;
revoke all on function public.payscope_risk_tool_metrics(uuid, text, text, integer) from public;
grant execute on function public.payscope_risk_tool_metrics(uuid, text, text, integer) to service_role;

-- Return only a compact verification summary to the operator UI. Hash values
-- remain database-only; an invalid chain is still a blocking API state.
create or replace function public.payscope_audit_chain_summary(
  p_organization_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  entry_count bigint := 0;
  broken_count bigint := 0;
begin
  perform 1 from public.payscope_organizations where id = p_organization_id;
  if not found then raise exception 'PayScope organization was not found for audit verification'; end if;
  select count(*), count(*) filter (where not valid)
  into entry_count, broken_count
  from public.payscope_verify_audit_chain(p_organization_id);
  return jsonb_build_object('status', case when broken_count = 0 then 'intact' else 'broken' end, 'entryCount', entry_count, 'checkedAt', now());
end;
$$;
revoke all on function public.payscope_audit_chain_summary(uuid) from public;
grant execute on function public.payscope_audit_chain_summary(uuid) to service_role;
