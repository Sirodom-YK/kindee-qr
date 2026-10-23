// เข้าถึงข้อมูลสินค้าจาก Supabase จริง (แทนที่ mock data ของขั้นที่ 1)
// โค้ดหน้าอื่น ๆ ยังเรียกใช้ผ่าน getAllProducts()/getProductById() เหมือนเดิม
// จึงไม่ต้องแก้ไข home.js หรือ product-detail.js เลย

async function getAllProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("getAllProducts error:", error.message);
    return [];
  }
  return data;
}

async function getProductById(id) {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getProductById error:", error.message);
    return null;
  }
  return data;
}

async function getProductByQrCodeValue(qrCodeValue) {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("qr_code_value", qrCodeValue)
    .maybeSingle();

  if (error) {
    console.error("getProductByQrCodeValue error:", error.message);
    return null;
  }
  return data;
}

async function getProductByBarcode(barcode) {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("barcode", barcode)
    .maybeSingle();

  if (error) {
    console.error("getProductByBarcode error:", error.message);
    return null;
  }
  return data;
}

// ค้นหาสินค้าจากค่าที่สแกนได้จาก QR Code — ลองจับคู่กับ qr_code_value ก่อน
// แล้วค่อยลอง barcode (เผื่อ QR Code บางอันเก็บแค่เลขบาร์โค้ด)
async function findProductByScannedValue(scannedValue) {
  const byQrCode = await getProductByQrCodeValue(scannedValue);
  if (byQrCode) return byQrCode;
  return await getProductByBarcode(scannedValue);
}

// ค้นหาสินค้าด้วยชื่อหรือแบรนด์แบบไม่สนตัวพิมพ์เล็ก-ใหญ่ (ใช้โดยหน้าค้นหา
// และตอนอ่านข้อความจากภาพฉลาก) — คืนค่าเป็นรายการที่ "อาจตรงกัน" ไม่ใช่การยืนยัน
// ว่าใช่สินค้าเดียวกัน ผู้ใช้ต้องเลือกยืนยันเองจากรายการ
async function searchProductsByText(query) {
  // ตัดอักขระที่มีความหมายพิเศษใน PostgREST filter (,()%) ออกก่อน ป้องกัน query พัง
  const sanitized = query.replace(/[,()%]/g, " ").trim();
  if (!sanitized) return [];

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .or(`name.ilike.%${sanitized}%,brand.ilike.%${sanitized}%`)
    .limit(10);

  if (error) {
    console.error("searchProductsByText error:", error.message);
    return [];
  }
  return data;
}

// บาร์โค้ดสินค้าทั่วไป (EAN-8, UPC-A, EAN-13, GTIN-14) เป็นตัวเลข 8-14 หลัก
function isLikelyBarcode(value) {
  return /^\d{8,14}$/.test(value.trim());
}

// ลิงก์ไปหน้าส่งข้อมูลสินค้า (submit.html) พร้อมเติมบาร์โค้ด/ชื่อที่รู้อยู่แล้ว
// ใช้ตอนสแกน/ค้นหาแล้วไม่พบข้อมูล ข้อมูลยังไม่ครบ หรือเสนอแก้ไข (ส่ง productId ของสินค้าในระบบ)
// — ข้อมูลที่ส่งต้องรอผู้ดูแลอนุมัติก่อนแสดงเสมอ
function getSubmitProductUrl(barcode, name, productId) {
  const params = new URLSearchParams();
  if (productId) params.set("id", productId);
  if (barcode) params.set("barcode", barcode);
  if (name) params.set("name", name);
  const query = params.toString();
  return query ? `submit.html?${query}` : "submit.html";
}
