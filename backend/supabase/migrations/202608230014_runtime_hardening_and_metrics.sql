-- Runtime hardening follow-up:
-- - merchant-configured quiet-hours timezone
-- - expression indexes for callback/action matching
-- - richer verified metrics for incidents, recovery rate, strategy performance,
--   LLM failures, and time to recovery.

alter table public.payscope_organization_execution_policy
  add column if not exists merchant_timezone text not null default 'Asia/Kolkata'
    check (merchant_timezone ~ '^[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$');

create index if not exists payscope_execution_actions_customer_hash_idx
  on public.payscope_execution_actions (organization_id, (command_payload->>'customerHash'));

create index if not exists payscope_execution_actions_reference_idx
  on public.payscope_execution_actions (organization_id, capability, (command_payload->>'referenceId'));

create or replace function public.payscope_dashboard_metrics(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  total_at_risk numeric := 0;
  actions_dispatched integer := 0;
  smtp_accepted integer := 0;
  smtp_rejected integer := 0;
  unreconciled_emails integer := 0;
  confirmed_recoveries integer := 0;
  refunded integer := 0;
  failed_actions integer := 0;
  retried integer := 0;
  compensated integer := 0;
  unresolved_receipts integer := 0;
  incidents_opened integer := 0;
  incidents_active integer := 0;
  incidents_resolved integer := 0;
  incidents_dismissed integer := 0;
  disputes_opened integer := 0;
  recovery_rate numeric := 0;
  median_ttr_ms numeric := null;
  llm_failures integer := 0;
  strategy_rows jsonb := '[]'::jsonb;
begin
  perform 1 from public.payscope_organizations where id = p_organization_id;
  if not found then raise exception 'PayScope organization was not found for dashboard metrics'; end if;

  select
    coalesce(sum(remaining_amount_paise), 0),
    count(*),
    count(*) filter (where status in ('OPEN','MONITORING','ESCALATED')),
    count(*) filter (where status in ('RESOLVED','HUMAN_RESOLVED')),
    count(*) filter (where status = 'DISMISSED'),
    count(*) filter (where status = 'DISPUTE_OPENED')
  into total_at_risk, incidents_opened, incidents_active, incidents_resolved, incidents_dismissed, disputes_opened
  from public.payscope_incidents where organization_id = p_organization_id;

  recovery_rate := case
    when incidents_resolved + incidents_dismissed = 0 then 0
    else incidents_resolved::numeric / (incidents_resolved + incidents_dismissed)
  end;

  select percentile_cont(0.5) within group (order by extract(epoch from (coalesce(resolved_at, updated_at) - opened_at)) * 1000)
  into median_ttr_ms
  from public.payscope_incidents
  where organization_id = p_organization_id and status in ('RESOLVED','HUMAN_RESOLVED') and opened_at is not null;

  select count(*) into actions_dispatched from public.payscope_execution_actions
    where organization_id = p_organization_id and dispatched_at is not null;
  select count(*) into smtp_accepted from public.payscope_execution_receipts
    where organization_id = p_organization_id and provider = 'smtp' and receipt_kind = 'smtp_accepted';
  select count(*) into smtp_rejected from public.payscope_execution_receipts
    where organization_id = p_organization_id and provider = 'smtp' and receipt_kind = 'smtp_rejected';
  select count(*) into unreconciled_emails from public.payscope_execution_actions
    where organization_id = p_organization_id and state = 'unreconciled';
  select count(*) into confirmed_recoveries from public.payscope_execution_actions
    where organization_id = p_organization_id and state = 'confirmed';
  select count(*) into refunded from public.payscope_execution_actions
    where organization_id = p_organization_id and capability = 'refund_payment' and state = 'confirmed';
  select count(*) into failed_actions from public.payscope_execution_actions
    where organization_id = p_organization_id and state = 'failed';
  select count(*) into retried from public.payscope_execution_actions
    where organization_id = p_organization_id and retry_count > 0;
  select count(*) into compensated from public.payscope_execution_actions
    where organization_id = p_organization_id and state in ('compensating', 'cancelled');
  select count(*) into unresolved_receipts from public.payscope_execution_actions
    where organization_id = p_organization_id and state in ('accepted', 'dispatching');

  select coalesce(jsonb_agg(jsonb_build_object(
    'strategy', capability,
    'attempted', attempted,
    'confirmed', confirmed,
    'failed', failed,
    'cancelled', cancelled,
    'recoveryRate', case when attempted = 0 then 0 else confirmed::numeric / attempted end
  ) order by capability), '[]'::jsonb)
  into strategy_rows
  from (
    select capability,
      count(*)::integer as attempted,
      count(*) filter (where state = 'confirmed')::integer as confirmed,
      count(*) filter (where state = 'failed')::integer as failed,
      count(*) filter (where state = 'cancelled')::integer as cancelled
    from public.payscope_execution_actions
    where organization_id = p_organization_id
    group by capability
  ) strategy;

  select count(*) into llm_failures from public.payscope_audit_entries
    where organization_id = p_organization_id
      and event_type in ('investigation_unavailable','investigation_failed','llm_failure')
      and created_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'operations', jsonb_build_object(
      'totalAtRiskPaise', case when total_at_risk <= 9007199254740991 then total_at_risk else null end,
      'actionsDispatched', actions_dispatched,
      'smtpAccepted', smtp_accepted,
      'smtpRejected', smtp_rejected,
      'unreconciledEmails', unreconciled_emails,
      'confirmedRecoveries', confirmed_recoveries,
      'refunded', refunded,
      'failedActions', failed_actions,
      'retried', retried,
      'compensated', compensated,
      'unresolvedReceipts', unresolved_receipts
    ),
    'incidentMetrics', jsonb_build_object(
      'opened', incidents_opened,
      'active', incidents_active,
      'resolved', incidents_resolved,
      'dismissed', incidents_dismissed,
      'disputesOpened', disputes_opened
    ),
    'recoveryMetrics', jsonb_build_object(
      'recoveryRate', recovery_rate,
      'medianTimeToRecoveryMs', case when median_ttr_ms is null then null else round(median_ttr_ms)::bigint end
    ),
    'strategyPerformance', strategy_rows,
    'llmMetrics', jsonb_build_object('failuresLast24Hours', llm_failures),
    'evaluation', jsonb_build_object('status','not_run','split',null,'fixtureSetVersion',null,'runAt',null,'configurationHash',null,'modelId',null,'sampleCount',0,'precision',null,'recall',null,'f1',null,'falsePositiveCostPaise',null),
    'exceptions', jsonb_build_array(
      'No COD/RTO decisioning: shipping data is outside this MVP.',
      'Dispute-opened incidents are not eligible for recovery outreach.',
      'Fraud-confirmed incidents are automatically dismissed with no outreach.',
      'SMTP acceptance is recorded as acceptance only, never as delivered.',
      'Recovery is attributed only through a causal action, provider receipt, and verified Razorpay event.',
      'Capture, refund, and dispute submission remain disabled until proven in a dedicated sandbox.',
      'Razorpay Live Mode financial execution is enabled only after Phase B/C proofs.'
    )
  );
end;
$$;
revoke all on function public.payscope_dashboard_metrics(uuid) from public;
grant execute on function public.payscope_dashboard_metrics(uuid) to service_role;
