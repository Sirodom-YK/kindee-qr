-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor สำหรับโปรเจกต์ที่สร้างตาราง products ไว้แล้ว
-- (สมัยยังเป็น BeautiQR) เพื่อเปลี่ยนเป็นระบบข้อมูลอาหาร KinDee QR
-- ถ้าสร้างโปรเจกต์ใหม่ ให้รัน schema.sql แทน ไม่ต้องรันไฟล์นี้

alter table products add column if not exists category text;
alter table products add column if not exists allergens text;
alter table products add column if not exists nutrition jsonb;
alter table products add column if not exists nutriscore_grade text;
alter table products add column if not exists nova_group int;

-- ลบข้อมูลเครื่องสำอางเดิมทั้งหมด แล้วค่อยรัน seed.sql เพื่อเพิ่มสินค้าอาหารตัวอย่าง
delete from products;
