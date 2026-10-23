-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor หลัง submissions.sql
-- เพิ่ม 2 อย่างให้ระบบข้อมูลจากผู้ใช้:
--   1. รูปสินค้า — ใช้รูปเดิมของสินค้า หรือผู้ใช้อัปโหลดรูปใหม่ (เก็บใน Storage bucket "submission-images")
--   2. การเสนอแก้ไขสินค้าที่มีอยู่แล้ว (kind = 'edit' + target_product_id) — ยังต้องรอผู้ดูแลอนุมัติเหมือนเดิม

alter table product_submissions
  add column if not exists image_url text check (char_length(image_url) <= 1000);

alter table product_submissions
  add column if not exists kind text not null default 'new' check (kind in ('new', 'edit'));

-- สินค้าในระบบที่ผู้ใช้เสนอแก้ไข (null = สินค้าใหม่ หรือสินค้าจาก Open Food Facts ที่ยังไม่มีในระบบ)
alter table product_submissions
  add column if not exists target_product_id uuid references products(id) on delete set null;

-- Storage bucket สำหรับรูปที่ผู้ใช้อัปโหลด: จำกัด 2MB และเฉพาะไฟล์รูป
-- เป็น public bucket เพื่อให้หน้า Admin และหน้าเว็บ (หลังอนุมัติ) แสดงรูปได้ด้วย URL ตรง
-- ชื่อไฟล์เป็น UUID สุ่ม จึงไม่มีใครเดาหรือไล่ดูรูปที่ยังไม่อนุมัติได้ (ไม่มี policy ให้ list ไฟล์)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-images', 'submission-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ใครก็อัปโหลดเข้า bucket นี้ได้ (แต่แก้ไข/ลบ/ทับไฟล์เดิมไม่ได้)
create policy "Anyone can upload submission images"
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'submission-images');

-- ผู้ดูแลลบรูปของข้อมูลที่ถูกปฏิเสธได้
create policy "Authenticated users can delete submission images"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'submission-images');
