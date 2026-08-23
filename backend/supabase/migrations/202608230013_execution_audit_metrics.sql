-- Direct-execution audit + verified execution metrics.
-- 1) Records decision input hash and version tags on every immutable action
--    so a later audit can reproduce why a command was issued.
-- 2) Replaces simulation metrics with verified execution metrics sourced from
--    payscope_execution_actions and provider receipts.

-- 1. Audit reproducibility columns
alter table public.payscope_execution_actions
  add column if not exists decision_input_hash text check (decision_input_hash is null or decision_input_hash ~ '^[a-f0-9]{64}$'),
  add column if not exists policy_version text not null default 'direct-execution-policy-v2',
  add column if not exists capability_version text not null default 'deliver_recovery_link_email-v1',
  add column if not exists prompt_model_version text not null default 'recovery-planner-v1';

create or replace function public.payscope_set_decision_input_hash()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.decision_input_hash is null or new.decision_input_hash = '' then
    new.decision_input_hash := encode(extensions.digest(
      coalesce(new.organization_id::text,'') || ':' || coalesce(new.capability,'') || ':' ||
      coalesce(new.command_key,'') || ':' || coalesce(new.command_payload_hash,'') || ':' ||
      coalesce(new.canonical_payment_id,'') || ':' || coalesce(new.canonical_order_id,'') || ':' ||
      coalesce(new.amount_paise::text,'') || ':' || coalesce(new.currency,''),
      'sha256'), 'hex');
  end if;
  return new;
end;
$$;
drop trigger if exists payscope_execution_actions_decision_hash on public.payscope_execution_actions;
create trigger payscope_execution_actions_decision_hash before insert on public.payscope_execution_actions for each row execute function public.payscope_set_decision_input_hash();

-- 2. Verified execution metrics (replaces simulation counts)
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
begin
  select coalesce(sum(remaining_amount_paise), 0) into total_at_risk
    from public.payscope_incidents where organization_id = p_organization_id and status <> 'DISMISSED';

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
