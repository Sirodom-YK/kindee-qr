// เรียกใช้ Gemini ผ่าน Supabase Edge Function "gemini-proxy" เท่านั้น
// ไม่มี Gemini API Key อยู่ในไฟล์ฝั่งผู้ใช้เลย — คีย์ถูกเก็บเป็น secret ฝั่งเซิร์ฟเวอร์
async function callGeminiAction(action, text) {
  const { data, error } = await supabaseClient.functions.invoke("gemini-proxy", {
    body: { action, text },
  });

  if (error) {
    console.error("callGeminiAction error:", error.message);
    return { ok: false, error: "เรียกใช้ AI ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  if (data?.error) {
    console.error("callGeminiAction server error:", data.error);
    return { ok: false, error: data.error };
  }

  return { ok: true, result: data.result };
}

// ส่งภาพไปให้ Gemini อ่านตัวอักษรบนฉลาก หรือระบุชนิดผัก/ผลไม้สดถ้าไม่มีบรรจุภัณฑ์
// คืนค่า { is_packaged, product_name, brand, barcode, produce_name_th, produce_name_en, confidence }
// โดยฟิลด์ที่อ่านไม่ได้จะเป็น null
async function readLabelImage(base64Data, mimeType) {
  return await callGeminiImageAction("read_label_image", base64Data, mimeType);
}

// อ่านวันที่บนฉลาก (ระบบของในบ้าน) — คืน { dates: [{ kind, raw_text, day, month, year }] }
// ปียังเป็นตัวเลขตามที่พิมพ์ (อาจเป็น พ.ศ./ปี 2 หลัก) ให้แปลงด้วย interpretExpiryCandidates() ใน js/expiry-date.js
async function readExpiryDate(base64Data, mimeType) {
  return await callGeminiImageAction("read_expiry_date", base64Data, mimeType);
}

async function callGeminiImageAction(action, base64Data, mimeType) {
  const { data, error } = await supabaseClient.functions.invoke("gemini-proxy", {
    body: { action, image: { data: base64Data, mimeType } },
  });

  if (error) {
    console.error(`${action} error:`, error.message);
    return { ok: false, error: "เรียกใช้ AI ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  if (data?.error) {
    console.error(`${action} server error:`, data.error);
    return { ok: false, error: data.error };
  }

  return { ok: true, result: data.result };
}

// ค้นหาข้อมูลโภชนาการของวัตถุดิบสด (ชื่อภาษาอังกฤษ เช่น "banana") จาก USDA FoodData Central
// ผ่าน edge function เพื่อไม่ให้ USDA API key อยู่ในโค้ดฝั่งผู้ใช้ — คืน result เป็น null ถ้าไม่พบ
async function searchUsdaFood(nameEn) {
  return await callGeminiAction("usda_search", nameEn);
}
