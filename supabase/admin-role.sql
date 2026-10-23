-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor **ก่อน** เปิดให้ผู้ใช้ทั่วไปสมัครสมาชิก
-- เดิม policy ทุกตัวถือว่า "login แล้ว = ผู้ดูแล" (to authenticated using (true)) ซึ่งใช้ได้ตอนที่มีแต่
-- ผู้ดูแลเท่านั้นที่มีบัญชี แต่ระบบ "ของในบ้าน" เปิดให้ทุกคนสมัครได้ จึงต้องแยกผู้ดูแลออกมาเป็นตาราง app_admins
--
-- ⚠️ ก่อนรัน: แก้อีเมลในคำสั่ง insert ด้านล่างสุดให้เป็นอีเมลบัญชีผู้ดูแลของคุณ

create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app_admins enable row level security;

-- ผู้ใช้แต่ละคนเช็กได้ว่าตัวเองเป็นผู้ดูแลหรือไม่ (หน้า Admin ใช้) แต่ดูรายชื่อผู้ดูแลคนอื่นไม่ได้
create policy "Users can see their own admin row"
  on app_admins
  for select
  to authenticated
  using (user_id = auth.uid());

-- security definer: อ่าน app_admins ได้โดยไม่ติด RLS ของตารางนั้นเอง ใช้ใน policy ของตารางอื่น
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- ---------- products (เดิมจาก admin-policies.sql) ----------
drop policy if exists "Authenticated users can insert products" on products;
drop policy if exists "Authenticated users can update products" on products;
drop policy if exists "Authenticated users can delete products" on products;

create policy "Admins can insert products"
  on products for insert to authenticated
  with check (is_admin());

create policy "Admins can update products"
  on products for update to authenticated
  using (is_admin()) with check (is_admin());

create policy "Admins can delete products"
  on products for delete to authenticated
  using (is_admin());

-- ---------- product_submissions (เดิมจาก submissions.sql) ----------
drop policy if exists "Authenticated users can read submissions" on product_submissions;
drop policy if exists "Authenticated users can review submissions" on product_submissions;
drop policy if exists "Authenticated users can delete submissions" on product_submissions;

create policy "Admins can read submissions"
  on product_submissions for select to authenticated
  using (is_admin());

create policy "Admins can review submissions"
  on product_submissions for update to authenticated
  using (is_admin()) with check (is_admin());

create policy "Admins can delete submissions"
  on product_submissions for delete to authenticated
  using (is_admin());

-- ---------- storage (เดิมจาก submission-edits.sql) ----------
drop policy if exists "Authenticated users can delete submission images" on storage.objects;

create policy "Admins can delete submission images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'submission-images' and is_admin());

-- ---------- กำหนดผู้ดูแล ----------
-- แก้อีเมลให้ตรงกับบัญชีผู้ดูแลที่สร้างไว้ใน Authentication > Users
insert into app_admins (user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL@example.com'
on conflict (user_id) do nothing;
