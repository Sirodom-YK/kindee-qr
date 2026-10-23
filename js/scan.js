function initScanner() {
  startBarcodeScanner("qr-reader", handleScannedValue);
}

// พิมพ์เลขบาร์โค้ด/QR เองเมื่อกล้องอ่านไม่ได้ (บาร์โค้ดเลือน โค้ง หรือไม่มีกล้อง)
// ใช้ขั้นตอนค้นหาเดียวกับการสแกนทุกอย่าง
document.getElementById("manual-code-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = normalizeTypedCode(document.getElementById("manual-code-input").value);
  if (!value) return;

  stopBarcodeScanner();
  handleScannedValue(value);
});

async function handleScannedValue(rawValue) {
  // ไลบรารีสแกน QR และเครื่องมือสร้าง QR บางตัวแถมช่องว่าง/บรรทัดใหม่ติดมาด้วย
  // ถ้าไม่ตัดออกก่อน การจับคู่แบบตรงทุกตัวอักษรกับฐานข้อมูลจะไม่พบข้อมูลเลยแม้ค่าจะ "ดูเหมือน" ตรงกัน
  rawValue = rawValue.trim();

  const resultEl = document.getElementById("scan-result");
  resultEl.style.display = "block";
  renderStatus(resultEl, `กำลังตรวจสอบข้อมูล: ${rawValue}`);

  const localProduct = await findProductByScannedValue(rawValue);
  if (localProduct) {
    renderStatus(resultEl, "พบข้อมูลสินค้าในระบบ กำลังเปิดหน้ารายละเอียด...");
    window.location.href = `product-detail.html?id=${encodeURIComponent(localProduct.id)}`;
    return;
  }

  // ถ้าค่าที่สแกนได้มีรูปแบบเหมือนบาร์โค้ด ให้ลองค้นจาก Open Food Facts ต่อ
  if (isLikelyBarcode(rawValue)) {
    renderStatus(resultEl, "ไม่พบในระบบ กำลังตรวจสอบกับ Open Food Facts...");
    const offProduct = await getProductFromOpenFoodFacts(rawValue);
    if (offProduct) {
      window.location.href = `product-detail.html?barcode=${encodeURIComponent(rawValue)}`;
      return;
    }
  }

  const safeUrl = parseSafeUrl(rawValue);
  if (safeUrl) {
    renderUrlConfirmation(resultEl, safeUrl);
    return;
  }

  renderNotFound(resultEl, rawValue);
}

// รับเฉพาะ URL ที่เป็น http/https เท่านั้น ป้องกันไม่ให้เปิด scheme ที่อาจเป็นอันตราย
// (เช่น javascript:, file:) ตามนโยบายความปลอดภัยของระบบ
function parseSafeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url.href;
}

function clearResultEl(resultEl) {
  resultEl.innerHTML = "";
}

function renderStatus(resultEl, text) {
  clearResultEl(resultEl);
  const p = document.createElement("p");
  p.textContent = text;
  resultEl.appendChild(p);
}

// สร้าง element ด้วย DOM API (ไม่ใช้ innerHTML) เพราะค่าที่สแกนได้จาก QR Code
// เป็นข้อมูลจากภายนอกที่ไม่น่าเชื่อถือ ต้องป้องกัน XSS เมื่อนำมาแสดงผล
function renderUrlConfirmation(resultEl, url) {
  clearResultEl(resultEl);

  const p1 = document.createElement("p");
  p1.textContent = "ไม่พบข้อมูลสินค้านี้ในระบบ แต่ QR Code นี้มีลิงก์อยู่:";
  resultEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.className = "text-muted";
  p2.style.wordBreak = "break-all";
  p2.textContent = url;
  resultEl.appendChild(p2);

  const p3 = document.createElement("p");
  p3.textContent =
    "โปรดตรวจสอบความน่าเชื่อถือของลิงก์นี้ด้วยตัวเองก่อนเปิด ระบบไม่สามารถยืนยันความปลอดภัยของลิงก์จากภายนอกได้";
  resultEl.appendChild(p3);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const openLink = document.createElement("a");
  openLink.className = "btn btn-secondary";
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.textContent = "เปิดลิงก์นี้ในแท็บใหม่";
  actions.appendChild(openLink);

  actions.appendChild(createScanAgainButton());
  resultEl.appendChild(actions);
}

function renderNotFound(resultEl, rawValue) {
  clearResultEl(resultEl);

  const p1 = document.createElement("p");
  p1.textContent = "ไม่พบข้อมูลสินค้านี้ในระบบ";
  resultEl.appendChild(p1);

  const p2 = document.createElement("p");
  p2.className = "text-muted";
  p2.style.wordBreak = "break-all";
  p2.textContent = `ข้อมูลที่สแกนได้: ${rawValue}`;
  resultEl.appendChild(p2);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const searchLink = document.createElement("a");
  searchLink.className = "btn btn-primary";
  searchLink.href = "search.html";
  searchLink.textContent = "ค้นหาด้วยชื่อสินค้า";
  actions.appendChild(searchLink);

  const labelLink = document.createElement("a");
  labelLink.className = "btn btn-secondary";
  labelLink.href = "#label-upload";
  labelLink.textContent = "ถ่ายรูปฉลากหรือผักผลไม้แทน";
  actions.appendChild(labelLink);

  const submitLink = document.createElement("a");
  submitLink.className = "btn btn-secondary";
  submitLink.href = getSubmitProductUrl(isLikelyBarcode(rawValue) ? rawValue : null);
  submitLink.textContent = "ส่งข้อมูลสินค้านี้ให้เรา";
  actions.appendChild(submitLink);

  actions.appendChild(createScanAgainButton());
  resultEl.appendChild(actions);
}

function createScanAgainButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary";
  btn.textContent = "สแกนอีกครั้ง";
  btn.addEventListener("click", () => {
    const resultEl = document.getElementById("scan-result");
    resultEl.style.display = "none";
    clearResultEl(resultEl);
    initScanner();
  });
  return btn;
}

initScanner();
