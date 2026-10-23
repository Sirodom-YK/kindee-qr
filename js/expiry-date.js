// แปลงวันที่ที่ Gemini อ่านได้จากฉลาก (action read_expiry_date) เป็นวันที่จริง YYYY-MM-DD
// Gemini ส่ง "ตัวเลขตามที่เห็น" มา (day, month, year) — การตีความปีอยู่ที่นี่ เพราะฉลากไทยมีหลายแบบ:
//   2569 → พ.ศ. (ลบ 543 = 2026)      2026 → ค.ศ.
//   69   → อาจเป็น พ.ศ. 2569 (= 2026) หรือ ค.ศ. 2069
//   26   → อาจเป็น ค.ศ. 2026 หรือ พ.ศ. 2526 (= 1983)
// ปี 2 หลักจะเลือกแบบที่อยู่ในช่วง "1 ปีก่อน ถึง 10 ปีข้างหน้า" จากวันนี้ (ของที่ยังอยู่ในบ้าน)
// ผลลัพธ์ทุกอันต้องให้ผู้ใช้ยืนยันก่อนบันทึกเสมอ

const EXPIRY_YEARS_BACK = 1;
const EXPIRY_YEARS_AHEAD = 10;

// todayIso รับจากภายนอกเพื่อให้ทดสอบได้ (ค่าเริ่มต้น = วันนี้ของเครื่อง)
function resolveLabelYear(yearRaw, todayIso) {
  if (typeof yearRaw !== "number" || !Number.isInteger(yearRaw)) return null;
  if (yearRaw >= 2400) return yearRaw - 543; // พ.ศ.
  if (yearRaw >= 1900) return yearRaw; // ค.ศ.
  if (yearRaw < 0 || yearRaw > 99) return null; // ปี 3 หลัก ตีความไม่ได้

  const thisYear = Number(todayIso.slice(0, 4));
  const asCe = 2000 + yearRaw;
  const asBe = 2500 + yearRaw - 543;
  const inRange = (y) => y >= thisYear - EXPIRY_YEARS_BACK && y <= thisYear + EXPIRY_YEARS_AHEAD;

  if (inRange(asCe)) return asCe;
  if (inRange(asBe)) return asBe;
  return asCe;
}

function toIsoDate(year, month, day) {
  const pad = (n) => String(n).padStart(2, "0");
  // ตรวจว่าเป็นวันที่มีจริง (เช่น 31/02 ใช้ไม่ได้)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

// วันที่ผู้ใช้น่าจะต้องการ เรียงจากน่าใช้ที่สุด — ตัดวันผลิต (mfg) ทิ้ง
// [{ iso, date_kind: "exp"|"bbe", raw_text, monthOnly }]
function interpretExpiryCandidates(dates, todayIso = todayIsoDate()) {
  const kindRank = { exp: 0, bbe: 1, unknown: 2 };
  const results = [];

  (dates || []).forEach((d) => {
    if (d.kind === "mfg" || !d.month) return;
    const year = resolveLabelYear(d.year, todayIso);
    if (!year) return;

    // ฉลากแบบ "EXP 06/2026" ไม่มีวัน → ถือเป็นวันสุดท้ายของเดือนนั้น
    const monthOnly = !d.day;
    const day = d.day || new Date(Date.UTC(year, d.month, 0)).getUTCDate();
    const iso = toIsoDate(year, d.month, day);
    if (!iso) return;

    results.push({
      iso,
      date_kind: d.kind === "bbe" ? "bbe" : "exp",
      raw_text: d.raw_text || "",
      monthOnly,
      rank: kindRank[d.kind] ?? 2,
    });
  });

  // ถ้ามีหลายวันที่ประเภทเดียวกัน วันที่หลังสุดมักเป็นวันหมดอายุ (วันแรกมักเป็นวันผลิตที่ไม่มีป้าย)
  results.sort((a, b) => a.rank - b.rank || b.iso.localeCompare(a.iso));

  const seen = new Set();
  return results
    .filter((r) => !seen.has(r.iso) && seen.add(r.iso))
    .map(({ rank, ...rest }) => rest);
}
