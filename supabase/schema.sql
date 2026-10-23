-- รันในหน้า Supabase Dashboard > SQL Editor ของโปรเจกต์คุณ (รันครั้งเดียว)

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  barcode text unique,
  qr_code_value text unique,
  image_url text,
  product_type text,
  -- packaged / snack / beverage / vegetable / fruit / other
  category text,
  ingredients text,
  allergens text,
  -- ค่าโภชนาการต่อ 100 กรัม เช่น {"energy_kcal": 89, "protein_g": 1.1, "sodium_mg": 1}
  nutrition jsonb,
  -- ค่าจาก Open Food Facts (a-e และ 1-4) ไม่ได้คำนวณเอง
  nutriscore_grade text,
  nova_group int,
  -- วิธีเก็บรักษา/รับประทาน (ชื่อคอลัมน์เดิมจากสมัยเป็นระบบเครื่องสำอาง)
  usage_instructions text,
  warnings text,
  source_url text,
  updated_at timestamptz not null default now()
);

-- เปิดใช้งาน Row Level Security (RLS) — จำเป็นมาก ป้องกันไม่ให้ใครแก้ไข/ลบข้อมูลผ่าน anon key
alter table products enable row level security;

-- อนุญาตให้ "อ่าน" ข้อมูลสินค้าได้จากทุกที่ (จำเป็นเพราะเว็บไซต์นี้ให้ผู้ใช้ทั่วไปดูข้อมูลสินค้าได้โดยไม่ต้อง login)
create policy "Public read access"
  on products
  for select
  using (true);

-- หมายเหตุ: ยังไม่เปิด insert/update/delete ให้ใคร (ขั้นที่ 6 Admin จะเพิ่ม policy
-- สำหรับผู้ดูแลระบบที่ login แล้วเท่านั้น) ตอนนี้ถ้าต้องการเพิ่ม/แก้ไขข้อมูล ให้ทำผ่าน
-- Supabase Dashboard > Table Editor โดยตรง
