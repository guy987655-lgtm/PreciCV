-- Switch the payment provider from Stripe to Lemon Squeezy (Merchant of
-- Record — Stripe has no Israeli merchant onboarding). The purchase lifecycle
-- is unchanged (pending → paid via webhook); only the provider reference
-- column is renamed to a provider-neutral name. Lemon Squeezy stores the
-- order id here instead of the Stripe session id.
alter table public.purchases
  rename column stripe_session_id to provider_ref;
