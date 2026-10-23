// Supabase Edge Function (Deno) — ตัวกลางเรียก Gemini API
// เหตุผล: Gemini API Key ต้องเก็บไว้ฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามฝังในโค้ดฝั่งผู้ใช้
// ฟังก์ชันนี้รับคำสั่ง (action) + ข้อความ/รูปภาพจากเว็บไซต์ แล้วค่อยเรียก Gemini ด้วยคีย์ลับที่
// เก็บไว้เป็น Supabase secret (ตั้งค่าด้วย `supabase secrets set GEMINI_API_KEY=...`)
//
// หน้าที่ของ Gemini ในระบบนี้คือ "แปล" "อธิบาย" และ "อ่านข้อความจากภาพฉลาก" เท่านั้น
// ห้ามให้ Gemini แต่งเติมส่วนประกอบ/ค่าโภชนาการ/คำเตือน/ชื่อสินค้าที่ไม่มีอยู่ในข้อความหรือภาพต้นฉบับ
// และห้ามใช้ยืนยันความแท้หรือความปลอดภัยของสินค้า — พรอมป์ด้านล่างกำกับไว้อย่างชัดเจน
// การอ่านฉลากจะคืนแค่ "ข้อความที่อ่านได้" ส่วนการจับคู่กับสินค้าจริงเป็นหน้าที่ของฝั่งเว็บ
// ที่ค้นหาในฐานข้อมูลต่อ ไม่ใช่การจับคู่จากความคล้ายของภาพ
// ยกเว้นผักผลไม้สดที่ไม่มีฉลาก — Gemini จะ "คาดว่า" เป็นชนิดใด แล้วให้ผู้ใช้ยืนยันเองก่อนดูข้อมูล
//
// action "usda_search" ไม่ได้เรียก Gemini แต่เป็นตัวกลางเรียก USDA FoodData Central เพื่อซ่อน API key
// (ตั้งค่าด้วย `supabase secrets set USDA_API_KEY=...` ขอคีย์ฟรีที่ https://api.data.gov/signup/)
// action "off_search" ก็ไม่ได้เรียก Gemini — บริการค้นหาของ Open Food Facts ไม่เปิด CORS ให้เว็บอื่น
// เบราวเซอร์จึงเรียกตรงไม่ได้ ต้องผ่านตัวกลางนี้ (ส่วน API ค้นด้วยบาร์โค้ดเปิด CORS อยู่แล้ว เรียกตรงจากเว็บได้)

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// เปลี่ยนชื่อโมเดลได้ตามรุ่นที่คุณใช้งานได้จริงใน Google AI Studio
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ถ้ายังไม่ได้ตั้ง USDA_API_KEY จะใช้ DEMO_KEY ซึ่งจำกัดแค่ 30 ครั้ง/ชั่วโมง พอสำหรับทดลองเท่านั้น
const USDA_API_KEY = Deno.env.get("USDA_API_KEY") || "DEMO_KEY";
const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const MAX_QUERY_LENGTH = 100;

const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
const OFF_SEARCH_FIELDS = "code,product_name,product_name_th,brands,image_front_url,categories";
// Open Food Facts ขอให้ทุกแอประบุชื่อตัวเองใน User-Agent
const OFF_USER_AGENT = "KinDeeQR/1.0 (student project)";

const MAX_INPUT_LENGTH = 4000;
const MAX_IMAGE_BASE64_LENGTH = 6_000_000; // ~4.4MB ไฟล์จริง กันไม่ให้ส่งรูปใหญ่เกินจำเป็น
const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const PROMPT_BUILDERS: Record<string, (text: string) => string> = {
  explain_ingredients: (text) =>
    `คุณเป็นผู้ช่วยอธิบายข้อมูลผลิตภัณฑ์อาหารให้คนทั่วไปเข้าใจง่าย หน้าที่ของคุณคือ "อธิบาย" ความหมายของส่วนประกอบต่อไปนี้เป็นภาษาไทยเท่านั้น ` +
    `แม้ข้อความจะสั้นหรือมีส่วนประกอบเพียงรายการเดียว ก็ให้อธิบายรายการที่มีอยู่ตามจริง ` +
    `ห้ามเพิ่มส่วนประกอบที่ไม่มีอยู่ในข้อความ ห้ามประเมินหรือสรุปว่าปลอดภัยหรือไม่ปลอดภัย ห้ามยืนยันว่าสินค้าเป็นของแท้หรือไม่ ` +
    `ให้ตอบว่า "ไม่สามารถอธิบายได้เนื่องจากข้อมูลไม่เพียงพอ" เฉพาะกรณีที่ข้อความด้านล่างไม่มีชื่อส่วนประกอบอยู่เลยเท่านั้น\n\nส่วนประกอบ:\n${text}`,
  summarize_nutrition: (text) =>
    `คุณเป็นผู้ช่วยอธิบายข้อมูลโภชนาการให้คนทั่วไปเข้าใจง่ายเป็นภาษาไทย ข้อความด้านล่างเป็นค่าโภชนาการต่อ 100 กรัมที่มีอยู่แล้วในระบบของเรา ` +
    `ให้สรุปและอธิบายความหมายของค่าที่มีอยู่จริงเท่านั้น ห้ามเพิ่มสารอาหารหรือตัวเลขที่ไม่มีอยู่ในข้อความ ` +
    `ห้ามให้คำแนะนำทางการแพทย์ ห้ามสรุปว่าอาหารนี้ดีหรือไม่ดีต่อสุขภาพของผู้อ่าน และห้ามยืนยันว่าสินค้าปลอดภัยหรือเป็นของแท้ ` +
    `ให้ตอบว่า "ไม่สามารถสรุปได้เนื่องจากข้อมูลไม่เพียงพอ" เฉพาะกรณีที่ข้อความด้านล่างไม่มีค่าโภชนาการอยู่เลยเท่านั้น\n\nข้อมูลโภชนาการ:\n${text}`,
  translate_to_thai: (text) =>
    `แปลข้อความต่อไปนี้เป็นภาษาไทยที่เข้าใจง่าย คงความหมายเดิมให้ครบถ้วนที่สุด ห้ามเพิ่มหรือตัดข้อมูลออกจากต้นฉบับ:\n\n${text}`,
  translate_to_english: (text) =>
    `Translate the following text into clear, simple English. Preserve the original meaning as completely as possible. Do not add or omit information:\n\n${text}`,
};

// ใช้ภาพเดียวทั้งอ่านฉลากสินค้าแพ็กเกจและระบุชนิดผักผลไม้สด เพื่อให้เรียก Gemini แค่ครั้งเดียวต่อภาพ
const LABEL_IMAGE_PROMPT =
  `ภาพนี้อาจเป็นฉลาก/บรรจุภัณฑ์ของสินค้าอาหาร ขนม หรือเครื่องดื่ม หรืออาจเป็นผัก ผลไม้ หรือวัตถุดิบสดที่ไม่มีบรรจุภัณฑ์ ` +
  `ตอบกลับเป็น JSON รูปแบบนี้เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON และห้ามใส่ markdown code block:\n` +
  `{"is_packaged": true ถ้าเป็นสินค้าที่มีบรรจุภัณฑ์/ฉลาก หรือ false ถ้าเป็นผัก ผลไม้ หรือวัตถุดิบสด, ` +
  `"product_name": "ชื่อสินค้าที่อ่านได้ชัดเจนจากฉลาก หรือ null ถ้าอ่านไม่ได้", ` +
  `"brand": "ชื่อแบรนด์ที่อ่านได้ชัดเจนจากฉลาก หรือ null ถ้าอ่านไม่ได้", ` +
  `"barcode": "เลขบาร์โค้ดที่อ่านได้ชัดเจน (ตัวเลขเท่านั้น) หรือ null ถ้าไม่มี/อ่านไม่ได้", ` +
  `"produce_name_th": "ชื่อภาษาไทยของผัก/ผลไม้สดในภาพ หรือ null ถ้าเป็นสินค้ามีบรรจุภัณฑ์", ` +
  `"produce_name_en": "ชื่อภาษาอังกฤษทั่วไปของผัก/ผลไม้นั้นเป็นคำนามสั้น ๆ เช่น banana, cabbage หรือ null", ` +
  `"confidence": "high" หรือ "medium" หรือ "low" ตามความมั่นใจในการระบุชนิดผัก/ผลไม้}\n` +
  `สำหรับฉลาก ห้ามเดาหรือแต่งข้อความที่อ่านจากภาพไม่ได้ชัดเจน ให้ใส่ null สำหรับฟิลด์ที่ไม่แน่ใจ ห้ามประเมินว่าสินค้านี้ปลอดภัยหรือเป็นของแท้`;

// อ่านวันที่บนฉลาก (ระบบของในบ้าน) — ให้ Gemini คัดลอก "ตัวเลขตามที่เห็น" เท่านั้น ไม่ต้องแปลงปี
// การแปลง พ.ศ./ค.ศ. และปี 2 หลัก ทำฝั่งเว็บ (js/expiry-date.js) ที่ทดสอบได้ และให้ผู้ใช้ยืนยันทุกครั้ง
const EXPIRY_IMAGE_PROMPT =
  `อ่านวันที่ทั้งหมดที่พิมพ์อยู่บนฉลาก/บรรจุภัณฑ์ในภาพนี้ (เช่น วันหมดอายุ ควรบริโภคก่อน วันผลิต) ` +
  `แล้วตอบกลับเป็น JSON รูปแบบนี้เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON และห้ามใส่ markdown code block:\n` +
  `{"dates": [{"kind": "exp" ถ้าเป็นวันหมดอายุ (EXP, หมดอายุ, ใช้ได้ถึง) หรือ "bbe" ถ้าเป็นควรบริโภคก่อน (BBE, Best before, ควรบริโภคก่อน) ` +
  `หรือ "mfg" ถ้าเป็นวันผลิต (MFG, ผลิต) หรือ "unknown" ถ้าไม่มีป้ายกำกับ, ` +
  `"raw_text": "ข้อความวันที่ตามที่เห็นในภาพทุกตัวอักษร", "day": ตัวเลขวัน หรือ null, "month": ตัวเลขเดือน 1-12 หรือ null, ` +
  `"year": ตัวเลขปีตามที่พิมพ์จริง (เช่น 2569, 2026, 69, 26) ห้ามแปลง พ.ศ./ค.ศ. เอง}]}\n` +
  `ถ้าเดือนเป็นตัวอักษร (เช่น JUN, มิ.ย.) ให้แปลงเป็นตัวเลขเดือน ถ้าอ่านตัวเลขใดไม่ชัดให้ใส่ null ห้ามเดา ` +
  `ถ้าไม่พบวันที่เลยให้ตอบ {"dates": []}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callGemini(parts: Record<string, unknown>[]) {
  return await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseLabelJson(text: string) {
  // Gemini บางครั้งห่อ JSON ด้วย ```json ... ``` ต้องตัดออกก่อนแปลง
  const cleaned = text.replace(/```json|```/g, "").trim();
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(cleaned);
  } catch {
    // แปลงไม่ได้ → ทุกฟิลด์เป็น null ฝั่งเว็บจะแจ้งว่าอ่านภาพไม่สำเร็จ
  }
  return {
    is_packaged: obj.is_packaged !== false,
    product_name: stringOrNull(obj.product_name),
    brand: stringOrNull(obj.brand),
    barcode: stringOrNull(obj.barcode),
    produce_name_th: stringOrNull(obj.produce_name_th),
    produce_name_en: stringOrNull(obj.produce_name_en),
    confidence: ["high", "medium", "low"].includes(obj.confidence as string)
      ? obj.confidence
      : "low",
  };
}

type ImageInput = { data?: string; mimeType?: string };

// ตรวจรูป → ส่งให้ Gemini พร้อมพรอมป์ → แปลงคำตอบด้วย parse (ใช้ทั้ง read_label_image และ read_expiry_date)
async function handleImageAction(
  action: string,
  image: ImageInput | undefined,
  prompt: string,
  parse: (text: string) => unknown
) {
  if (!image?.data || !image?.mimeType) {
    return jsonResponse({ error: "ไม่มีรูปภาพให้ประมวลผล" }, 400);
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType)) {
    return jsonResponse({ error: "รองรับเฉพาะไฟล์รูปภาพ JPEG, PNG, WEBP" }, 400);
  }

  if (image.data.length > MAX_IMAGE_BASE64_LENGTH) {
    return jsonResponse({ error: "ไฟล์รูปภาพใหญ่เกินไป" }, 400);
  }

  try {
    const geminiRes = await callGemini([
      { text: prompt },
      { inlineData: { mimeType: image.mimeType, data: image.data } },
    ]);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`Gemini API error (${action}):`, errText);
      return jsonResponse({ error: "เรียก Gemini API ไม่สำเร็จ" }, 502);
    }

    const geminiJson = await geminiRes.json();
    const outputText: string | undefined =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!outputText) {
      return jsonResponse({ error: "ไม่ได้รับคำตอบจาก AI" }, 502);
    }

    return jsonResponse({ result: parse(outputText) });
  } catch (e) {
    console.error(`gemini-proxy ${action} error:`, e);
    return jsonResponse({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อ AI" }, 500);
  }
}

function intOrNull(value: unknown, min: number, max: number) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function parseExpiryJson(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  let obj: { dates?: unknown } = {};
  try {
    obj = JSON.parse(cleaned);
  } catch {
    // แปลงไม่ได้ → ไม่มีวันที่ ฝั่งเว็บจะให้ผู้ใช้กรอกเอง
  }
  const dates = Array.isArray(obj.dates) ? obj.dates.slice(0, 5) : [];
  return {
    dates: dates.map((d: Record<string, unknown>) => ({
      kind: ["exp", "bbe", "mfg"].includes(d?.kind as string) ? d.kind : "unknown",
      raw_text: (stringOrNull(d?.raw_text) || "").slice(0, 60),
      day: intOrNull(d?.day, 1, 31),
      month: intOrNull(d?.month, 1, 12),
      year: intOrNull(d?.year, 0, 2700),
    })),
  };
}

// nutrientId ของ USDA FoodData Central → ฟิลด์ nutrition ของระบบเรา (ต่อ 100 กรัม)
// (ต้องใช้ nutrientId ไม่ใช่ nutrientNumber ซึ่งเป็นรหัสเก่าแบบ 3 หลัก เช่น "203")
// น้ำตาลมี 2 รหัสตามชุดข้อมูล (2000 / 1063) และพลังงานมีหลายรหัส (1008 = Energy,
// 2047/2048 = Atwater ใน Foundation) จึงเลือกตัวแรกที่เจอ และสำหรับพลังงานต้องเป็นหน่วย kcal
const USDA_NUTRIENT_MAP: Record<number, string> = {
  1003: "protein_g",
  1004: "fat_g",
  1005: "carbohydrates_g",
  2000: "sugars_g",
  1063: "sugars_g",
  1079: "fiber_g",
  1093: "sodium_mg",
};
const USDA_ENERGY_IDS = [1008, 2047, 2048];

type UsdaNutrient = { nutrientId?: number; unitName?: string; value?: number };

function mapUsdaNutrients(foodNutrients: UsdaNutrient[] = []) {
  const nutrition: Record<string, number> = {};
  for (const n of foodNutrients) {
    if (typeof n.value !== "number" || typeof n.nutrientId !== "number") continue;
    const key = USDA_NUTRIENT_MAP[n.nutrientId];
    if (key && nutrition[key] === undefined) nutrition[key] = n.value;
    if (
      USDA_ENERGY_IDS.includes(n.nutrientId) &&
      n.unitName?.toUpperCase() === "KCAL" &&
      nutrition.energy_kcal === undefined
    ) {
      nutrition.energy_kcal = n.value;
    }
  }
  return nutrition;
}

async function handleUsdaSearch(query?: string) {
  if (typeof query !== "string" || query.trim() === "") {
    return jsonResponse({ error: "ไม่มีชื่ออาหารให้ค้นหา" }, 400);
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return jsonResponse({ error: "ชื่ออาหารยาวเกินไป" }, 400);
  }

  const params = new URLSearchParams({
    api_key: USDA_API_KEY,
    query: `${query.trim()} raw`,
    // Foundation และ SR Legacy คือข้อมูลวัตถุดิบ/อาหารสดที่วัดจากห้องแล็บ ไม่ใช่สินค้าแบรนด์
    dataType: "Foundation,SR Legacy",
    pageSize: "5",
  });

  try {
    const res = await fetch(`${USDA_SEARCH_URL}?${params}`);
    if (!res.ok) {
      console.error("USDA API error:", res.status, await res.text());
      return jsonResponse({ error: "เรียก USDA FoodData Central ไม่สำเร็จ" }, 502);
    }

    const json = await res.json();
    const food = json?.foods?.[0];
    if (!food) {
      return jsonResponse({ result: null });
    }

    return jsonResponse({
      result: {
        fdc_id: food.fdcId,
        description: food.description,
        nutrition: mapUsdaNutrients(food.foodNutrients),
        source_url: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
        updated_at: food.publishedDate || null,
      },
    });
  } catch (e) {
    console.error("gemini-proxy usda_search error:", e);
    return jsonResponse({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อ USDA" }, 500);
  }
}

async function handleOffSearch(query?: string) {
  if (typeof query !== "string" || query.trim() === "") {
    return jsonResponse({ error: "ไม่มีคำค้นหา" }, 400);
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return jsonResponse({ error: "คำค้นหายาวเกินไป" }, 400);
  }

  const params = new URLSearchParams({
    q: query.trim(),
    page_size: "10",
    fields: OFF_SEARCH_FIELDS,
  });

  try {
    const res = await fetch(`${OFF_SEARCH_URL}?${params}`, {
      headers: { "User-Agent": OFF_USER_AGENT },
    });
    if (!res.ok) {
      console.error("Open Food Facts search error:", res.status, await res.text());
      return jsonResponse({ error: "ค้นหาใน Open Food Facts ไม่สำเร็จ" }, 502);
    }

    const json = await res.json();
    return jsonResponse({ result: json?.hits ?? [] });
  } catch (e) {
    console.error("gemini-proxy off_search error:", e);
    return jsonResponse({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อ Open Food Facts" }, 500);
  }
}

async function handleTextAction(action: string, text?: string) {
  if (typeof text !== "string" || text.trim() === "") {
    return jsonResponse({ error: "ไม่มีข้อความให้ประมวลผล" }, 400);
  }

  if (text.length > MAX_INPUT_LENGTH) {
    return jsonResponse({ error: "ข้อความยาวเกินไป" }, 400);
  }

  const buildPrompt = PROMPT_BUILDERS[action];
  if (!buildPrompt) {
    return jsonResponse({ error: "ไม่รู้จักคำสั่งนี้" }, 400);
  }

  try {
    const geminiRes = await callGemini([{ text: buildPrompt(text) }]);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", errText);
      return jsonResponse({ error: "เรียก Gemini API ไม่สำเร็จ" }, 502);
    }

    const geminiJson = await geminiRes.json();
    const outputText: string | undefined =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!outputText) {
      return jsonResponse({ error: "ไม่ได้รับคำตอบจาก AI" }, 502);
    }

    return jsonResponse({ result: outputText });
  } catch (e) {
    console.error("gemini-proxy error:", e);
    return jsonResponse({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อ AI" }, 500);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: {
    action?: string;
    text?: string;
    image?: { data?: string; mimeType?: string };
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "รูปแบบคำขอไม่ถูกต้อง" }, 400);
  }

  const { action, text, image } = body ?? {};

  if (!action) {
    return jsonResponse({ error: "ไม่รู้จักคำสั่งนี้" }, 400);
  }

  // usda_search และ off_search ไม่ต้องใช้ Gemini จึงตรวจก่อนเช็กคีย์ Gemini
  if (action === "usda_search") {
    return await handleUsdaSearch(text);
  }

  if (action === "off_search") {
    return await handleOffSearch(text);
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse(
      { error: "GEMINI_API_KEY ยังไม่ถูกตั้งค่าในฝั่งเซิร์ฟเวอร์" },
      500
    );
  }

  if (action === "read_label_image") {
    return await handleImageAction(action, image, LABEL_IMAGE_PROMPT, parseLabelJson);
  }

  if (action === "read_expiry_date") {
    return await handleImageAction(action, image, EXPIRY_IMAGE_PROMPT, parseExpiryJson);
  }

  return await handleTextAction(action, text);
});
