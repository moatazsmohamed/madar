-- Join codes are 10 hex characters. Pasted links can carry RTL marks,
-- zero-width characters or stray punctuation around the code, so normalize
-- the input before matching.
create or replace function public.company_join_info(p_code text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'name', c.name,
    'timezone', c.timezone,
    'status', c.status
  )
  from public.companies c
  where c.join_code = regexp_replace(lower(coalesce(p_code, '')), '[^0-9a-f]', '', 'g')
$function$;

grant execute on function public.company_join_info(text) to anon, authenticated;
