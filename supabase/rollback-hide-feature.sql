-- Roll back the temporary hide/show feature changes.
-- Safe to run multiple times.

alter table public.projects enable row level security;
alter table public.blog_posts enable row level security;

drop policy if exists "Authenticated read projects" on public.projects;
drop policy if exists "Authenticated read blog_posts" on public.blog_posts;

drop policy if exists "Public read projects" on public.projects;
create policy "Public read projects"
  on public.projects
  for select
  using (true);

drop policy if exists "Public read blog_posts" on public.blog_posts;
create policy "Public read blog_posts"
  on public.blog_posts
  for select
  using (true);

alter table public.projects
  drop column if exists is_visible;

alter table public.blog_posts
  drop column if exists is_visible;
