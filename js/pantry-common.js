// ค่าคงที่และฟังก์ชันที่ใช้ร่วมกันในระบบ "ของในบ้าน" (pantry.html, household.html, pantry-report.html)

const ITEM_TYPE_LABELS = {
  food: "อาหาร/เครื่องดื่ม",
  medicine: "ยา/อาหารเสริม",
  cosmetic: "เครื่องสำอาง/ของใช้ส่วนตัว",
  household: "ของใช้ในบ้าน",
  other: "อื่น ๆ",
};

const LOCATION_LABELS = {
  fridge: "ตู้เย็น",
  freezer: "ช่องแช่แข็ง",
  pantry: "ตู้เก็บของ",
  bathroom: "ห้องน้ำ",
  other: "อื่น ๆ",
};

const DATE_KIND_LABELS = {
  exp: "หมดอายุ",
  bbe: "ควรบริโภคก่อน",
};

// ไอคอนคู่กับป้าย (js/icons.js) ช่วยให้เลือกได้เร็วบนมือถือโดยไม่ต้องอ่านทุกคำ
const ITEM_TYPE_ICONS = {
  food: "apple",
  medicine: "pill",
  cosmetic: "spray-can",
  household: "house",
  other: "ellipsis",
};

const LOCATION_ICONS = {
  fridge: "refrigerator",
  freezer: "snowflake",
  pantry: "archive",
  bathroom: "bath",
  other: "ellipsis",
};

// ============ ตัวเลือกแบบชิป (แทน <select>) ============
// แตะครั้งเดียวเลือกได้ เหมาะกับมือถือ — ค่าที่เลือกเก็บไว้ใน container.dataset.value
// options: [{ value, label, icon }]

function renderChoiceChips(container, options, { value = "", onChange } = {}) {
  container.innerHTML = "";
  container.setAttribute("role", "radiogroup");
  options.forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = opt.value;
    chip.setAttribute("role", "radio");
    if (opt.icon) chip.appendChild(icon(opt.icon, { size: 16 }));
    chip.appendChild(document.createTextNode(opt.label));
    chip.addEventListener("click", () => {
      setChoice(container, opt.value);
      if (onChange) onChange(opt.value);
    });
    container.appendChild(chip);
  });
  setChoice(container, value);
}

function setChoice(containerOrId, value) {
  const container =
    typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
  container.dataset.value = value;
  container.querySelectorAll(".chip").forEach((chip) => {
    chip.setAttribute("aria-checked", String(chip.dataset.value === value));
  });
}

function getChoice(id) {
  return document.getElementById(id).dataset.value || "";
}

function labelsToOptions(labels, icons, allLabel) {
  const options = Object.entries(labels).map(([value, label]) => ({
    value,
    label,
    icon: icons?.[value],
  }));
  return allLabel ? [{ value: "", label: allLabel }, ...options] : options;
}

// ใกล้หมดอายุ = เหลือไม่เกินกี่วัน (ตรงกับค่าเริ่มต้นการแจ้งเตือน 3 วันก่อน)
const SOON_DAYS = 3;

const CURRENT_HOUSEHOLD_KEY = "kindee.currentHouseholdId";

// ============ บ้าน ============

// บ้านทั้งหมดที่ผู้ใช้เป็นสมาชิก: [{ id, name, role, display_name }]
async function getMyHouseholds(userId) {
  const { data, error } = await supabaseClient
    .from("household_members")
    .select("role, display_name, households(id, name)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("getMyHouseholds error:", error.message);
    return [];
  }
  return data
    .filter((row) => row.households)
    .map((row) => ({ ...row.households, role: row.role, display_name: row.display_name }));
}

// บ้านที่เลือกไว้ล่าสุด (จำในเครื่อง) — ถ้าไม่มีหรือออกจากบ้านนั้นแล้ว ใช้บ้านแรก
function pickCurrentHousehold(households) {
  let savedId = null;
  try {
    savedId = localStorage.getItem(CURRENT_HOUSEHOLD_KEY);
  } catch {
    // บางเบราว์เซอร์ (โหมดส่วนตัว) ใช้ localStorage ไม่ได้ — ใช้บ้านแรกแทน
  }
  return households.find((h) => h.id === savedId) || households[0] || null;
}

function saveCurrentHouseholdId(householdId) {
  try {
    localStorage.setItem(CURRENT_HOUSEHOLD_KEY, householdId);
  } catch {
    // ไม่ต้องทำอะไร — แค่จำไม่ได้ในครั้งหน้า
  }
}

// ============ วันที่ ============

// วันนี้ตามเวลาเครื่องผู้ใช้ในรูปแบบ YYYY-MM-DD (ไม่ใช้ toISOString เพราะจะเป็นเวลา UTC
// ซึ่งช่วงหลังเที่ยงคืนถึง 7 โมงเช้าเวลาไทยจะได้วันที่ของเมื่อวาน)
function todayIsoDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// จำนวนวันจากวันนี้ถึงวันที่กำหนด (ติดลบ = เลยมาแล้ว) — เทียบแค่วันที่ ไม่สนเวลา
function daysUntil(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [ty, tm, td] = todayIsoDate().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

// expired / soon / ok / none (ไม่มีวันหมดอายุ)
function getExpiryStatus(item) {
  if (!item.expiry_date) return "none";
  const days = daysUntil(item.expiry_date);
  if (days < 0) return "expired";
  if (days <= SOON_DAYS) return "soon";
  return "ok";
}

function describeDaysLeft(item) {
  if (!item.expiry_date) return "ไม่ระบุวันหมดอายุ";
  const days = daysUntil(item.expiry_date);
  const kind = DATE_KIND_LABELS[item.date_kind] || "หมดอายุ";
  if (days < 0) return `${kind}มาแล้ว ${-days} วัน`;
  if (days === 0) return `${kind}วันนี้`;
  if (days === 1) return `${kind}พรุ่งนี้`;
  return `อีก ${days} วัน`;
}

// ข้อความสั้นสำหรับป้ายสถานะบนการ์ด (มือถือที่ที่น้อย)
function shortDaysLeft(item) {
  if (!item.expiry_date) return "ไม่มีวันหมดอายุ";
  const days = daysUntil(item.expiry_date);
  if (days < 0) return `เลยมา ${-days} วัน`;
  if (days === 0) return "หมดวันนี้";
  if (days === 1) return "พรุ่งนี้";
  if (days < 60) return `อีก ${days} วัน`;
  return `อีก ${Math.round(days / 30)} เดือน`;
}

// วันที่ทางลัดในฟอร์ม เช่น +1 เดือน — บวกเดือนแบบปฏิทิน (31 ม.ค. + 1 เดือน = 28/29 ก.พ.)
function addToToday({ days = 0, months = 0 }) {
  const d = new Date();
  const targetMonth = d.getMonth() + months;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay) + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatThaiDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// เดาประเภทของจากหมวดสินค้าในระบบ/Open Food Facts ตอนสแกนเพิ่มของ
function guessItemType(product) {
  if (!product) return "other";
  if (["packaged", "snack", "beverage", "vegetable", "fruit"].includes(product.category)) {
    return "food";
  }
  return product.source === "openfoodfacts" ? "food" : "other";
}
