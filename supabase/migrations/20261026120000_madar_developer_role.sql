-- Madar: developer role (added separately so the value exists before later migrations use it)
alter type public.app_role add value if not exists 'developer';
