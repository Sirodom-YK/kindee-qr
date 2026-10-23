-- รันหลัง schema.sql (หรือ migrate-food.sql) เพื่อเพิ่มสินค้าตัวอย่าง (ไม่บังคับ แต่แนะนำให้รันเพื่อทดสอบ)
-- ข้อมูลทั้งหมดเป็นสินค้าสมมติเพื่อทดสอบระบบ บาร์โค้ดไม่ใช่ของสินค้าจริง

insert into products
  (name, brand, barcode, qr_code_value, image_url, category, product_type, ingredients, allergens, nutrition, usage_instructions, warnings, source_url)
values
  (
    'มันฝรั่งทอดกรอบ รสเกลือ', 'CrispyDee', '8850123456781', 'KINDEE-0001',
    'assets/images/placeholder-product.svg', 'snack', 'ขนมขบเคี้ยว',
    'มันฝรั่ง 65%, น้ำมันปาล์ม, เกลือ',
    null,
    '{"energy_kcal": 536, "protein_g": 6.6, "fat_g": 34, "carbohydrates_g": 52, "sugars_g": 0.5, "fiber_g": 4.4, "sodium_mg": 520}',
    'เก็บในที่แห้งและเย็น หลีกเลี่ยงแสงแดด เปิดแล้วควรรับประทานให้หมดภายในวันเดียว',
    'ผลิตในสถานที่เดียวกับที่ผลิตผลิตภัณฑ์ที่มีถั่วลิสง',
    'https://example.com/crispydee-salted'
  ),
  (
    'นมยูเอชที รสจืด', 'FarmFresh', '8850123456798', 'KINDEE-0002',
    'assets/images/placeholder-product.svg', 'beverage', 'นม',
    'นมโคสด 100%',
    'นม',
    '{"energy_kcal": 63, "protein_g": 3.2, "fat_g": 3.5, "carbohydrates_g": 4.8, "sugars_g": 4.8, "sodium_mg": 45}',
    'เก็บที่อุณหภูมิห้อง เปิดแล้วเก็บในตู้เย็นและดื่มให้หมดภายใน 2 วัน',
    null,
    'https://example.com/farmfresh-uht'
  ),
  (
    'ขนมปังโฮลวีต', 'BakeHouse', '8850123456804', 'KINDEE-0003',
    'assets/images/placeholder-product.svg', 'packaged', 'ขนมปัง',
    'แป้งสาลีโฮลวีต, น้ำ, ยีสต์, น้ำตาล, เนยขาว, เกลือ',
    'กลูเตน (ข้าวสาลี)',
    '{"energy_kcal": 247, "protein_g": 13, "fat_g": 3.4, "carbohydrates_g": 41, "sugars_g": 5.6, "fiber_g": 7, "sodium_mg": 450}',
    'เก็บในที่แห้ง ปิดถุงให้สนิทหลังเปิด',
    'อาจมีส่วนผสมของนมและไข่',
    'https://example.com/bakehouse-wholewheat'
  ),
  (
    'ผักกาดหอมคอส (บรรจุถุง)', 'GreenFarm', '8850123456811', 'KINDEE-0004',
    'assets/images/placeholder-product.svg', 'vegetable', 'ผักสด',
    'ผักกาดหอมคอส 100%',
    null,
    '{"energy_kcal": 17, "protein_g": 1.2, "fat_g": 0.3, "carbohydrates_g": 3.3, "sugars_g": 1.2, "fiber_g": 2.1, "sodium_mg": 8}',
    'เก็บในตู้เย็น 2-6°C ล้างให้สะอาดก่อนรับประทาน',
    null,
    'https://example.com/greenfarm-cos'
  ),
  (
    'กล้วยหอมทอง (หวี)', 'GreenFarm', null, 'KINDEE-0005',
    'assets/images/placeholder-product.svg', 'fruit', 'ผลไม้สด',
    'กล้วยหอมทอง',
    null,
    '{"energy_kcal": 89, "protein_g": 1.1, "fat_g": 0.3, "carbohydrates_g": 22.8, "sugars_g": 12.2, "fiber_g": 2.6, "sodium_mg": 1}',
    'เก็บที่อุณหภูมิห้อง ไม่ควรแช่ตู้เย็นก่อนสุก',
    null,
    'https://example.com/greenfarm-banana'
  );
