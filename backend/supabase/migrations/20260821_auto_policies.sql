create table if not exists public.auto_policies (
  policy_id text primary key,
  name text not null check (char_length(name) between 1 and 120),
  enabled boolean not null default true,
  incident_types jsonb not null default '[]'::jsonb check (jsonb_typeof(incident_types) = 'array'),
  severities jsonb not null default '[]'::jsonb check (jsonb_typeof(severities) = 'array'),
  min_confidence numeric not null default 0.8 check (min_confidence >= 0 and min_confidence <= 1),
  max_amount_paise bigint check (max_amount_paise is null or max_amount_paise >= 0),
  action text not null check (action in ('review_payment_method', 'prepare_follow_up', 'escalate', 'monitor', 'dismiss')),
  require_human_for_escalate boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table public.auto_policies enable row level security;
-- Service-role only; no browser RLS policies until multi-tenant auth exists.
