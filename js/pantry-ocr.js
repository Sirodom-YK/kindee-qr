// ถ่ายรูปวันที่บนฉลาก → Gemini อ่านตัวเลข (action read_expiry_date) → แปลงปีด้วย js/expiry-date.js
// ไม่บันทึกให้อัตโนมัติ: แสดงสิ่งที่อ่านได้ + วันที่ที่ตีความ ให้ผู้ใช้กด "ใช้วันนี้" เองทุกครั้ง
// เพราะฉลากมีหลายวันที่ (ผลิต/หมดอายุ) และปี พ.ศ./ค.ศ. แบบ 2 หลักตีความผิดได้

document.getElementById("expiry-photo-camera").addEventListener("change", handleExpiryPhoto);
document.getElementById("expiry-photo-file").addEventListener("change", handleExpiryPhoto);
document.getElementById("item-photo-camera").addEventListener("change", handleItemPhoto);

// ถ่ายรูปสินค้า 1 รูป → AI อ่านชื่อ แบรนด์ ประเภท (และวันที่ถ้าเห็น) แล้วกรอกฟอร์มให้
// ชื่อ/ประเภทกรอกลงช่องให้เลย (ผู้ใช้เห็นและแก้ได้ก่อนกดบันทึก) ส่วนวันที่ยังต้องกด "ใช้วันนี้" เอง
// เพราะฉลากมีหลายวันที่และปีตีความผิดได้ (เหตุผลเดียวกับ handleExpiryPhoto)
async function handleItemPhoto(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  setLookupStatus("กำลังอ่านข้อมูลจากรูป..."); // อยู่ใน js/pantry.js
  // ใช้รูปนี้เป็นรูปของรายการด้วย ถ้ายังไม่มีรูปจากฐานข้อมูล
  if (!pantryState.lookup.imageUrl && !pantryState.selectedImageFile) {
    pantryState.selectedImageFile = file;
    renderItemImagePreview();
  }

  try {
    const { base64, mimeType } = await resizeImageToBase64(file, 1600, 0.85);
    const response = await readPantryItem(base64, mimeType);
    if (!response.ok) {
      setLookupStatus(`อ่านรูปไม่สำเร็จ: ${response.error} — พิมพ์ชื่อเองด้านล่างได้เลย`);
      return;
    }

    const r = response.result || {};
    const filled = [];

    const name = [r.brand && !(r.product_name || "").includes(r.brand) ? r.brand : null, r.product_name, r.size]
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
    if (r.product_name) {
      document.getElementById("item-name").value = name;
      filled.push("ชื่อ");
    }
    if (r.item_type) {
      setChoice("item-type", r.item_type);
      filled.push("ประเภท");
    }
    if (r.barcode && !pantryState.lookup.barcode) {
      pantryState.lookup.barcode = r.barcode; // จำไว้ ครั้งหน้าสแกนบาร์โค้ดนี้จะเจอชื่อทันที
    }

    const candidates = interpretExpiryCandidates(r.dates);
    if (candidates.length > 0) {
      const resultEl = document.getElementById("expiry-ocr-result");
      resultEl.style.display = "block";
      renderOcrCandidates(resultEl, candidates);
      filled.push("วันที่ (กดเลือกด้านล่าง)");
    }

    setLookupStatus(
      filled.length
        ? `AI กรอกให้แล้ว: ${filled.join(", ")} — ตรวจให้ตรงกับฉลากก่อนกดบันทึก`
        : "อ่านชื่อจากรูปไม่ได้ ลองถ่ายด้านหน้าให้เห็นชื่อชัด ๆ หรือพิมพ์เองด้านล่าง"
    );
    if (!r.product_name) document.getElementById("item-name").focus();
  } catch (err) {
    console.error("handleItemPhoto error:", err);
    setLookupStatus("เกิดข้อผิดพลาดในการอ่านรูป — พิมพ์ชื่อเองด้านล่างได้เลย");
  }
}

async function handleExpiryPhoto(e) {
  const file = e.target.files[0];
  e.target.value = ""; // เลือกไฟล์เดิมซ้ำได้อีกครั้ง
  if (!file) return;

  const resultEl = document.getElementById("expiry-ocr-result");
  resultEl.style.display = "block";
  setOcrMessage(resultEl, "กำลังอ่านวันที่จากภาพ...");

  try {
    // วันที่บนฉลากตัวเล็ก จึงย่อน้อยกว่าตอนอ่านชื่อสินค้า (1600px แทน 1024px)
    const { base64, mimeType } = await resizeImageToBase64(file, 1600, 0.85);
    const response = await readExpiryDate(base64, mimeType);

    if (!response.ok) {
      setOcrMessage(resultEl, `อ่านไม่สำเร็จ: ${response.error}`);
      return;
    }

    const candidates = interpretExpiryCandidates(response.result?.dates);
    if (candidates.length === 0) {
      setOcrMessage(
        resultEl,
        "ไม่พบวันหมดอายุที่อ่านได้ชัดเจน ลองถ่ายใกล้ ๆ ให้เห็นตัวเลขชัด ไม่มีแสงสะท้อน หรือกรอกเองด้านล่าง"
      );
      return;
    }
    renderOcrCandidates(resultEl, candidates);
  } catch (err) {
    console.error("handleExpiryPhoto error:", err);
    setOcrMessage(resultEl, "เกิดข้อผิดพลาดในการอ่านภาพ กรุณาลองใหม่");
  }
}

function setOcrMessage(resultEl, text) {
  resultEl.innerHTML = "";
  const p = document.createElement("p");
  p.className = "text-muted";
  p.textContent = text;
  resultEl.appendChild(p);
}

// ใช้ DOM API แทน innerHTML เพราะ raw_text คือข้อความที่ AI อ่านจากภาพที่ผู้ใช้อัปโหลด
function renderOcrCandidates(resultEl, candidates) {
  resultEl.innerHTML = "";

  const intro = document.createElement("p");
  intro.textContent = "AI อ่านได้ — ตรวจให้ตรงกับฉลากแล้วกดเลือก:";
  resultEl.appendChild(intro);

  candidates.forEach((candidate, index) => {
    const row = document.createElement("div");
    row.className = "ocr-candidate";

    const text = document.createElement("span");
    const kind = DATE_KIND_LABELS[candidate.date_kind];
    const raw = candidate.raw_text ? `"${candidate.raw_text}" → ` : "";
    const monthNote = candidate.monthOnly ? " (ฉลากมีแค่เดือน/ปี ใช้วันสุดท้ายของเดือน)" : "";
    text.textContent = `${raw}${kind} ${formatThaiDate(candidate.iso)}${monthNote}`;
    row.appendChild(text);

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = `btn btn-small ${index === 0 ? "btn-primary" : "btn-secondary"}`;
    useBtn.textContent = "ใช้วันนี้";
    useBtn.addEventListener("click", () => applyOcrCandidate(candidate));
    row.appendChild(useBtn);

    resultEl.appendChild(row);
  });
}

function applyOcrCandidate(candidate) {
  setExpiryDate(candidate.iso); // อยู่ใน js/pantry.js
  setChoice("item-date-kind", candidate.date_kind);
  setOcrMessage(
    document.getElementById("expiry-ocr-result"),
    `ใส่วันที่ ${formatThaiDate(candidate.iso)} แล้ว — แก้ในช่องด้านล่างได้ถ้าไม่ถูกต้อง`
  );
}

function clearExpiryOcrResult() {
  const resultEl = document.getElementById("expiry-ocr-result");
  resultEl.innerHTML = "";
  resultEl.style.display = "none";
}
