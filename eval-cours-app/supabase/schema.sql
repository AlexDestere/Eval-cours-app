create extension if not exists pgcrypto;

create table if not exists public.eval_public_state (
  id text primary key,
  config jsonb not null default '{}'::jsonb,
  years jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.eval_admin (
  id text primary key,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.eval_year_content (
  year_id text primary key,
  ues jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.eval_responses (
  id uuid primary key default gen_random_uuid(),
  year_id text not null,
  ue_id text not null,
  course_name text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists eval_responses_year_idx on public.eval_responses (year_id);
create index if not exists eval_responses_year_course_idx on public.eval_responses (year_id, ue_id, course_name);

alter table public.eval_public_state enable row level security;
alter table public.eval_admin enable row level security;
alter table public.eval_year_content enable row level security;
alter table public.eval_responses enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.eval_public_state to anon, authenticated;
grant select on public.eval_year_content to anon, authenticated;
grant select, insert on public.eval_responses to anon, authenticated;

drop policy if exists "eval public state read" on public.eval_public_state;
create policy "eval public state read"
on public.eval_public_state
for select
to anon, authenticated
using (true);

drop policy if exists "eval year content read" on public.eval_year_content;
create policy "eval year content read"
on public.eval_year_content
for select
to anon, authenticated
using (true);

drop policy if exists "eval responses read" on public.eval_responses;
create policy "eval responses read"
on public.eval_responses
for select
to anon, authenticated
using (true);

drop policy if exists "eval responses insert" on public.eval_responses;
create policy "eval responses insert"
on public.eval_responses
for insert
to anon, authenticated
with check (jsonb_typeof(response) = 'object');

insert into public.eval_public_state (id, config, years)
values (
  'main',
  $cfg$
  {
    "globalLQ": [
      { "id": "q1", "short": "Pédagogie", "label": "Qualité pédagogique globale" },
      { "id": "q2", "short": "Objectifs", "label": "Clarté des objectifs d'apprentissage" },
      { "id": "q3", "short": "Cohérence", "label": "Adéquation contenu / objectifs" },
      { "id": "q4", "short": "Supports", "label": "Qualité des supports de cours" },
      { "id": "q5", "short": "Enseignant", "label": "Disponibilité et investissement de l'enseignant" },
      { "id": "q6", "short": "EDN", "label": "Pertinence pour les épreuves nationales (EDN)" }
    ],
    "globalYNQ": [
      { "id": "y1q", "label": "Les objectifs étaient clairement annoncés dès le début" },
      { "id": "y2q", "label": "J'avais suffisamment de ressources pour travailler en autonomie" },
      { "id": "y3q", "label": "Le volume de travail demandé était raisonnable" },
      { "id": "y4q", "label": "Je recommanderais ce cours" }
    ],
    "globalTQ": [
      { "id": "t1", "label": "Points forts", "ph": "Ce que j'ai particulièrement apprécié…" },
      { "id": "t2", "label": "Points à améliorer", "ph": "Ce qui mériterait d'être revu…" },
      { "id": "t3", "label": "Suggestions libres", "ph": "Toute autre remarque ou suggestion…" }
    ]
  }
  $cfg$::jsonb,
  $yrs$
  [
    { "id": "y1", "name": "DFGSM1", "sub": "1ère année" },
    { "id": "y2", "name": "DFGSM2", "sub": "2ème année" },
    { "id": "y3", "name": "DFGSM3", "sub": "3ème année" },
    { "id": "y4", "name": "DFASM1", "sub": "4ème année" },
    { "id": "y5", "name": "DFASM2", "sub": "5ème année" },
    { "id": "y6", "name": "DFASM3", "sub": "6ème année" }
  ]
  $yrs$::jsonb
)
on conflict (id) do nothing;

insert into public.eval_admin (id, pin_hash)
values (
  'main',
  crypt('1234', gen_salt('bf'))
)
on conflict (id) do nothing;

create or replace function public.eval_bootstrap()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'hasConfig', exists(select 1 from public.eval_public_state where id = 'main'),
    'hasYears', exists(select 1 from public.eval_public_state where id = 'main'),
    'config', coalesce((select config from public.eval_public_state where id = 'main'), 'null'::jsonb),
    'years', coalesce((select years from public.eval_public_state where id = 'main'), 'null'::jsonb),
    'responseCounts',
      coalesce(
        (
          select jsonb_object_agg(year_id, total)
          from (
            select year_id, count(*)::int as total
            from public.eval_responses
            group by year_id
          ) counts
        ),
        '{}'::jsonb
      )
  );
$$;

create or replace function public.eval_year_payload(target_year_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'exists',
      exists(select 1 from public.eval_year_content where year_id = target_year_id)
      or exists(select 1 from public.eval_responses where year_id = target_year_id),
    'ues',
      coalesce(
        (select ues from public.eval_year_content where year_id = target_year_id),
        '[]'::jsonb
      ),
    'responses',
      coalesce(
        (
          select jsonb_object_agg(response_key, response_list)
          from (
            select
              ue_id || '::' || course_name as response_key,
              jsonb_agg(response order by created_at, id) as response_list
            from public.eval_responses
            where year_id = target_year_id
            group by ue_id, course_name
          ) grouped
        ),
        '{}'::jsonb
      )
  );
$$;

create or replace function public.eval_verify_pin(candidate_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
begin
  select pin_hash into stored_hash
  from public.eval_admin
  where id = 'main';

  if stored_hash is null then
    return false;
  end if;

  return stored_hash = crypt(candidate_pin, stored_hash);
end;
$$;

create or replace function public.eval_save_public_state(
  candidate_pin text,
  next_config jsonb default null,
  next_years jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
begin
  select pin_hash into stored_hash
  from public.eval_admin
  where id = 'main';

  if stored_hash is null or stored_hash <> crypt(candidate_pin, stored_hash) then
    raise exception 'invalid_pin';
  end if;

  insert into public.eval_public_state (id, config, years, updated_at)
  values (
    'main',
    coalesce(next_config, '{}'::jsonb),
    coalesce(next_years, '[]'::jsonb),
    now()
  )
  on conflict (id) do update
  set
    config = coalesce(next_config, public.eval_public_state.config),
    years = coalesce(next_years, public.eval_public_state.years),
    updated_at = now();

  return true;
end;
$$;

create or replace function public.eval_save_year_ues(
  candidate_pin text,
  target_year_id text,
  next_ues jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
begin
  select pin_hash into stored_hash
  from public.eval_admin
  where id = 'main';

  if stored_hash is null or stored_hash <> crypt(candidate_pin, stored_hash) then
    raise exception 'invalid_pin';
  end if;

  insert into public.eval_year_content (year_id, ues, updated_at)
  values (target_year_id, coalesce(next_ues, '[]'::jsonb), now())
  on conflict (year_id) do update
  set
    ues = coalesce(next_ues, public.eval_year_content.ues),
    updated_at = now();

  return true;
end;
$$;

create or replace function public.eval_replace_year_payload(
  candidate_pin text,
  target_year_id text,
  next_ues jsonb default null,
  next_responses jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
begin
  select pin_hash into stored_hash
  from public.eval_admin
  where id = 'main';

  if stored_hash is null or stored_hash <> crypt(candidate_pin, stored_hash) then
    raise exception 'invalid_pin';
  end if;

  if next_ues is not null then
    insert into public.eval_year_content (year_id, ues, updated_at)
    values (target_year_id, next_ues, now())
    on conflict (year_id) do update
    set
      ues = excluded.ues,
      updated_at = now();
  end if;

  if next_responses is not null then
    delete from public.eval_responses
    where year_id = target_year_id;

    insert into public.eval_responses (year_id, ue_id, course_name, response, created_at)
    select
      target_year_id,
      split_part(entry.key, '::', 1),
      substring(entry.key from position('::' in entry.key) + 2),
      item.value,
      case
        when (item.value->>'ts') ~ '^[0-9]+$'
          then to_timestamp(((item.value->>'ts')::numeric) / 1000.0)
        else now()
      end
    from jsonb_each(next_responses) as entry(key, value)
    cross join lateral jsonb_array_elements(entry.value) as item(value);
  end if;

  return true;
end;
$$;

create or replace function public.eval_change_pin(
  current_pin text,
  next_pin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
begin
  select pin_hash into stored_hash
  from public.eval_admin
  where id = 'main';

  if stored_hash is null or stored_hash <> crypt(current_pin, stored_hash) then
    raise exception 'invalid_pin';
  end if;

  if length(coalesce(next_pin, '')) < 4 then
    raise exception 'pin_too_short';
  end if;

  update public.eval_admin
  set
    pin_hash = crypt(next_pin, gen_salt('bf')),
    updated_at = now()
  where id = 'main';

  return true;
end;
$$;

grant execute on function public.eval_bootstrap() to anon, authenticated;
grant execute on function public.eval_year_payload(text) to anon, authenticated;
grant execute on function public.eval_verify_pin(text) to anon, authenticated;
grant execute on function public.eval_save_public_state(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.eval_save_year_ues(text, text, jsonb) to anon, authenticated;
grant execute on function public.eval_replace_year_payload(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.eval_change_pin(text, text) to anon, authenticated;
