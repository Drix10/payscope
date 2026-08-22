-- Existing investigations predate the explicit gate trace. Preserve their
-- result while making their historical limitation visible instead of letting a
-- newer dashboard treat the decision JSON as malformed.
update public.payscope_investigations
set policy_decision = policy_decision || jsonb_build_object('gates', jsonb_build_array(
  jsonb_build_object('name', 'fraud', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.'),
  jsonb_build_object('name', 'dispute', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.'),
  jsonb_build_object('name', 'auto_resolve_ceiling', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.'),
  jsonb_build_object('name', 'human_review_floor', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.'),
  jsonb_build_object('name', 'critical_tier', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.'),
  jsonb_build_object('name', 'contact_limits', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.'),
  jsonb_build_object('name', 'merchant_policy', 'result', 'skipped', 'rationale', 'Historical investigation predates the explicit gate trace.')
))
where policy_decision is not null and not (policy_decision ? 'gates');
