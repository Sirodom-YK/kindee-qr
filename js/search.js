document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("search-input").value.trim();
  const resultEl = document.getElementById("search-result");

  if (!query) {
    resultEl.innerHTML = "";
    return;
  }

  resultEl.innerHTML = "";
  const loadingP = document.createElement("p");
  loadingP.textContent = "กำลังค้นหา...";
  resultEl.appendChild(loadingP);

  // พิมพ์เป็นเลขบาร์โค้ด (เว้นวรรค/ขีดคั่นได้) → ค้นด้วยบาร์โค้ดซึ่งแม่นกว่าการค้นด้วยชื่อ
  const barcode = query.replace(/[\s-]/g, "");
  if (isLikelyBarcode(barcode)) {
    await searchByBarcode(resultEl, loadingP, barcode);
    return;
  }

  // ค้นในฐานข้อมูลของเราก่อน ถ้าไม่พบจึงค้นต่อใน Open Food Facts
  let matches = await searchProductsByText(query);
  let source = "local";
  if (matches.length === 0) {
    loadingP.textContent = "ไม่พบในระบบ กำลังค้นหาใน Open Food Facts...";
    matches = await searchOpenFoodFacts(query);
    source = "openfoodfacts";
  }
  renderSearchResults(resultEl, query, matches, source);
});

async function searchByBarcode(resultEl, loadingP, barcode) {
  const localProduct = await getProductByBarcode(barcode);
  if (localProduct) {
    renderSearchResults(resultEl, barcode, [localProduct], "local");
    return;
  }

  loadingP.textContent = "ไม่พบในระบบ กำลังค้นหาบาร์โค้ดใน Open Food Facts...";
  const offProduct = await getProductFromOpenFoodFacts(barcode);
  renderSearchResults(resultEl, barcode, offProduct ? [offProduct] : [], "openfoodfacts", true);
}

function renderSearchResults(resultEl, query, matches, source, isBarcode = false) {
  resultEl.innerHTML = "";

  if (matches.length === 0) {
    const p = document.createElement("p");
    p.className = "text-muted";
    p.textContent = isBarcode
      ? `ไม่พบสินค้าบาร์โค้ด ${query} ทั้งในระบบและ Open Food Facts — ตรวจตัวเลขอีกครั้ง หรือส่งข้อมูลสินค้านี้ให้เรา`
      : `ไม่พบสินค้าที่ตรงกับ "${query}" ทั้งในระบบและ Open Food Facts — ถ้าเป็นผักผลไม้สด ลองถ่ายรูปที่หน้าสแกนแทน`;
    resultEl.appendChild(p);

    const submitLink = document.createElement("a");
    submitLink.className = "btn btn-secondary";
    submitLink.href = isBarcode ? getSubmitProductUrl(query, null) : getSubmitProductUrl(null, query);
    submitLink.textContent = "ส่งข้อมูลสินค้านี้ให้เรา";
    resultEl.appendChild(submitLink);
    return;
  }

  const countP = document.createElement("p");
  countP.className = "text-muted";
  countP.textContent =
    source === "openfoodfacts"
      ? `พบ ${matches.length} รายการจาก Open Food Facts (ฐานข้อมูลสาธารณะ ยังไม่ผ่านการตรวจสอบโดยทีมงาน)`
      : `พบ ${matches.length} รายการ`;
  resultEl.appendChild(countP);

  const grid = document.createElement("div");
  grid.className = "product-grid";
  matches.forEach((product) => {
    grid.appendChild(createProductCardElement(product));
  });
  resultEl.appendChild(grid);
}
