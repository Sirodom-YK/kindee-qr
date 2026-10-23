-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor เพื่อเปิดสิทธิ์เพิ่ม/แก้ไข/ลบสินค้า
-- ให้เฉพาะผู้ใช้ที่ "login แล้ว" เท่านั้น (เช่น ผู้ดูแลระบบที่ login ผ่านหน้า admin.html)
-- ผู้ใช้ทั่วไปที่ไม่ได้ login ยังคง "อ่าน" ข้อมูลได้อย่างเดียวตามเดิม (ดู public-read policy ใน schema.sql)

create policy "Authenticated users can insert products"
  on products
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update products"
  on products
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete products"
  on products
  for delete
  to authenticated
  using (true);
