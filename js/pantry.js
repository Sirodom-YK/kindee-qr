// หน้า "ของในบ้าน": รายการของของบ้านที่เลือก แยกกลุ่มตามวันหมดอายุ + ฟอร์มเพิ่ม/แก้ไข
// ทุกคนในบ้านเห็นและแก้รายการชุดเดียวกัน — สิทธิ์บังคับด้วย RLS is_household_member() ใน supabase/pantry.sql
// ออกแบบให้ใช้บนมือถือได้เร็ว: ตัวเลือกเป็นชิปแตะครั้งเดียว, วันที่มีทางลัด, ปุ่มเพิ่มลอยมุมขวาล่าง

const PLACEHOLDER_IMAGE = "assets/images/placeholder-product.svg";

const GROUPS = [
  { status: "expired", title: "หมดอายุแล้ว" },
  { status: "soon", title: `ใกล้หมดอายุ (ภายใน ${SOON_DAYS} วัน)` },
  { status: "ok", title: "ยังอีกนาน" },
  { status: "none", title: "ไม่ระบุวันหมดอายุ" },
];

const DATE_SHORTCUTS = [
  { label: "พรุ่งนี้", days: 1 },
  { label: "+3 วัน", days: 3 },
  { label: "+1 สัปดาห์", days: 7 },
  { label: "+1 เดือน", months: 1 },
  { label: "+3 เดือน", months: 3 },
  { label: "+6 เดือน", months: 6 },
  { label: "+1 ปี", months: 12 },
];

const pantryState = {
  user: null,
  household: null,
  members: {}, // user_id → display_name ใช้แสดงว่าใครเพิ่มของ
  items: [],
  statusFilter: "", // "" | "expired" | "soon" — ตั้งจากแถบสรุปด้านบน
  editingItem: null,
  // ข้อมูลจากการสแกน/พิมพ์บาร์โค้ด ใช้ผูกกับสินค้าในระบบ
  lookup: { barcode: null, productId: null, imageUrl: null },
  selectedImageFile: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  pantryState.user = await requireLogin();
  if (!pantryState.user) return;

  renderChoiceChips(
    document.getElementById("filter-location"),
    labelsToOptions(LOCATION_LABELS, LOCATION_ICONS, "ทุกที่เก็บ"),
    { onChange: renderItems }
  );
  renderChoiceChips(
    document.getElementById("filter-type"),
    labelsToOptions(ITEM_TYPE_LABELS, ITEM_TYPE_ICONS, "ทุกประเภท"),
    { onChange: renderItems }
  );
  renderChoiceChips(
    document.getElementById("item-type"),
    labelsToOptions(ITEM_TYPE_LABELS, ITEM_TYPE_ICONS),
    { value: "food" }
  );
  renderChoiceChips(
    document.getElementById("item-location"),
    labelsToOptions(LOCATION_LABELS, LOCATION_ICONS),
    { value: "pantry" }
  );
  renderChoiceChips(
    document.getElementById("item-date-kind"),
    [
      { value: "exp", label: "หมดอายุ (EXP)" },
      { value: "bbe", label: "ควรบริโภคก่อน (BBE)" },
    ],
    { value: "exp" }
  );
  renderDateShortcuts();

  document.getElementById("add-item-btn").addEventListener("click", () => openItemForm(null));
  document.getElementById("close-item-btn").addEventListener("click", closeItemForm);
  document.getElementById("delete-item-btn").addEventListener("click", handleDeleteItem);
  document.getElementById("item-form").addEventListener("submit", handleSaveItem);
  document.getElementById("start-scan-btn").addEventListener("click", () => {
    startBarcodeScanner("pantry-qr-reader", lookupCode);
  });
  document.getElementById("item-code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = normalizeTypedCode(document.getElementById("item-code-input").value);
    if (code) lookupCode(code);
  });
  document.getElementById("item-no-expiry").addEventListener("change", (e) => {
    document.getElementById("item-expiry").disabled = e.target.checked;
  });
  document.getElementById("qty-minus").addEventListener("click", () => stepQuantity(-1));
  document.getElementById("qty-plus").addEventListener("click", () => stepQuantity(1));
  document.getElementById("item-image-camera").addEventListener("change", handleItemImageSelected);
  document.getElementById("item-image-file").addEventListener("change", handleItemImageSelected);

  await loadHousehold();
});

function renderDateShortcuts() {
  const container = document.getElementById("date-shortcuts");
  DATE_SHORTCUTS.forEach((shortcut) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = shortcut.label;
    chip.addEventListener("click", () => setExpiryDate(addToToday(shortcut)));
    container.appendChild(chip);
  });
}

// ใช้ทั้งปุ่มทางลัดและผลจาก OCR (js/pantry-ocr.js)
function setExpiryDate(isoDate) {
  document.getElementById("item-no-expiry").checked = false;
  const input = document.getElementById("item-expiry");
  input.disabled = false;
  input.value = isoDate;
}

function stepQuantity(delta) {
  const input = document.getElementById("item-quantity");
  const next = Math.max(0, (Number(input.value) || 0) + delta);
  input.value = String(next);
}

async function loadHousehold() {
  const households = await getMyHouseholds(pantryState.user.id);
  pantryState.household = pickCurrentHousehold(households);

  const line = document.getElementById("pantry-household-line");
  if (!pantryState.household) {
    line.textContent = "";
    document.getElementById("no-household").style.display = "block";
    return;
  }

  renderHouseholdLine(line, households);
  document.getElementById("pantry-panel").style.display = "block";
  document.getElementById("add-item-btn").style.display = "inline-flex";
  await Promise.all([loadMembers(), loadItems()]);
}

// อยู่บ้านเดียว: แสดงชื่อบ้าน / อยู่หลายบ้าน: ช่องเลือกบ้าน เปลี่ยนแล้วโหลดของบ้านนั้นทันที
// บ้านที่เลือกถูกจำไว้ (saveCurrentHouseholdId) หน้าบ้านของฉันและหน้ารายงานจึงใช้บ้านเดียวกัน
function renderHouseholdLine(line, households) {
  line.textContent = "";
  line.appendChild(icon("house", { size: 16 }));

  if (households.length > 1) {
    const select = document.createElement("select");
    select.id = "household-switch";
    select.className = "household-switch";
    select.setAttribute("aria-label", "เลือกบ้าน");
    households.forEach((h) => {
      const option = document.createElement("option");
      option.value = h.id;
      option.textContent = h.name;
      select.appendChild(option);
    });
    select.value = pantryState.household.id;
    select.addEventListener("change", () => switchHousehold(households, select.value));
    line.appendChild(select);
  } else {
    const name = document.createElement("strong");
    name.textContent = pantryState.household.name;
    line.appendChild(name);
  }

  const manageLink = document.createElement("a");
  manageLink.href = "household.html";
  manageLink.textContent = "จัดการบ้าน";
  line.appendChild(manageLink);
}

async function switchHousehold(households, householdId) {
  pantryState.household = households.find((h) => h.id === householdId);
  saveCurrentHouseholdId(householdId);

  // ฟอร์มที่เปิดค้างอยู่เป็นของบ้านเดิม — ปิดก่อน กันบันทึกของผิดบ้าน
  closeItemForm();
  setChoice("filter-location", "");
  setChoice("filter-type", "");
  pantryState.statusFilter = "";
  pantryState.items = [];
  renderItems();

  await Promise.all([loadMembers(), loadItems()]);
}

async function loadMembers() {
  const { data } = await supabaseClient
    .from("household_members")
    .select("user_id, display_name")
    .eq("household_id", pantryState.household.id);
  pantryState.members = Object.fromEntries((data || []).map((m) => [m.user_id, m.display_name]));
}

async function loadItems() {
  const { data, error } = await supabaseClient
    .from("pantry_items")
    .select("*")
    .eq("household_id", pantryState.household.id)
    .eq("status", "active")
    .order("expiry_date", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("loadItems error:", error.message);
    return;
  }
  pantryState.items = data;
  renderItems();
}

// ============ แสดงรายการ ============

function renderItems() {
  const location = getChoice("filter-location");
  const type = getChoice("filter-type");
  const items = pantryState.items.filter(
    (item) =>
      (!location || item.location === location) &&
      (!type || item.item_type === type) &&
      (!pantryState.statusFilter || getExpiryStatus(item) === pantryState.statusFilter)
  );

  renderSummary();

  const container = document.getElementById("pantry-groups");
  container.innerHTML = "";

  if (items.length === 0) {
    container.appendChild(createEmptyState());
    return;
  }

  GROUPS.forEach(({ status, title }) => {
    const groupItems = items.filter((item) => getExpiryStatus(item) === status);
    if (groupItems.length === 0) return;

    const section = document.createElement("section");
    const h2 = document.createElement("h2");
    h2.className = "group-title";
    const dot = document.createElement("span");
    dot.className = `status-dot status-${status}`;
    h2.appendChild(dot);
    h2.appendChild(document.createTextNode(`${title} · ${groupItems.length}`));
    section.appendChild(h2);

    const list = document.createElement("div");
    list.className = "pantry-list";
    groupItems.forEach((item) => list.appendChild(createItemCard(item, status)));
    section.appendChild(list);

    container.appendChild(section);
  });
}

function createEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.appendChild(icon("package-open", { size: 40 }));
  const p = document.createElement("p");
  p.textContent =
    pantryState.items.length === 0
      ? "ยังไม่มีของในบ้าน กดปุ่ม \"เพิ่มของ\" มุมขวาล่างเพื่อเริ่มบันทึก"
      : "ไม่มีของที่ตรงกับตัวกรอง";
  empty.appendChild(p);
  return empty;
}

// แถบสรุปนับจากรายการทั้งหมด (ไม่สนตัวกรอง) เพื่อไม่ให้พลาดของที่ใกล้หมด แตะเพื่อกรองดูเฉพาะกลุ่ม
function renderSummary() {
  const counts = { expired: 0, soon: 0 };
  pantryState.items.forEach((item) => {
    const status = getExpiryStatus(item);
    if (status in counts) counts[status]++;
  });

  const strip = document.getElementById("summary-strip");
  strip.innerHTML = "";
  [
    { filter: "expired", label: "หมดอายุแล้ว", count: counts.expired },
    { filter: "soon", label: "ใกล้หมด", count: counts.soon },
    { filter: "", label: "ทั้งหมด", count: pantryState.items.length },
  ].forEach(({ filter, label, count }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(pantryState.statusFilter === filter));

    const number = document.createElement("strong");
    number.textContent = count;
    if (filter === "expired" && count > 0) number.style.color = "var(--color-danger)";
    if (filter === "soon" && count > 0) number.style.color = "var(--color-warning)";
    btn.appendChild(number);

    const caption = document.createElement("span");
    if (filter) {
      const dot = document.createElement("span");
      dot.className = `status-dot status-${filter}`;
      caption.appendChild(dot);
    }
    caption.appendChild(document.createTextNode(label));
    btn.appendChild(caption);

    btn.addEventListener("click", () => {
      // แตะซ้ำที่กลุ่มเดิม = เลิกกรอง
      pantryState.statusFilter = pantryState.statusFilter === filter ? "" : filter;
      renderItems();
    });
    strip.appendChild(btn);
  });
}

// ใช้ DOM API แทน innerHTML เพราะชื่อ/หมายเหตุเป็นข้อความที่สมาชิกพิมพ์เอง
function createItemCard(item, status) {
  const card = document.createElement("article");
  card.className = "card pantry-item";

  const img = document.createElement("img");
  img.src = item.image_url || PLACEHOLDER_IMAGE;
  img.alt = "";
  img.loading = "lazy";
  card.appendChild(img);

  const body = document.createElement("div");
  body.className = "pantry-item-body";

  const top = document.createElement("div");
  top.className = "pantry-item-top";
  const h3 = document.createElement("h3");
  h3.textContent = item.name;
  top.appendChild(h3);
  const pill = document.createElement("span");
  pill.className = `status-pill status-${status}`;
  if (status === "expired" || status === "soon") pill.appendChild(icon("clock", { size: 14 }));
  pill.appendChild(document.createTextNode(shortDaysLeft(item)));
  top.appendChild(pill);
  body.appendChild(top);

  const meta = document.createElement("p");
  meta.className = "text-muted";
  meta.textContent = [
    LOCATION_LABELS[item.location],
    `${formatQuantity(item.quantity)} ${item.unit}`,
    item.expiry_date && `${DATE_KIND_LABELS[item.date_kind]} ${formatThaiDate(item.expiry_date)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  body.appendChild(meta);

  const extra = [item.note, pantryState.members[item.added_by] && `เพิ่มโดย ${pantryState.members[item.added_by]}`]
    .filter(Boolean)
    .join(" · ");
  if (extra) {
    const note = document.createElement("p");
    note.className = "text-muted";
    note.textContent = extra;
    body.appendChild(note);
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.appendChild(createActionButton("minus", "ใช้ 1", () => handleUseOne(item)));
  actions.appendChild(createActionButton("check", "ใช้หมด", () => finishItem(item, "used")));
  actions.appendChild(createActionButton("trash-2", "ทิ้ง", () => finishItem(item, "discarded")));

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.setAttribute("aria-label", `แก้ไข ${item.name}`);
  editBtn.appendChild(icon("pencil", { size: 18 }));
  editBtn.addEventListener("click", () => openItemForm(item));
  actions.appendChild(editBtn);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function createActionButton(iconName, text, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  btn.appendChild(icon(iconName, { size: 16 }));
  btn.appendChild(document.createTextNode(text));
  btn.addEventListener("click", onClick);
  return btn;
}

function formatQuantity(quantity) {
  return Number.isInteger(Number(quantity)) ? String(Number(quantity)) : Number(quantity).toFixed(1);
}

// ============ ใช้ / ทิ้ง ============

async function handleUseOne(item) {
  const remaining = Math.max(0, Number(item.quantity) - 1);
  if (remaining === 0) {
    if (confirm(`"${item.name}" หมดแล้วใช่หรือไม่?`)) await finishItem(item, "used", true);
    return;
  }
  await updateItem(item.id, { quantity: remaining });
}

// used = ใช้หมด, discarded = ทิ้ง — ข้อมูลนี้ใช้ทำรายงาน "ใช้ทัน vs หมดอายุ"
async function finishItem(item, status, skipConfirm = false) {
  const question =
    status === "used" ? `บันทึกว่าใช้ "${item.name}" หมดแล้ว?` : `บันทึกว่าทิ้ง "${item.name}"?`;
  if (!skipConfirm && !confirm(question)) return;

  await updateItem(item.id, {
    status,
    quantity: status === "used" ? 0 : item.quantity,
    finished_at: new Date().toISOString(),
  });
}

async function updateItem(itemId, changes) {
  const { error } = await supabaseClient
    .from("pantry_items")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    console.error("updateItem error:", error.message);
    alert("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    return;
  }
  await loadItems();
}

// ============ ฟอร์มเพิ่ม/แก้ไข ============

function openItemForm(item) {
  pantryState.editingItem = item;
  pantryState.selectedImageFile = null;
  pantryState.lookup = {
    barcode: item?.barcode || null,
    productId: item?.product_id || null,
    imageUrl: item?.image_url || null,
  };

  document.getElementById("item-form-title").textContent = item ? "แก้ไขของ" : "เพิ่มของ";
  document.getElementById("item-lookup").style.display = item ? "none" : "block";
  document.getElementById("delete-item-btn").style.display = item ? "inline-flex" : "none";
  setLookupStatus("");
  document.getElementById("item-code-input").value = "";

  document.getElementById("item-name").value = item?.name || "";
  setChoice("item-type", item?.item_type || "food");
  setChoice("item-location", item?.location || "pantry");
  document.getElementById("item-quantity").value = item ? formatQuantity(item.quantity) : "1";
  document.getElementById("item-unit").value = item?.unit || "ชิ้น";
  document.getElementById("item-expiry").value = item?.expiry_date || "";
  setChoice("item-date-kind", item?.date_kind || "exp");
  const noExpiry = Boolean(item) && !item.expiry_date;
  document.getElementById("item-no-expiry").checked = noExpiry;
  document.getElementById("item-expiry").disabled = noExpiry;
  document.getElementById("item-note").value = item?.note || "";
  renderItemImagePreview();
  clearExpiryOcrResult(); // อยู่ใน js/pantry-ocr.js

  // ปุ่มลอยซ้อนกับปุ่มบันทึกบนมือถือ — ซ่อนระหว่างกรอกฟอร์ม
  document.getElementById("add-item-btn").style.display = "none";
  const section = document.getElementById("item-form-section");
  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeItemForm() {
  stopBarcodeScanner();
  pantryState.editingItem = null;
  document.getElementById("item-form").reset();
  document.getElementById("item-form-section").style.display = "none";
  if (pantryState.household) {
    document.getElementById("add-item-btn").style.display = "inline-flex";
  }
}

function setLookupStatus(text) {
  const el = document.getElementById("item-lookup-status");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}

// สแกน/พิมพ์บาร์โค้ด → หาในระบบเราก่อน แล้ว Open Food Facts → เติมชื่อ รูป ประเภท
// ของที่ไม่ใช่อาหาร (ยา เครื่องสำอาง ของใช้) ส่วนใหญ่จะไม่พบ ให้กรอกชื่อเอง แต่ยังจำบาร์โค้ดไว้
async function lookupCode(code) {
  setLookupStatus(`กำลังค้นหา ${code}...`);
  pantryState.lookup.barcode = code;

  let product = await findProductByScannedValue(code);
  if (!product && isLikelyBarcode(code)) {
    product = await getProductFromOpenFoodFacts(code);
  }

  if (!product) {
    setLookupStatus(`ไม่พบข้อมูลของบาร์โค้ด ${code} — กรอกชื่อเองด้านล่างได้เลย`);
    document.getElementById("item-name").focus();
    return;
  }

  pantryState.lookup.productId = product.id || null;
  pantryState.lookup.imageUrl =
    product.image_url && product.image_url !== PLACEHOLDER_IMAGE ? product.image_url : null;
  document.getElementById("item-name").value = product.name || "";
  setChoice("item-type", guessItemType(product));
  renderItemImagePreview();
  setLookupStatus(`พบ: ${product.name} — ใส่วันหมดอายุด้านล่างแล้วกดบันทึก`);
}

function handleItemImageSelected(e) {
  const file = e.target.files[0];
  e.target.value = ""; // เลือกไฟล์เดิมซ้ำได้อีกครั้ง
  if (!file) return;
  pantryState.selectedImageFile = file;
  renderItemImagePreview();
}

function renderItemImagePreview() {
  const img = document.getElementById("item-image-preview");
  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);

  if (pantryState.selectedImageFile) {
    img.src = URL.createObjectURL(pantryState.selectedImageFile);
  } else {
    img.src = pantryState.lookup.imageUrl || PLACEHOLDER_IMAGE;
  }
}

async function handleSaveItem(e) {
  e.preventDefault();
  const noExpiry = document.getElementById("item-no-expiry").checked;
  const expiryDate = document.getElementById("item-expiry").value;

  if (!noExpiry && !expiryDate) {
    alert("กรุณาใส่วันหมดอายุ หรือติ๊ก \"ไม่มีวันหมดอายุบนฉลาก\"");
    return;
  }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  let imageUrl = pantryState.lookup.imageUrl;
  if (pantryState.selectedImageFile) {
    try {
      imageUrl = await uploadProductImage(pantryState.selectedImageFile);
    } catch (err) {
      submitBtn.disabled = false;
      alert(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
      return;
    }
  }

  const note = document.getElementById("item-note").value.trim();
  const payload = {
    name: document.getElementById("item-name").value.trim(),
    item_type: getChoice("item-type") || "other",
    location: getChoice("item-location") || "other",
    quantity: Number(document.getElementById("item-quantity").value),
    unit: document.getElementById("item-unit").value.trim() || "ชิ้น",
    expiry_date: noExpiry ? null : expiryDate,
    date_kind: getChoice("item-date-kind") || "exp",
    note: note || null,
    image_url: imageUrl,
    barcode: pantryState.lookup.barcode,
    product_id: pantryState.lookup.productId,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (pantryState.editingItem) {
    ({ error } = await supabaseClient
      .from("pantry_items")
      .update(payload)
      .eq("id", pantryState.editingItem.id));
  } else {
    ({ error } = await supabaseClient.from("pantry_items").insert({
      ...payload,
      household_id: pantryState.household.id,
      added_by: pantryState.user.id,
    }));
  }

  submitBtn.disabled = false;

  if (error) {
    console.error("save item error:", error.message);
    alert("บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่");
    return;
  }

  closeItemForm();
  await loadItems();
}

async function handleDeleteItem() {
  const item = pantryState.editingItem;
  if (!item) return;
  // ลบ = บันทึกผิด ไม่นับในรายงาน ต่างจาก "ใช้หมด/ทิ้ง" ที่นับในรายงาน
  if (!confirm(`ลบ "${item.name}" ออกจากรายการเลยใช่หรือไม่? (ใช้กรณีบันทึกผิด จะไม่นับในรายงาน)`)) {
    return;
  }

  const { error } = await supabaseClient.from("pantry_items").delete().eq("id", item.id);
  if (error) {
    console.error("delete item error:", error.message);
    alert("ลบไม่สำเร็จ");
    return;
  }

  closeItemForm();
  await loadItems();
}
