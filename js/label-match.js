// จับคู่ "ข้อความที่ AI อ่านจากรูปฉลาก" กับผลค้นหาสินค้า โดยไม่เรียก AI เพิ่ม
// ขั้นตอน: สร้างคำค้นหลายแบบ (ไทย/อังกฤษ/แบรนด์) → ค้นในระบบเราและ Open Food Facts พร้อมกัน
//          → รวมผล ตัดรายการซ้ำ → ให้คะแนนความใกล้เคียงทีละรายการ → เรียงจากตรงที่สุด
// คะแนนใช้ "สัดส่วนตัวอักษรคู่ (bigram) ของคำบนฉลากที่พบในชื่อสินค้า" ซึ่งใช้ได้ทั้งภาษาไทย
// (ไม่มีเว้นวรรคระหว่างคำ) และภาษาอังกฤษ — เป็นการเทียบข้อความ ไม่ใช่การเทียบรูป
// ผลลัพธ์เป็นแค่ข้อเสนอ ผู้ใช้ต้องเลือกสินค้าที่ตรงกับของจริงเองเสมอ

const LABEL_MATCH_WEIGHTS = { name: 0.5, brand: 0.3, flavor: 0.1, size: 0.1 };
const LABEL_MATCH_MIN_SCORE = 0.3; // ต่ำกว่านี้ถือว่าไม่เกี่ยวข้อง ไม่แสดง
const LABEL_MATCH_STRONG_SCORE = 0.7; // ตั้งแต่นี้ขึ้นไปแสดงป้าย "ตรงกับฉลาก"
const LABEL_MATCH_TIE_MARGIN = 0.03; // ห่างจากอันดับ 1 ไม่เกินนี้ ถือว่าตรงพอ ๆ กัน
const LABEL_MATCH_MAX_RESULTS = 12;

function normalizeMatchText(text) {
  return String(text || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ตรา/g, " ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

function textBigrams(text) {
  const compact = normalizeMatchText(text).replace(/\s+/g, "");
  const grams = new Set();
  for (let i = 0; i < compact.length - 1; i++) grams.add(compact.slice(i, i + 2));
  return grams;
}

// สัดส่วนของ bigram ใน needle ที่พบใน haystack (0–1) — "ชื่อบนฉลากอยู่ในชื่อสินค้านี้มากแค่ไหน"
function textCoverage(needle, haystack) {
  const a = textBigrams(needle);
  if (a.size === 0) return null;
  const b = textBigrams(haystack);
  let hit = 0;
  a.forEach((g) => b.has(g) && hit++);
  return hit / a.size;
}

function bestCoverage(needles, haystack) {
  const scores = needles.map((n) => textCoverage(n, haystack)).filter((s) => s !== null);
  return scores.length ? Math.max(...scores) : null;
}

// "200 มล." / "200ml" / "0.2 L" → { value: 200, unit: "ml" }
function parseSize(text) {
  const m = String(text || "")
    .toLowerCase()
    .replace(",", ".")
    .match(/(\d+(?:\.\d+)?)\s*(มล|ml|มิลลิลิตร|ลิตร|l\b|ltr|กรัม|ก\.|g\b|gm|กก|kg)/);
  if (!m) return null;
  let value = Number(m[1]);
  let unit = m[2];
  if (["ลิตร", "l", "ltr"].includes(unit)) { value *= 1000; unit = "ml"; }
  else if (["มล", "ml", "มิลลิลิตร"].includes(unit)) unit = "ml";
  else if (["กก", "kg"].includes(unit)) { value *= 1000; unit = "g"; }
  else unit = "g";
  return { value, unit };
}

function sizeScore(extractedSize, product) {
  const a = parseSize(extractedSize);
  if (!a) return null;
  const b = parseSize(product.quantity) || parseSize(product.name) || parseSize(product.name_en);
  if (!b) return 0.5; // สินค้าไม่ระบุขนาด — ไม่บวกไม่ลบ
  return a.unit === b.unit && Math.abs(a.value - b.value) <= a.value * 0.05 ? 1 : 0;
}

function scoreLabelMatch(extracted, product) {
  const productText = [product.name, product.name_en].filter(Boolean).join(" ");
  const productBrandText = [product.brand, productText].filter(Boolean).join(" ");
  const names = [extracted.product_name, extracted.product_name_en].filter(Boolean);
  const brands = [extracted.brand, extracted.brand_en].filter(Boolean);

  const parts = {
    name: names.length ? bestCoverage(names, productText) : null,
    brand: brands.length ? bestCoverage(brands, productBrandText) : null,
    flavor: extracted.flavor ? textCoverage(extracted.flavor, productText) : null,
    size: sizeScore(extracted.size, product),
  };

  // คิดเฉพาะส่วนที่ AI อ่านได้จากฉลาก แล้วปรับน้ำหนักให้รวมเป็น 1
  let total = 0;
  let weight = 0;
  Object.entries(parts).forEach(([key, value]) => {
    if (value === null) return;
    total += value * LABEL_MATCH_WEIGHTS[key];
    weight += LABEL_MATCH_WEIGHTS[key];
  });
  return weight ? total / weight : 0;
}

// คำค้นหลายแบบ เพราะฐานข้อมูลบางรายการเก็บชื่อไทย บางรายการเก็บชื่ออังกฤษ
function buildLabelQueries(extracted) {
  const { product_name: name, product_name_en: nameEn, brand, brand_en: brandEn } = extracted;
  const join = (...parts) => parts.filter(Boolean).join(" ").trim();
  const queries = [join(brand, name), join(brandEn || brand, nameEn), name, nameEn, brand, brandEn];
  return [...new Set(queries.filter((q) => q && q.length >= 2))].slice(0, 5);
}

// คืน [{ product, score, strong }] เรียงจากตรงที่สุด — เรียก API ค้นหาข้อความเท่านั้น ไม่เรียก AI
async function findLabelMatches(extracted) {
  const queries = buildLabelQueries(extracted);
  if (queries.length === 0) return [];

  // ระบบเรา: ค้นทุกคำ (ตารางเล็ก เร็ว) / Open Food Facts: 3 คำแรกที่ครอบคลุมที่สุดพอ
  const searches = [
    ...queries.map((q) => searchProductsByText(q)),
    ...queries.slice(0, 3).map((q) => searchOpenFoodFacts(q)),
  ];
  const results = await Promise.all(searches.map((p) => p.catch(() => [])));

  const unique = new Map();
  results.flat().forEach((product) => {
    const key = product.id || product.barcode;
    if (key && !unique.has(key)) unique.set(key, product);
  });

  const ranked = [...unique.values()]
    .map((product) => ({ product, score: scoreLabelMatch(extracted, product) }))
    .filter((m) => m.score >= LABEL_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, LABEL_MATCH_MAX_RESULTS);

  // ป้าย "ตรงกับฉลาก" เฉพาะรายการที่คะแนนสูง และสูสีกับอันดับ 1 — ถ้าติดป้ายหลายรายการ ป้ายจะไม่มีความหมาย
  const best = ranked[0]?.score ?? 0;
  return ranked.map((m) => ({
    ...m,
    strong: m.score >= LABEL_MATCH_STRONG_SCORE && m.score >= best - LABEL_MATCH_TIE_MARGIN,
  }));
}
