-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor (หลัง schema.sql และ admin-policies.sql)
-- ตารางเก็บข้อมูลสินค้าที่ "ผู้ใช้ทั่วไป" ส่งเข้ามาเมื่อสแกนแล้วไม่พบข้อมูล
-- ข้อมูลในตารางนี้จะ "ไม่ถูกแสดงบนเว็บ" จนกว่าผู้ดูแลจะตรวจและอนุมัติ ซึ่งตอนอนุมัติ
-- ผู้ดูแลจะคัดลอก/แก้ไขข้อมูลลงตาราง products เอง (ดู js/admin.js) — หน้าเว็บอ่านจาก products เท่านั้น

create table if not exists product_submissions (
  id uuid primary key default gen_random_uuid(),
  barcode text check (char_length(barcode) <= 64),
  name text not null check (char_length(name) between 1 and 200),
  brand text check (char_length(brand) <= 200),
  category text check (category in ('packaged', 'snack', 'beverage', 'vegetable', 'fruit', 'other')),
  ingredients text check (char_length(ingredients) <= 4000),
  allergens text check (char_length(allergens) <= 1000),
  nutrition jsonb check (nutrition is null or pg_column_size(nutrition) <= 2000),
  usage_instructions text check (char_length(usage_instructions) <= 2000),
  warnings text check (char_length(warnings) <= 2000),
  note text check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  product_id uuid references products(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists product_submissions_status_idx
  on product_submissions (status, created_at);

alter table product_submissions enable row level security;

-- ผู้ใช้ทั่วไป (anon) และผู้ดูแลส่งข้อมูลได้ แต่บังคับให้เป็นสถานะ pending เท่านั้น
-- กันไม่ให้ใครส่งข้อมูลที่ "อนุมัติตัวเอง" เข้ามา
create policy "Anyone can submit pending products"
  on product_submissions
  for insert
  to anon, authenticated
  with check (status = 'pending' and product_id is null and reviewed_at is null);

-- ไม่มี policy select ให้ anon — ผู้ใช้ทั่วไปส่งได้อย่างเดียว อ่านข้อมูลที่คนอื่นส่งไม่ได้
create policy "Authenticated users can read submissions"
  on product_submissions
  for select
  to authenticated
  using (true);

create policy "Authenticated users can review submissions"
  on product_submissions
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete submissions"
  on product_submissions
  for delete
  to authenticated
  using (true);
