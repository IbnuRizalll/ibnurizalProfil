create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  author text not null,
  description text not null,
  tags text[] not null default '{}',
  body text not null default '',
  cover_image_url text,
  content_blocks jsonb not null default '[]'::jsonb,
  is_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_projects_created_at_desc on public.projects (created_at desc);
create index if not exists idx_projects_updated_at_desc on public.projects (updated_at desc);
create index if not exists idx_projects_tags_gin on public.projects using gin (tags);

alter table public.projects
  add column if not exists cover_image_url text;

alter table public.projects
  add column if not exists content_blocks jsonb not null default '[]'::jsonb;

alter table public.projects
  add column if not exists is_visible boolean not null default true;

create or replace function public.set_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;

create trigger trg_projects_updated_at
before update on public.projects
for each row
execute procedure public.set_projects_updated_at();

alter table public.projects enable row level security;

drop policy if exists "Public read projects" on public.projects;
create policy "Public read projects"
  on public.projects
  for select
  using (coalesce(is_visible, true) = true);

drop policy if exists "Authenticated insert projects" on public.projects;
create policy "Authenticated insert projects"
  on public.projects
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated update projects" on public.projects;
create policy "Authenticated update projects"
  on public.projects
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated delete projects" on public.projects;
create policy "Authenticated delete projects"
  on public.projects
  for delete
  to authenticated
  using (true);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  author text not null,
  description text not null,
  tags text[] not null default '{}',
  body text not null default '',
  cover_image_url text,
  content_blocks jsonb not null default '[]'::jsonb,
  is_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_blog_posts_created_at_desc on public.blog_posts (created_at desc);
create index if not exists idx_blog_posts_updated_at_desc on public.blog_posts (updated_at desc);
create index if not exists idx_blog_posts_tags_gin on public.blog_posts using gin (tags);

alter table public.blog_posts
  add column if not exists cover_image_url text;

alter table public.blog_posts
  add column if not exists content_blocks jsonb not null default '[]'::jsonb;

alter table public.blog_posts
  add column if not exists is_visible boolean not null default true;

create or replace function public.set_blog_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_blog_posts_updated_at on public.blog_posts;

create trigger trg_blog_posts_updated_at
before update on public.blog_posts
for each row
execute procedure public.set_blog_posts_updated_at();

alter table public.blog_posts enable row level security;

drop policy if exists "Public read blog_posts" on public.blog_posts;
create policy "Public read blog_posts"
  on public.blog_posts
  for select
  using (coalesce(is_visible, true) = true);

drop policy if exists "Authenticated insert blog_posts" on public.blog_posts;
create policy "Authenticated insert blog_posts"
  on public.blog_posts
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated update blog_posts" on public.blog_posts;
create policy "Authenticated update blog_posts"
  on public.blog_posts
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated delete blog_posts" on public.blog_posts;
create policy "Authenticated delete blog_posts"
  on public.blog_posts
  for delete
  to authenticated
  using (true);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  message text not null,
  is_read boolean not null default false,
  replied_via text,
  replied_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_contact_messages_created_at_desc on public.contact_messages (created_at desc);
create index if not exists idx_contact_messages_is_read on public.contact_messages (is_read);
create index if not exists idx_contact_messages_replied_via on public.contact_messages (replied_via);

alter table public.contact_messages
  alter column id set default gen_random_uuid();

alter table public.contact_messages
  add column if not exists created_at timestamptz;

alter table public.contact_messages
  add column if not exists updated_at timestamptz;

alter table public.contact_messages
  alter column created_at set default timezone('utc', now());

alter table public.contact_messages
  alter column updated_at set default timezone('utc', now());

update public.contact_messages
set
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where created_at is null or updated_at is null;

alter table public.contact_messages
  alter column created_at set not null;

alter table public.contact_messages
  alter column updated_at set not null;

alter table public.contact_messages
  add column if not exists phone text not null default '';

alter table public.contact_messages
  add column if not exists is_read boolean not null default false;

alter table public.contact_messages
  add column if not exists replied_via text;

alter table public.contact_messages
  add column if not exists replied_at timestamptz;

create or replace function public.set_contact_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_contact_messages_updated_at on public.contact_messages;

create trigger trg_contact_messages_updated_at
before update on public.contact_messages
for each row
execute procedure public.set_contact_messages_updated_at();

alter table public.contact_messages enable row level security;

drop policy if exists "Public insert contact_messages" on public.contact_messages;
create policy "Public insert contact_messages"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Authenticated read contact_messages" on public.contact_messages;
create policy "Authenticated read contact_messages"
  on public.contact_messages
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated update contact_messages" on public.contact_messages;
create policy "Authenticated update contact_messages"
  on public.contact_messages
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated delete contact_messages" on public.contact_messages;
create policy "Authenticated delete contact_messages"
  on public.contact_messages
  for delete
  to authenticated
  using (true);

create table if not exists public.site_settings (
  id text primary key default 'main',
  logo_url text,
  home_image_url text not null default '/astronaut-hero-img.webp',
  hero_description text not null default 'Saya Ibnu Rizal Mutaqim, seorang developer yang berfokus membangun website cepat, rapi, dan mudah dikelola.',
  about_me text not null default 'Saya fokus pada pengembangan web modern yang cepat, accessible, dan mudah dipelihara. Saya terbiasa mengerjakan antarmuka, integrasi API, serta optimasi performa agar produk digital siap dipakai di dunia nyata.',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.site_settings
  add column if not exists logo_url text;

alter table public.site_settings
  add column if not exists home_image_url text not null default '/astronaut-hero-img.webp';

alter table public.site_settings
  add column if not exists hero_description text not null default 'Saya Ibnu Rizal Mutaqim, seorang developer yang berfokus membangun website cepat, rapi, dan mudah dikelola.';

alter table public.site_settings
  add column if not exists about_me text not null default 'Saya fokus pada pengembangan web modern yang cepat, accessible, dan mudah dipelihara. Saya terbiasa mengerjakan antarmuka, integrasi API, serta optimasi performa agar produk digital siap dipakai di dunia nyata.';

alter table public.site_settings
  add column if not exists created_at timestamptz;

alter table public.site_settings
  add column if not exists updated_at timestamptz;

alter table public.site_settings
  alter column created_at set default timezone('utc', now());

alter table public.site_settings
  alter column updated_at set default timezone('utc', now());

update public.site_settings
set
  created_at = coalesce(created_at, timezone('utc', now())),
  updated_at = coalesce(updated_at, timezone('utc', now()))
where created_at is null or updated_at is null;

alter table public.site_settings
  alter column created_at set not null;

alter table public.site_settings
  alter column updated_at set not null;

create or replace function public.set_site_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_site_settings_updated_at on public.site_settings;

create trigger trg_site_settings_updated_at
before update on public.site_settings
for each row
execute procedure public.set_site_settings_updated_at();

insert into public.site_settings (
  id,
  created_at,
  updated_at
)
values (
  'main',
  timezone('utc', now()),
  timezone('utc', now())
)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "Public read site_settings" on public.site_settings;
create policy "Public read site_settings"
  on public.site_settings
  for select
  using (true);

drop policy if exists "Authenticated insert site_settings" on public.site_settings;
create policy "Authenticated insert site_settings"
  on public.site_settings
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated update site_settings" on public.site_settings;
create policy "Authenticated update site_settings"
  on public.site_settings
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated delete site_settings" on public.site_settings;
create policy "Authenticated delete site_settings"
  on public.site_settings
  for delete
  to authenticated
  using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets',
  'site-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read site-assets" on storage.objects;
create policy "Public read site-assets"
  on storage.objects
  for select
  using (bucket_id = 'site-assets');

drop policy if exists "Authenticated upload site-assets" on storage.objects;
create policy "Authenticated upload site-assets"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'site-assets');

drop policy if exists "Authenticated update site-assets" on storage.objects;
create policy "Authenticated update site-assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'site-assets')
  with check (bucket_id = 'site-assets');

drop policy if exists "Authenticated delete site-assets" on storage.objects;
create policy "Authenticated delete site-assets"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'site-assets');
