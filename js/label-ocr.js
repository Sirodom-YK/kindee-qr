document.getElementById("label-photo-camera").addEventListener("change", handleLabelPhotoSelected);
document.getElementById("label-photo-file").addEventListener("change", handleLabelPhotoSelected);

async function handleLabelPhotoSelected(e) {
  const file = e.target.files[0];
  e.target.value = ""; // เลือกไฟล์เดิมซ้ำได้อีกครั้ง
  if (!file) return;

  const resultEl = document.getElementById("scan-result");
  resultEl.style.display = "block";
  renderStatus(resultEl, "กำลังอ่านข้อมูลจากภาพ...");

  try {
    const { base64, mimeType } = await resizeImageToBase64(file, 1024, 0.7);
    const response = await readLabelImage(base64, mimeType);

    if (!response.ok) {
      renderStatus(resultEl, `เกิดข้อผิดพลาด: ${response.error}`);
      return;
    }

    await handleExtractedLabelData(response.result, resultEl);
  } catch (err) {
    console.error("handleLabelPhotoSelected error:", err);
    renderStatus(resultEl, "เกิดข้อผิดพลาดในการอ่านภาพ กรุณาลองใหม่");
  }
}

async function handleExtractedLabelData(extracted, resultEl) {
  const { product_name: productName, brand, barcode } = extracted;

  // ผัก/ผลไม้สดไม่มีฉลากให้อ่าน — แสดงชนิดที่ AI คาดไว้ให้ผู้ใช้ยืนยันเองก่อนเปิดข้อมูลโภชนาการ
  if (!extracted.is_packaged && extracted.produce_name_en) {
    renderProduceGuess(resultEl, extracted);
    return;
  }

  if (!productName && !brand && !barcode) {
    renderLabelReadFailed(resultEl);
    return;
  }

  // 1. ถ้าอ่านบาร์โค้ดได้ชัดเจน ให้ค้นหาแบบเดียวกับตอนสแกน QR/บาร์โค้ด (แม่นยำกว่าการค้นด้วยชื่อ)
  if (barcode) {
    const localProduct = await findProductByScannedValue(barcode);
    if (localProduct) {
      window.location.href = `product-detail.html?id=${encodeURIComponent(localProduct.id)}`;
      return;
    }
    const offProduct = await getProductFromOpenFoodFacts(barcode);
    if (offProduct) {
      window.location.href = `product-detail.html?barcode=${encodeURIComponent(barcode)}`;
      return;
    }
  }

  // 2. ค้นหาด้วยชื่อ/แบรนด์ที่อ่านได้ — อาจพบได้หลายรายการ ต้องให้ผู้ใช้เลือกเอง
  // ไม่ใช่การจับคู่และยืนยันให้อัตโนมัติ เพราะเป็นแค่ข้อความที่อ่านได้ ไม่ใช่การยืนยันตัวสินค้า
  const searchTerm = productName || brand;
  let matches = searchTerm ? await searchProductsByText(searchTerm) : [];
  if (matches.length === 0 && searchTerm) {
    matches = await searchOpenFoodFacts(searchTerm);
  }

  if (matches.length > 0) {
    renderLabelSearchResults(resultEl, extracted, matches);
  } else {
    renderLabelNotFound(resultEl, extracted);
  }
}

const CONFIDENCE_LABELS = { high: "สูง", medium: "ปานกลาง", low: "ต่ำ" };

// ใช้ DOM API แทน innerHTML เพราะชื่อที่ได้มาจาก AI ซึ่งตีความจากภาพที่ผู้ใช้อัปโหลด
function renderProduceGuess(resultEl, extracted) {
  clearResultEl(resultEl);

  const nameTh = extracted.produce_name_th || extracted.produce_name_en;

  const p1 = document.createElement("p");
  p1.textContent = `AI คาดว่าเป็น: ${nameTh} (${extracted.produce_name_en})`;
  resultEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.className = "text-muted";
  p2.textContent = `ความมั่นใจของ AI: ${CONFIDENCE_LABELS[extracted.confidence] || "ต่ำ"} — นี่คือการคาดจากรูปลักษณ์ ไม่ใช่การยืนยัน กรุณาตรวจสอบว่าตรงกับของจริงก่อนดูข้อมูล`;
  resultEl.appendChild(p2);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const params = new URLSearchParams({ food: extracted.produce_name_en, name_th: nameTh });
  const detailLink = document.createElement("a");
  detailLink.className = "btn btn-primary";
  detailLink.href = `product-detail.html?${params}`;
  detailLink.textContent = "ใช่ ดูข้อมูลโภชนาการ";
  actions.appendChild(detailLink);

  const searchLink = document.createElement("a");
  searchLink.className = "btn btn-secondary";
  searchLink.href = "search.html";
  searchLink.textContent = "ไม่ใช่ ค้นหาด้วยชื่อแทน";
  actions.appendChild(searchLink);

  actions.appendChild(createScanAgainButton());
  resultEl.appendChild(actions);
}

function renderLabelReadFailed(resultEl) {
  clearResultEl(resultEl);
  const p = document.createElement("p");
  p.textContent =
    "อ่านภาพไม่สำเร็จ ไม่พบชื่อสินค้า แบรนด์ บาร์โค้ด หรือชนิดผักผลไม้ที่ชัดเจนในภาพ ลองถ่ายให้ชัดขึ้นและไม่มีแสงสะท้อน";
  resultEl.appendChild(p);
  resultEl.appendChild(createScanAgainButton());
}

// ใช้ DOM API แทน innerHTML เพราะข้อความที่ Gemini อ่านได้มาจากภาพที่ผู้ใช้อัปโหลด (ข้อมูลภายนอก)
function renderLabelSearchResults(resultEl, extracted, matches) {
  clearResultEl(resultEl);

  const info = document.createElement("p");
  info.textContent = `อ่านข้อความจากฉลากได้: ${[extracted.product_name, extracted.brand]
    .filter(Boolean)
    .join(" / ") || "(ไม่มีข้อความที่อ่านได้ชัดเจน)"}`;
  resultEl.appendChild(info);

  const notice = document.createElement("p");
  notice.className = "text-muted";
  notice.textContent =
    "นี่คือผลการค้นหาจากข้อความที่อ่านได้จากภาพ ไม่ใช่การยืนยันว่าตรงกับสินค้าที่คุณมี กรุณาเลือกรายการที่ตรงกับสินค้าจริงด้วยตัวเอง";
  resultEl.appendChild(notice);

  const grid = document.createElement("div");
  grid.className = "product-grid";
  matches.forEach((product) => {
    grid.appendChild(createProductCardElement(product));
  });
  resultEl.appendChild(grid);

  resultEl.appendChild(createScanAgainButton());
}

function renderLabelNotFound(resultEl, extracted) {
  clearResultEl(resultEl);

  const p1 = document.createElement("p");
  p1.textContent = "ไม่พบสินค้าที่ตรงกับข้อมูลบนฉลากในระบบ";
  resultEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.className = "text-muted";
  p2.textContent = `อ่านข้อความได้: ${
    [extracted.product_name, extracted.brand, extracted.barcode].filter(Boolean).join(" / ") ||
    "ไม่มีข้อความที่อ่านได้ชัดเจน"
  }`;
  resultEl.appendChild(p2);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const searchLink = document.createElement("a");
  searchLink.className = "btn btn-primary";
  searchLink.href = "search.html";
  searchLink.textContent = "ค้นหาด้วยชื่อสินค้า";
  actions.appendChild(searchLink);

  const submitLink = document.createElement("a");
  submitLink.className = "btn btn-secondary";
  submitLink.href = getSubmitProductUrl(extracted.barcode, extracted.product_name);
  submitLink.textContent = "ส่งข้อมูลสินค้านี้ให้เรา";
  actions.appendChild(submitLink);

  actions.appendChild(createScanAgainButton());
  resultEl.appendChild(actions);
}
