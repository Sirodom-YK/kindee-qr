// ค้นหาข้อมูลสินค้าอาหารจาก Open Food Facts API เมื่อไม่พบในฐานข้อมูลของเราเอง
// เอกสาร API: https://openfoodfacts.github.io/openfoodfacts-server/api/
// สำคัญ: แสดงเฉพาะข้อมูลที่ API ส่งมาจริงเท่านั้น ห้ามเติมข้อมูลที่ไม่มี (เช่น วิธีเก็บรักษา/คำเตือน)
// เพราะ Open Food Facts ไม่มีฟิลด์เหล่านี้ — ปล่อยเป็น null แล้วให้หน้าแสดงผลระบุว่า "ไม่มีข้อมูล"

const OPEN_FOOD_FACTS_BASE_URL = "https://world.openfoodfacts.org";

async function getProductFromOpenFoodFacts(barcode) {
  try {
    const res = await fetch(
      `${OPEN_FOOD_FACTS_BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}.json`
    );
    if (!res.ok) return null;

    const json = await res.json();
    if (json.status !== 1 || !json.product) return null;

    return mapOpenFoodFactsProduct(json.product, barcode);
  } catch (e) {
    console.error("getProductFromOpenFoodFacts error:", e.message);
    return null;
  }
}

// ค้นหาด้วยชื่อสินค้า — บริการค้นหาของ Open Food Facts ไม่เปิด CORS ให้เว็บอื่น จึงต้องเรียกผ่าน
// edge function (action "off_search" ใน js/gemini.js) ผลลัพธ์มีแค่ข้อมูลสำหรับการ์ด
// ส่วนรายละเอียดเต็มจะดึงใหม่ด้วยบาร์โค้ดตอนเปิดหน้ารายละเอียด
async function searchOpenFoodFacts(query) {
  const response = await callGeminiAction("off_search", query);
  if (!response.ok || !Array.isArray(response.result)) return [];

  return response.result
    .filter((p) => p.code && (p.product_name_th || p.product_name))
    .map((p) => mapOpenFoodFactsProduct(p, p.code));
}

function mapOpenFoodFactsProduct(p, barcode) {
  return {
    source: "openfoodfacts",
    id: null,
    name: p.product_name_th || p.product_name || null,
    // API บาร์โค้ดส่ง brands เป็นข้อความ แต่ API ค้นหาส่งเป็น array
    brand: (Array.isArray(p.brands) ? p.brands.join(", ") : p.brands) || null,
    barcode: barcode,
    qr_code_value: null,
    image_url: p.image_front_url || p.image_url || null,
    product_type: (Array.isArray(p.categories) ? p.categories.join(", ") : p.categories) || null,
    category: "packaged",
    ingredients: p.ingredients_text_th || p.ingredients_text || null,
    // Open Food Facts ไม่มีฟิลด์วิธีเก็บรักษา/คำเตือนโดยตรง จึงปล่อยเป็น null ตามจริง
    usage_instructions: null,
    warnings: null,
    allergens: cleanTags(p.allergens_tags),
    additives: cleanTags(p.additives_tags, (tag) => tag.toUpperCase()),
    nutrition: mapOpenFoodFactsNutriments(p.nutriments),
    nutriscore_grade: isValidNutriScore(p.nutriscore_grade) ? p.nutriscore_grade : null,
    nova_group: p.nova_group || null,
    missing_sections: getMissingSections(p.states_tags),
    source_url: `${OPEN_FOOD_FACTS_BASE_URL}/product/${barcode}`,
    updated_at: p.last_modified_t
      ? new Date(p.last_modified_t * 1000).toISOString()
      : null,
  };
}

// แปลงค่าโภชนาการต่อ 100 กรัมให้อยู่ในรูปแบบเดียวกับ nutrition ในฐานข้อมูลของเรา (ดู js/nutrition.js)
function mapOpenFoodFactsNutriments(n) {
  if (!n) return null;
  const nutrition = {
    energy_kcal: n["energy-kcal_100g"],
    protein_g: n.proteins_100g,
    fat_g: n.fat_100g,
    carbohydrates_g: n.carbohydrates_100g,
    sugars_g: n.sugars_100g,
    fiber_g: n.fiber_100g,
    // Open Food Facts เก็บโซเดียมเป็นกรัม แต่ฉลากไทยใช้มิลลิกรัม
    sodium_mg: typeof n.sodium_100g === "number" ? n.sodium_100g * 1000 : undefined,
  };
  return cleanNutrition(nutrition);
}

// Open Food Facts ติดสถานะ "...-to-be-completed" ให้สินค้าที่ยังไม่มีใครกรอกข้อมูลส่วนนั้น
// (สินค้าไทยหลายตัวมีแค่ชื่อกับรูป) ใช้บอกผู้ใช้ว่าข้อมูลยังไม่ครบ ไม่ใช่เว็บผิดพลาด
const OFF_INCOMPLETE_STATES = {
  "en:ingredients-to-be-completed": "ส่วนประกอบ",
  "en:nutrition-facts-to-be-completed": "ข้อมูลโภชนาการ",
};

function getMissingSections(statesTags) {
  if (!Array.isArray(statesTags)) return [];
  return statesTags.map((tag) => OFF_INCOMPLETE_STATES[tag]).filter(Boolean);
}

// Nutri-Score ที่ใช้ได้มีแค่ a-e ส่วนค่าอื่น (เช่น "unknown", "not-applicable") ไม่นำมาแสดง
function isValidNutriScore(grade) {
  return typeof grade === "string" && /^[a-e]$/.test(grade);
}

function cleanTags(tags, transform = (tag) => tag) {
  if (!tags || tags.length === 0) return null;
  return tags.map((tag) => transform(tag.replace(/^[a-z]{2}:/, ""))).join(", ");
}
