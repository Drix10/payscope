create table if not exists public.payscope_evaluation_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  split text not null check (split in ('development', 'held_out')),
  fixture_set_version text not null check (char_length(fixture_set_version) between 1 and 160),
  run_at timestamptz not null,
  configuration_hash text not null check (configuration_hash ~ '^[a-f0-9]{64}$'),
  model_id text not null check (char_length(model_id) between 1 and 160),
  sample_count integer not null check (sample_count > 0),
  precision numeric(8,7) not null check (precision >= 0 and precision <= 1),
  recall numeric(8,7) not null check (recall >= 0 and recall <= 1),
  f1 numeric(8,7) not null check (f1 >= 0 and f1 <= 1),
  false_positive_cost_paise bigint not null check (false_positive_cost_paise >= 0 and false_positive_cost_paise <= 9007199254740991),
  created_at timestamptz not null default now()
);
create index if not exists payscope_evaluation_reports_org_run_idx on public.payscope_evaluation_reports (organization_id, split, run_at desc);
alter table public.payscope_evaluation_reports enable row level security;

-- Development reports are append-only evidence. The final held-out set may be
-- recorded once per version/org, preventing silent retuning after evaluation.
create or replace function public.payscope_record_evaluation_report(
  p_organization_id uuid,
  p_report jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  recorded public.payscope_evaluation_reports%rowtype;
  report_split text;
  report_version text;
begin
  if jsonb_typeof(p_report) <> 'object' then raise exception 'PayScope evaluation report must be an object'; end if;
  report_split := p_report->>'split';
  report_version := p_report->>'fixtureSetVersion';
  if report_split not in ('development', 'held_out') then raise exception 'PayScope evaluation report has an invalid split'; end if;
  if report_split = 'held_out' and exists (
    select 1 from public.payscope_evaluation_reports
    where organization_id = p_organization_id and split = 'held_out' and fixture_set_version = report_version
  ) then
    raise exception 'PayScope held-out evaluation already exists for this fixture version';
  end if;

  insert into public.payscope_evaluation_reports (
    organization_id, split, fixture_set_version, run_at, configuration_hash,
    model_id, sample_count, precision, recall, f1, false_positive_cost_paise
  ) values (
    p_organization_id, report_split, report_version, (p_report->>'runAt')::timestamptz,
    p_report->>'configurationHash', p_report->>'modelId', (p_report->>'sampleCount')::integer,
    (p_report->>'precision')::numeric, (p_report->>'recall')::numeric,
    (p_report->>'f1')::numeric, (p_report->>'falsePositiveCostPaise')::bigint
  ) returning * into recorded;

  perform public.payscope_append_audit_entry(
    p_organization_id, null, 'evaluation_report_recorded', 'system', 'payscope-evaluation', null,
    'fixture_' || report_split || '_evaluation_recorded',
    'Versioned fixture evaluation report recorded; values are Test Mode evidence only.', null,
    jsonb_build_object('split', recorded.split, 'fixture_set_version', recorded.fixture_set_version, 'sample_count', recorded.sample_count, 'configuration_hash', recorded.configuration_hash)
  );
  return jsonb_build_object(
    'split', recorded.split, 'fixtureSetVersion', recorded.fixture_set_version,
    'runAt', recorded.run_at, 'configurationHash', recorded.configuration_hash,
    'modelId', recorded.model_id, 'sampleCount', recorded.sample_count,
    'precision', recorded.precision, 'recall', recorded.recall, 'f1', recorded.f1,
    'falsePositiveCostPaise', recorded.false_positive_cost_paise
  );
end;
$$;
revoke all on function public.payscope_record_evaluation_report(uuid, jsonb) from public;
grant execute on function public.payscope_record_evaluation_report(uuid, jsonb) to service_role;

create or replace function public.payscope_dashboard_metrics(p_organization_id uuid)
returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  with incident_totals as (
    -- The at-risk denominator is the amount at incident opening. Using the
    -- current remaining amount would make valid recoveries exceed 100%.
    select coalesce(sum(total_failed_amount_paise), 0)::numeric as total_at_risk
    from public.payscope_incidents where organization_id = p_organization_id
  ), proposal_totals as (
    select
      (count(*) filter (where action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script')))::numeric as generated,
      (count(*) filter (where action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script') and approved_at is not null))::numeric as approved
    from public.payscope_action_proposals where organization_id = p_organization_id
  ), recovery_candidates as (
    select distinct on (event_id)
      p.id as proposal_id, p.incident_id, e.id as event_id,
      i.total_failed_amount_paise::numeric as incident_total_paise,
      (e.normalized->>'amountPaise')::numeric as captured_amount_paise,
      (e.normalized->>'occurredAt')::timestamptz as captured_at,
      p.approved_at,
      case when e.normalized->'providerData'->>'payment_link_reference_id' = 'ps:' || p.id::text then 1 else 0 end as exact_reference
    from public.payscope_action_proposals p
    join public.payscope_incidents i on i.id = p.incident_id and i.organization_id = p.organization_id
    join public.payscope_events e on e.organization_id = p.organization_id and e.event_type = 'payment.captured'
    where p.organization_id = p_organization_id
      and p.action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script')
      and p.status = 'simulated' and p.approved_at is not null
      and (e.normalized->>'amountPaise') ~ '^[0-9]+$'
      and (e.normalized->>'occurredAt')::timestamptz >= p.approved_at
      and (e.normalized->>'occurredAt')::timestamptz <= p.approved_at + interval '24 hours'
      and (
        e.id = any(i.correlated_event_ids)
        or e.normalized->'providerData'->>'payment_link_reference_id' = 'ps:' || p.id::text
      )
      and not exists (
        select 1 from public.payscope_events dispute
        where dispute.organization_id = p.organization_id
          and dispute.id = any(i.correlated_event_ids)
          and dispute.event_type in ('payment.dispute.created', 'payment.dispute.under_review', 'payment.dispute.action_required')
          and (dispute.normalized->>'occurredAt')::timestamptz <= (e.normalized->>'occurredAt')::timestamptz
      )
    order by event_id, exact_reference desc, p.approved_at desc, p.id
  ), bounded_recoveries as (
    select proposal_id, incident_id, event_id,
      least(
        captured_amount_paise,
        greatest(0::numeric, incident_total_paise - coalesce(sum(captured_amount_paise) over (
          partition by incident_id order by captured_at, event_id rows between unbounded preceding and 1 preceding
        ), 0::numeric))
      ) as recovered_paise
    from recovery_candidates
  ), attribution_totals as (
    select
      (count(*) filter (where recovered_paise > 0))::numeric as attributed_recoveries,
      coalesce(sum(recovered_paise) filter (where recovered_paise > 0), 0)::numeric as recovered_paise
    from bounded_recoveries
  ), latest_evaluation as (
    select * from public.payscope_evaluation_reports
    where organization_id = p_organization_id
    order by case split when 'held_out' then 0 else 1 end, run_at desc
    limit 1
  )
  select jsonb_build_object(
    'operations', jsonb_build_object(
      'totalAtRiskPaise', case when total_at_risk <= 9007199254740991 then total_at_risk else null end,
      'proposalsGenerated', case when generated <= 9007199254740991 then generated else null end,
      'proposalsApproved', case when approved <= 9007199254740991 then approved else null end,
      'attributedRecoveries', case when attributed_recoveries <= 9007199254740991 then attributed_recoveries else null end,
      'recoveredPaise', case when recovered_paise <= 9007199254740991 then recovered_paise else null end,
      'recoveryRate', case when total_at_risk > 0 then recovered_paise / total_at_risk else null end,
      'contactToRecoveryRatio', case when attributed_recoveries > 0 then approved / attributed_recoveries else null end
    ),
    'evaluation', case when latest_evaluation.id is null then jsonb_build_object(
      'status', 'not_run', 'split', null, 'fixtureSetVersion', null, 'runAt', null,
      'configurationHash', null, 'modelId', null, 'sampleCount', 0, 'precision', null,
      'recall', null, 'f1', null, 'falsePositiveCostPaise', null
    ) else jsonb_build_object(
      'status', 'available', 'split', latest_evaluation.split,
      'fixtureSetVersion', latest_evaluation.fixture_set_version, 'runAt', latest_evaluation.run_at,
      'configurationHash', latest_evaluation.configuration_hash, 'modelId', latest_evaluation.model_id,
      'sampleCount', latest_evaluation.sample_count, 'precision', latest_evaluation.precision,
      'recall', latest_evaluation.recall, 'f1', latest_evaluation.f1,
      'falsePositiveCostPaise', latest_evaluation.false_positive_cost_paise
    ) end,
    'exceptions', jsonb_build_array(
      'No COD/RTO decisioning: shipping data is outside this MVP.',
      'Dispute-opened incidents are not eligible for recovery outreach.',
      'Fraud-confirmed incidents are not eligible for outreach.',
      'Incidents without a policy match are escalated to a human.',
      'Communications are simulated; no customer message is sent.',
      'Recovery is Test Mode simulation only; no real merchant revenue is claimed.',
      'Razorpay Live Mode and financial execution are out of scope.'
    )
  ) from incident_totals cross join proposal_totals cross join attribution_totals left join latest_evaluation on true
$$;
revoke all on function public.payscope_dashboard_metrics(uuid) from public;
grant execute on function public.payscope_dashboard_metrics(uuid) to service_role;
