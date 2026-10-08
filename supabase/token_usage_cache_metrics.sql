-- Additive migration. NULL means unreported, not a measured zero.
alter table public.token_usage
  add column if not exists cached_input_tokens integer,
  add column if not exists cache_write_input_tokens integer,
  add column if not exists reasoning_tokens integer;
-- reasoning_tokens are a subset of output_tokens: never charge them twice.
-- Cached/read/write token rates depend on the actual model and processing tier.
