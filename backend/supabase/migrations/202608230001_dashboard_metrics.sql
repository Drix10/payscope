-- Presentation-safe, tenant-scoped operational metrics for the read-only
-- Agentic Dashboard. Fixture evaluation and causal recovery attribution have
-- not run yet, so their values intentionally remain null rather than zero.
create or replace function public.payscope_dashboard_metrics(p_organization_id uuid)
returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with incident_totals as (
    select coalesce(sum(remaining_amount_paise), 0)::numeric as total_at_risk
    from public.payscope_incidents
    where organization_id = p_organization_id
  ), proposal_totals as (
    select
      count(*)::numeric as generated,
      (count(*) filter (where approved_at is not null))::numeric as approved
    from public.payscope_action_proposals
    where organization_id = p_organization_id
  )
  select jsonb_build_object(
    'operations', jsonb_build_object(
      -- JSON/JavaScript cannot represent a paise total above this exactly.
      'totalAtRiskPaise', case when total_at_risk <= 9007199254740991 then total_at_risk else null end,
      'proposalsGenerated', case when generated <= 9007199254740991 then generated else null end,
      'proposalsApproved', case when approved <= 9007199254740991 then approved else null end,
      'attributedRecoveries', null,
      'recoveredPaise', null,
      'recoveryRate', null,
      'contactToRecoveryRatio', null
    ),
    'evaluation', jsonb_build_object(
      'status', 'not_run',
      'split', null,
      'fixtureSetVersion', null,
      'runAt', null,
      'configurationHash', null,
      'modelId', null,
      'sampleCount', 0,
      'precision', null,
      'recall', null,
      'f1', null,
      'falsePositiveCostPaise', null
    ),
    'exceptions', jsonb_build_array(
      'No COD/RTO decisioning: shipping data is outside this MVP.',
      'Dispute-opened incidents are not eligible for recovery outreach.',
      'Fraud-confirmed incidents are not eligible for outreach.',
      'Incidents without a policy match are escalated to a human.',
      'Communications are simulated; no customer message is sent.',
      'Recovery is Test Mode simulation only; no real merchant revenue is claimed.',
      'Razorpay Live Mode and financial execution are out of scope.'
    )
  )
  from incident_totals cross join proposal_totals
$$;
revoke all on function public.payscope_dashboard_metrics(uuid) from public;
grant execute on function public.payscope_dashboard_metrics(uuid) to service_role;
