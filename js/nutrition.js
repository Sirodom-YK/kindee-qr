// รูปแบบข้อมูลโภชนาการที่ใช้ร่วมกันทั้งระบบ (คอลัมน์ nutrition ใน Supabase, Open Food Facts, USDA)
// ทุกค่าเป็น "ต่อ 100 กรัม" — ฟิลด์ที่ไม่มีข้อมูลจะไม่อยู่ใน object เลย ไม่ใช่ใส่เป็น 0
const NUTRITION_FIELDS = [
  { key: "energy_kcal", label: "พลังงาน", unit: "kcal" },
  { key: "protein_g", label: "โปรตีน", unit: "g" },
  { key: "fat_g", label: "ไขมัน", unit: "g" },
  { key: "carbohydrates_g", label: "คาร์โบไฮเดรต", unit: "g" },
  { key: "sugars_g", label: "น้ำตาล", unit: "g" },
  { key: "fiber_g", label: "ใยอาหาร", unit: "g" },
  { key: "sodium_mg", label: "โซเดียม", unit: "mg" },
];

const CATEGORY_LABELS = {
  packaged: "อาหารแปรรูป/บรรจุภัณฑ์",
  snack: "ขนม",
  beverage: "เครื่องดื่ม",
  vegetable: "ผัก",
  fruit: "ผลไม้",
  other: "อื่น ๆ",
};

// ตัดฟิลด์ที่ไม่ใช่ตัวเลขทิ้ง คืน null ถ้าไม่เหลือข้อมูลเลย
function cleanNutrition(nutrition) {
  if (!nutrition) return null;
  const cleaned = {};
  NUTRITION_FIELDS.forEach(({ key }) => {
    const value = Number(nutrition[key]);
    if (nutrition[key] !== null && nutrition[key] !== "" && Number.isFinite(value)) {
      cleaned[key] = value;
    }
  });
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function formatNutrientValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function createNutritionTable(nutrition) {
  const table = document.createElement("table");
  table.className = "nutrition-table";

  NUTRITION_FIELDS.forEach(({ key, label, unit }) => {
    if (nutrition[key] === undefined) return;
    const row = document.createElement("tr");

    const th = document.createElement("th");
    th.textContent = label;
    row.appendChild(th);

    const td = document.createElement("td");
    td.textContent = `${formatNutrientValue(nutrition[key])} ${unit}`;
    row.appendChild(td);

    table.appendChild(row);
  });

  return table;
}

// ใช้ส่งให้ AI สรุป — เป็นข้อความธรรมดาจากค่าที่มีอยู่จริงเท่านั้น
function formatNutritionText(nutrition) {
  const cleaned = cleanNutrition(nutrition);
  if (!cleaned) return null;
  return NUTRITION_FIELDS.filter(({ key }) => cleaned[key] !== undefined)
    .map(({ key, label, unit }) => `${label}: ${formatNutrientValue(cleaned[key])} ${unit}`)
    .join("\n")
    .concat("\n(ต่อ 100 กรัม)");
}

// อ่านค่าจากช่องกรอก <input data-nutrient="..."> (ใช้ในฟอร์ม Admin และฟอร์มส่งข้อมูลของผู้ใช้)
function readNutritionInputs(container = document) {
  const nutrition = {};
  container.querySelectorAll("[data-nutrient]").forEach((input) => {
    nutrition[input.dataset.nutrient] = input.value.trim();
  });
  return cleanNutrition(nutrition);
}
