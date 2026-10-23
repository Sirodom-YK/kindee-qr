let currentProduct = null;

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const barcode = params.get("barcode");
  if (id || barcode) {
    loadProduct(id, barcode);
  }

  document.getElementById("load-product-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = document.getElementById("product-lookup-input").value.trim();
    if (!value) return;

    // UUID ของ Supabase มีรูปแบบ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    );

    if (looksLikeUuid) {
      loadProduct(value, null);
    } else {
      loadProduct(null, value);
    }
  });

  document.getElementById("ai-actions").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn || btn.disabled || !currentProduct) return;
    const text = getFieldText(currentProduct, btn.dataset.field);
    runAiAction(btn.dataset.action, text, btn);
  });
});

async function loadProduct(id, barcode) {
  const contextEl = document.getElementById("product-context");
  const actionsEl = document.getElementById("ai-actions");
  contextEl.style.display = "block";
  renderStatus(contextEl, "กำลังโหลดข้อมูลสินค้า...");
  actionsEl.style.display = "none";
  currentProduct = null;

  let product = null;
  if (id) {
    product = await getProductById(id);
  } else if (barcode) {
    product = await getProductByBarcode(barcode);
    if (!product) {
      product = await getProductFromOpenFoodFacts(barcode);
    }
  }

  if (!product) {
    renderStatus(contextEl, "ไม่พบข้อมูลสินค้านี้ในระบบ");
    return;
  }

  currentProduct = product;
  renderProductContext(contextEl, product);
  actionsEl.style.display = "block";
  updateActionAvailability(product);
}

// ใช้ DOM API แทน innerHTML เพราะข้อมูลสินค้าอาจมาจาก Open Food Facts
// ซึ่งเป็นฐานข้อมูลสาธารณะที่ใครก็แก้ไขได้
function renderProductContext(container, product) {
  container.innerHTML = "";

  const h2 = document.createElement("h2");
  h2.textContent = "ข้อมูลต้นฉบับจากระบบ";
  container.appendChild(h2);

  container.appendChild(createDataRow("ชื่อสินค้า", product.name));
  container.appendChild(createDataRow("แบรนด์", product.brand));
  container.appendChild(createDataRow("ส่วนประกอบ", product.ingredients));
  container.appendChild(createDataRow("สารก่อภูมิแพ้", product.allergens));
  container.appendChild(createDataRow("ข้อมูลโภชนาการ", formatNutritionText(product.nutrition)));
  container.appendChild(createDataRow("คำเตือน", product.warnings));
}

// nutrition เป็น object (jsonb) จึงต้องแปลงเป็นข้อความก่อนส่งให้ AI
function getFieldText(product, field) {
  return field === "nutrition" ? formatNutritionText(product.nutrition) : product[field];
}

function createDataRow(label, value) {
  const p = document.createElement("p");

  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  p.appendChild(strong);

  const span = document.createElement("span");
  span.textContent = value || "ไม่มีข้อมูล";
  if (!value) span.className = "text-muted";
  p.appendChild(span);

  return p;
}

function updateActionAvailability(product) {
  document.querySelectorAll("#ai-actions button[data-action]").forEach((btn) => {
    const hasField = Boolean(getFieldText(product, btn.dataset.field));
    btn.disabled = !hasField;
    btn.title = hasField ? "" : "ไม่มีข้อมูลในฟิลด์นี้ให้ AI ช่วยอธิบาย";
  });
}

async function runAiAction(action, text, btn) {
  const resultEl = document.getElementById("ai-result");
  resultEl.style.display = "block";
  btn.disabled = true;
  renderStatus(resultEl, "กำลังให้ AI ช่วย...");

  const response = await callGeminiAction(action, text);

  btn.disabled = false;

  if (!response.ok) {
    renderStatus(resultEl, `เกิดข้อผิดพลาด: ${response.error}`);
    return;
  }

  renderAiResult(resultEl, response.result);
}

function renderAiResult(container, resultText) {
  container.innerHTML = "";

  const label = document.createElement("span");
  label.className = "badge";
  label.textContent = "คำอธิบายจาก AI (Gemini)";
  container.appendChild(label);

  const p = document.createElement("p");
  p.textContent = resultText;
  container.appendChild(p);

  const disclaimer = document.createElement("p");
  disclaimer.className = "text-muted";
  disclaimer.textContent =
    "AI ใช้สำหรับแปล/อธิบายข้อมูลที่มีอยู่จริงเท่านั้น ไม่ได้ยืนยันความถูกต้อง ความแท้ หรือความปลอดภัยของสินค้า";
  container.appendChild(disclaimer);
}

function renderStatus(container, text) {
  container.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = text;
  container.appendChild(p);
}
