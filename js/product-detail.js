async function renderProductDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const barcode = params.get("barcode");
  const food = params.get("food");
  const foodNameTh = params.get("name_th");

  const detailEl = document.getElementById("product-detail");
  const notFoundEl = document.getElementById("product-not-found");

  const { product, source } = food
    ? await resolveFreshFood(food, foodNameTh)
    : await resolveProduct(id, barcode);

  if (!product) {
    // ผักผลไม้สด (?food=) ไม่มีบาร์โค้ด จึงเติมแค่ชื่อ
    document.getElementById("not-found-submit-link").href = getSubmitProductUrl(
      barcode,
      foodNameTh
    );
    notFoundEl.style.display = "block";
    detailEl.style.display = "none";
    return;
  }

  detailEl.style.display = "block";
  notFoundEl.style.display = "none";
  renderProduct(detailEl, product, source);
}

// ลำดับการค้นหา: ?id=... ดูในฐานข้อมูลของเราก่อนเสมอ
// ?barcode=... ดูในฐานข้อมูลของเราก่อน ถ้าไม่พบจึงลองค้นจาก Open Food Facts
async function resolveProduct(id, barcode) {
  if (id) {
    const product = await getProductById(id);
    return { product, source: product ? "local" : null };
  }

  if (barcode) {
    const localProduct = await getProductByBarcode(barcode);
    if (localProduct) {
      return { product: localProduct, source: "local" };
    }
    const offProduct = await getProductFromOpenFoodFacts(barcode);
    return { product: offProduct, source: offProduct ? "openfoodfacts" : null };
  }

  return { product: null, source: null };
}

// ?food=<ชื่ออังกฤษ>&name_th=... มาจากการถ่ายรูปผัก/ผลไม้สด (ดู js/label-ocr.js)
// ค้นข้อมูลโภชนาการจาก USDA FoodData Central — ไม่มีส่วนประกอบ/บาร์โค้ดเพราะเป็นวัตถุดิบสด
async function resolveFreshFood(nameEn, nameTh) {
  const response = await searchUsdaFood(nameEn);
  if (!response.ok || !response.result) {
    return { product: null, source: null };
  }

  const usda = response.result;
  return {
    product: {
      source: "usda",
      id: null,
      name: nameTh || nameEn,
      brand: null,
      barcode: null,
      image_url: null,
      product_type: usda.description,
      category: null,
      ingredients: null,
      usage_instructions: null,
      warnings: null,
      allergens: null,
      nutrition: cleanNutrition(usda.nutrition),
      source_url: usda.source_url,
      updated_at: usda.updated_at,
    },
    source: "usda",
  };
}

const SOURCE_LABELS = {
  local: "ข้อมูลในระบบ KinDee QR",
  openfoodfacts: "Open Food Facts",
  usda: "USDA FoodData Central",
};

// ใช้ DOM API สร้าง element แทน innerHTML เพราะข้อมูลจาก Open Food Facts
// เป็นฐานข้อมูลสาธารณะที่ใครก็แก้ไขได้ ต้องป้องกัน XSS เมื่อนำมาแสดงผล
function renderProduct(container, product, source) {
  container.innerHTML = "";

  // ผู้ใช้เสนอแก้ไขได้เสมอแม้จะพบข้อมูลแล้ว — ส่งเข้าคิวให้ผู้ดูแลอนุมัติ ไม่ได้แก้ข้อมูลบนเว็บทันที
  const toolbar = document.createElement("div");
  toolbar.className = "detail-toolbar";
  const editLink = document.createElement("a");
  editLink.className = "btn btn-secondary btn-small";
  editLink.href = getSubmitProductUrl(product.barcode, product.name, product.id);
  editLink.appendChild(icon("pencil", { size: 16 }));
  editLink.appendChild(document.createTextNode("แก้ไขข้อมูล"));
  editLink.title = "เสนอแก้ไขข้อมูลหรือรูปสินค้านี้ (ทีมงานจะตรวจสอบก่อนแสดง)";
  toolbar.appendChild(editLink);
  container.appendChild(toolbar);

  const img = document.createElement("img");
  img.src = product.image_url || "assets/images/placeholder-product.svg";
  img.alt = product.name || "สินค้า";
  container.appendChild(img);

  const h1 = document.createElement("h1");
  h1.textContent = product.name || "ไม่มีชื่อสินค้า";
  container.appendChild(h1);

  const badgeRow = document.createElement("p");
  if (product.brand) badgeRow.appendChild(createBadge(product.brand));
  if (CATEGORY_LABELS[product.category]) {
    badgeRow.appendChild(createBadge(CATEGORY_LABELS[product.category]));
  }
  if (product.product_type) badgeRow.appendChild(createBadge(product.product_type));
  badgeRow.appendChild(createBadge(SOURCE_LABELS[source]));
  container.appendChild(badgeRow);

  const scoreRow = createScoreRow(product);
  if (scoreRow) container.appendChild(scoreRow);

  // แสดงไว้ด้านบนให้เห็นก่อน ผู้ใช้จะได้รู้ว่า "ไม่มีข้อมูล" ด้านล่างเป็นเพราะฐานข้อมูลยังไม่ครบ ไม่ใช่เว็บพัง
  if (source === "openfoodfacts" && product.missing_sections?.length > 0) {
    container.appendChild(createIncompleteNotice(product));
  }

  // ผักผลไม้สดจาก USDA ไม่มี id/บาร์โค้ดให้หน้า AI Assistant โหลดซ้ำ
  if (product.id || product.barcode) {
    const aiLink = document.createElement("a");
    aiLink.className = "btn btn-secondary";
    aiLink.href = product.id
      ? `ai-assistant.html?id=${encodeURIComponent(product.id)}`
      : `ai-assistant.html?barcode=${encodeURIComponent(product.barcode)}`;
    aiLink.appendChild(icon("bot", { size: 18 }));
    aiLink.appendChild(document.createTextNode("ให้ AI ช่วยอธิบาย"));
    container.appendChild(aiLink);
  }

  container.appendChild(createNutritionSection(product.nutrition));

  if (source !== "usda") {
    container.appendChild(createFieldSection("ส่วนประกอบ", product.ingredients));
    container.appendChild(createFieldSection("สารก่อภูมิแพ้", product.allergens, "warning-box"));
    if (product.additives) {
      container.appendChild(createFieldSection("วัตถุเจือปนอาหาร", product.additives));
    }
    container.appendChild(createFieldSection("วิธีเก็บรักษา/รับประทาน", product.usage_instructions));
    container.appendChild(createFieldSection("คำเตือน", product.warnings, "warning-box"));
  }

  const notice = createSourceNotice(source);
  if (notice) container.appendChild(notice);

  if (source !== "usda") container.appendChild(createCompletenessSection(product));
  container.appendChild(createSourceUrlSection(product));
}

const NOVA_LABELS = {
  1: "อาหารไม่แปรรูปหรือแปรรูปน้อย",
  2: "วัตถุดิบปรุงอาหาร",
  3: "อาหารแปรรูป",
  4: "อาหารแปรรูปสูง (ultra-processed)",
};

// Nutri-Score (A-E) และ NOVA (1-4) เป็นค่าที่ Open Food Facts คำนวณไว้ เราแค่นำมาแสดง ไม่ได้คำนวณเอง
function createScoreRow(product) {
  if (!product.nutriscore_grade && !product.nova_group) return null;
  const row = document.createElement("p");

  if (product.nutriscore_grade) {
    const grade = product.nutriscore_grade.toLowerCase();
    const span = createBadge(`Nutri-Score ${grade.toUpperCase()}`);
    span.classList.add("nutriscore", `nutriscore-${grade}`);
    row.appendChild(span);
  }

  if (product.nova_group) {
    const label = NOVA_LABELS[product.nova_group];
    row.appendChild(createBadge(`NOVA ${product.nova_group}${label ? ` — ${label}` : ""}`));
  }

  return row;
}

function createNutritionSection(nutrition) {
  const section = document.createElement("section");

  const h2 = document.createElement("h2");
  h2.textContent = "ข้อมูลโภชนาการ (ต่อ 100 กรัม)";
  section.appendChild(h2);

  const cleaned = cleanNutrition(nutrition);
  if (cleaned) {
    section.appendChild(createNutritionTable(cleaned));
  } else {
    const p = document.createElement("p");
    p.className = "text-muted";
    p.textContent = "ไม่มีข้อมูล";
    section.appendChild(p);
  }

  return section;
}

function createIncompleteNotice(product) {
  const box = document.createElement("section");
  box.className = "warning-box";

  const p = document.createElement("p");
  p.textContent = `สินค้านี้มีอยู่ใน Open Food Facts แต่ยังไม่มีใครกรอก${product.missing_sections.join(
    "และ"
  )}จากฉลาก ข้อมูลส่วนนั้นจึงแสดงเป็น "ไม่มีข้อมูล" — ดูจากฉลากจริงบนบรรจุภัณฑ์แทน หรือพิมพ์ข้อมูลจากฉลากส่งให้เราได้`;
  box.appendChild(p);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const submitLink = document.createElement("a");
  submitLink.className = "btn btn-primary";
  submitLink.href = getSubmitProductUrl(product.barcode, product.name);
  submitLink.textContent = "ส่งข้อมูลจากฉลากให้เรา";
  actions.appendChild(submitLink);

  const offLink = document.createElement("a");
  offLink.className = "btn btn-secondary";
  offLink.href = product.source_url;
  offLink.target = "_blank";
  offLink.rel = "noopener noreferrer";
  offLink.textContent = "ช่วยเพิ่มข้อมูลใน Open Food Facts";
  actions.appendChild(offLink);

  const adminLink = document.createElement("a");
  adminLink.className = "btn btn-secondary";
  adminLink.href = `admin.html?barcode=${encodeURIComponent(product.barcode)}`;
  adminLink.textContent = "ผู้ดูแล: เพิ่มข้อมูลจากฉลากเข้าระบบ";
  actions.appendChild(adminLink);

  box.appendChild(actions);
  return box;
}

function createSourceNotice(source) {
  const texts = {
    openfoodfacts:
      "ข้อมูลนี้มาจากฐานข้อมูลสาธารณะ Open Food Facts ซึ่งใครก็สามารถแก้ไขได้ ยังไม่ผ่านการตรวจสอบโดยทีมงาน KinDee QR และไม่ได้เป็นการยืนยันว่าสินค้าแท้หรือปลอดภัย โปรดตรวจสอบกับฉลากจริงเสมอ",
    usda:
      "ข้อมูลโภชนาการเป็นค่าเฉลี่ยของวัตถุดิบดิบจาก USDA FoodData Central (สหรัฐอเมริกา) ค่าจริงอาจต่างไปตามสายพันธุ์และแหล่งปลูก ชนิดของผัก/ผลไม้ระบุโดย AI จากภาพซึ่งอาจผิดพลาดได้",
  };
  if (!texts[source]) return null;

  const notice = document.createElement("p");
  notice.className = "text-muted";
  notice.textContent = texts[source];
  return notice;
}

function createBadge(text) {
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = text;
  return span;
}

function createFieldSection(title, value, extraClass) {
  const section = document.createElement("section");
  if (extraClass) section.className = extraClass;

  const h2 = document.createElement("h2");
  h2.textContent = title;
  section.appendChild(h2);

  const p = document.createElement("p");
  p.textContent = value || "ไม่มีข้อมูล";
  if (!value) p.className = "text-muted";
  section.appendChild(p);

  return section;
}

function createCompletenessSection(product) {
  const fields = [
    { label: "ส่วนประกอบ", value: product.ingredients },
    { label: "ข้อมูลโภชนาการ", value: cleanNutrition(product.nutrition) },
  ];
  const missing = fields.filter((f) => !f.value).map((f) => f.label);

  const section = document.createElement("section");
  const p = document.createElement("p");
  p.className = "text-muted";
  p.textContent =
    missing.length === 0
      ? "สถานะข้อมูล: ครบถ้วน"
      : `สถานะข้อมูล: ยังไม่มีข้อมูลในส่วน ${missing.join(", ")}`;
  section.appendChild(p);
  return section;
}

function createSourceUrlSection(product) {
  const section = document.createElement("section");

  const h2 = document.createElement("h2");
  h2.textContent = "แหล่งที่มาข้อมูล";
  section.appendChild(h2);

  if (product.source_url) {
    const p = document.createElement("p");
    const a = document.createElement("a");
    a.href = product.source_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = product.source_url;
    p.appendChild(a);
    section.appendChild(p);
  }

  const updatedP = document.createElement("p");
  updatedP.className = "text-muted";
  updatedP.textContent = `อัปเดตล่าสุด: ${
    product.updated_at ? formatDate(product.updated_at) : "ไม่มีข้อมูล"
  }`;
  section.appendChild(updatedP);

  return section;
}

function formatDate(dateValue) {
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return String(dateValue);
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
}

renderProductDetail();
