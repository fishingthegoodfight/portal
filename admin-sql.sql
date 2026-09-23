-- =============================================================================
-- 2026-09-23 — Slug suffix always contains a letter
-- =============================================================================
-- The 4-character random suffix was plain hex, so about 15% of slugs ended in
-- four digits and read as a year: "...-dec-31-2071". The suffix now starts
-- with a random letter a–z followed by 3 hex characters ("...-dec-31-k07b"),
-- so it can't be mistaken for a date. Same length, same uniqueness retry.
-- Existing slugs are untouched — they're stable by design (printed links).
create or replace function public.generate_event_slug(p_name text, p_starts_at timestamptz, p_timezone text)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_title text := public.slugify_event_title(p_name);
  v_base text;
  v_candidate text;
begin
  if length(v_title) > 48 then
    v_title := btrim(regexp_replace(left(v_title, 49), '-[^-]*$', ''), '-');
  end if;
  v_base := concat_ws(
    '-',
    nullif(v_title, ''),
    lower(to_char(p_starts_at at time zone coalesce(p_timezone, 'America/Denver'), 'Mon-FMDD'))
  );
  loop
    v_candidate := v_base || '-'
      || chr(97 + floor(random() * 26)::int)
      || substr(md5(random()::text || clock_timestamp()::text), 1, 3);
    exit when not exists (select 1 from public.events where slug = v_candidate)
          and not exists (select 1 from public.event_slug_aliases where slug = v_candidate);
  end loop;
  return v_candidate;
end $function$;

revoke all on function public.generate_event_slug(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.generate_event_slug(text, timestamptz, text) to service_role;
