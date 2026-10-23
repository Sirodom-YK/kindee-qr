// หน้า "ของในบ้าน": รายการของของบ้านที่เลือก แยกกลุ่มตามวันหมดอายุ + ฟอร์มเพิ่ม/แก้ไข
// ทุกคนในบ้านเห็นและแก้รายการชุดเดียวกัน — สิทธิ์บังคับด้วย RLS is_household_member() ใน supabase/pantry.sql

const PLACEHOLDER_IMAGE = "assets/images/placeholder-product.svg";

const GROUPS = [
  { status: "expired", title: "🔴 หมดอายุแล้ว" },
  { status: "soon", title: `🟠 ใกล้หมดอายุ (ภายใน ${SOON_DAYS} วัน)` },
  { status: "ok", title: "🟢 ยังอีกนาน" },
  { status: "none", title: "⚪ ไม่ระบุวันหมดอายุ" },
];

const pantryState = {
  user: null,
  household: null,
  members: {}, // user_id → display_name ใช้แสดงว่าใครเพิ่มของ
  items: [],
  editingItem: null,
  // ข้อมูลจากการสแกน/พิมพ์บาร์โค้ด ใช้ผูกกับสินค้าในระบบ
  lookup: { barcode: null, productId: null, imageUrl: null },
  selectedImageFile: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  pantryState.user = await requireLogin();
  if (!pantryState.user) return;

  fillSelect("filter-location", LOCATION_LABELS);
  fillSelect("filter-type", ITEM_TYPE_LABELS);
  fillSelect("item-location", LOCATION_LABELS);
  fillSelect("item-type", ITEM_TYPE_LABELS);

  document.getElementById("add-item-btn").addEventListener("click", () => openItemForm(null));
  document.getElementById("cancel-item-btn").addEventListener("click", closeItemForm);
  document.getElementById("delete-item-btn").addEventListener("click", handleDeleteItem);
  document.getElementById("item-form").addEventListener("submit", handleSaveItem);
  document.getElementById("filter-location").addEventListener("change", renderItems);
  document.getElementById("filter-type").addEventListener("change", renderItems);
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
  document.getElementById("item-image-camera").addEventListener("change", handleItemImageSelected);
  document.getElementById("item-image-file").addEventListener("change", handleItemImageSelected);

  await loadHousehold();
});

function fillSelect(id, labels) {
  const select = document.getElementById(id);
  Object.entries(labels).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
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

  line.textContent = "";
  line.appendChild(document.createTextNode(`🏠 ${pantryState.household.name} · `));
  const manageLink = document.createElement("a");
  manageLink.href = "household.html";
  manageLink.textContent = households.length > 1 ? "เปลี่ยนบ้าน/เชิญสมาชิก" : "เชิญสมาชิก";
  line.appendChild(manageLink);

  document.getElementById("pantry-panel").style.display = "block";
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
  const location = document.getElementById("filter-location").value;
  const type = document.getElementById("filter-type").value;
  const items = pantryState.items.filter(
    (item) => (!location || item.location === location) && (!type || item.item_type === type)
  );

  renderBanner();

  const container = document.getElementById("pantry-groups");
  container.innerHTML = "";

  if (items.length === 0) {
    const p = document.createElement("p");
    p.className = "text-muted";
    p.textContent =
      pantryState.items.length === 0
        ? "ยังไม่มีของในบ้าน กด \"+ เพิ่มของ\" เพื่อเริ่มบันทึก"
        : "ไม่มีของที่ตรงกับตัวกรอง";
    container.appendChild(p);
    return;
  }

  GROUPS.forEach(({ status, title }) => {
    const groupItems = items.filter((item) => getExpiryStatus(item) === status);
    if (groupItems.length === 0) return;

    const section = document.createElement("section");
    const h2 = document.createElement("h2");
    h2.textContent = `${title} · ${groupItems.length}`;
    section.appendChild(h2);

    const list = document.createElement("div");
    list.className = "pantry-list";
    groupItems.forEach((item) => list.appendChild(createItemCard(item, status)));
    section.appendChild(list);

    container.appendChild(section);
  });
}

// แบนเนอร์ด้านบนนับจากรายการทั้งหมด (ไม่สนตัวกรอง) เพื่อไม่ให้พลาดของที่ใกล้หมด
function renderBanner() {
  const expired = pantryState.items.filter((i) => getExpiryStatus(i) === "expired").length;
  const soon = pantryState.items.filter((i) => getExpiryStatus(i) === "soon").length;
  const banner = document.getElementById("expiry-banner");

  const parts = [];
  if (expired > 0) parts.push(`หมดอายุแล้ว ${expired} รายการ`);
  if (soon > 0) parts.push(`ใกล้หมดอายุภายใน ${SOON_DAYS} วัน ${soon} รายการ`);

  banner.textContent = parts.length > 0 ? `⚠️ ${parts.join(" · ")}` : "";
  banner.style.display = parts.length > 0 ? "block" : "none";
}

// ใช้ DOM API แทน innerHTML เพราะชื่อ/หมายเหตุเป็นข้อความที่สมาชิกพิมพ์เอง
function createItemCard(item, status) {
  const card = document.createElement("article");
  card.className = `card pantry-item pantry-item-${status}`;

  const img = document.createElement("img");
  img.src = item.image_url || PLACEHOLDER_IMAGE;
  img.alt = item.name;
  card.appendChild(img);

  const body = document.createElement("div");
  body.className = "pantry-item-body";

  const h3 = document.createElement("h3");
  h3.textContent = item.name;
  body.appendChild(h3);

  const meta = document.createElement("p");
  meta.className = "text-muted";
  meta.textContent = [
    LOCATION_LABELS[item.location],
    `${formatQuantity(item.quantity)} ${item.unit}`,
    pantryState.members[item.added_by] && `เพิ่มโดย ${pantryState.members[item.added_by]}`,
  ]
    .filter(Boolean)
    .join(" • ");
  body.appendChild(meta);

  const expiry = document.createElement("p");
  expiry.className = "pantry-item-expiry";
  expiry.textContent = item.expiry_date
    ? `${DATE_KIND_LABELS[item.date_kind]} ${formatThaiDate(item.expiry_date)} (${describeDaysLeft(item)})`
    : describeDaysLeft(item);
  body.appendChild(expiry);

  if (item.note) {
    const note = document.createElement("p");
    note.className = "text-muted";
    note.textContent = item.note;
    body.appendChild(note);
  }

  const actions = document.createElement("div");
  actions.className = "hero-actions";
  actions.appendChild(createActionButton("−1", () => handleUseOne(item)));
  actions.appendChild(createActionButton("✅ ใช้หมดแล้ว", () => finishItem(item, "used")));
  actions.appendChild(createActionButton("🗑️ ทิ้ง", () => finishItem(item, "discarded")));
  actions.appendChild(createActionButton("แก้ไข", () => openItemForm(item)));
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function createActionButton(text, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary btn-small";
  btn.textContent = text;
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
  document.getElementById("delete-item-btn").style.display = item ? "inline-block" : "none";
  setLookupStatus("");
  document.getElementById("item-code-input").value = "";

  document.getElementById("item-name").value = item?.name || "";
  document.getElementById("item-type").value = item?.item_type || "food";
  document.getElementById("item-location").value = item?.location || "pantry";
  document.getElementById("item-quantity").value = item ? formatQuantity(item.quantity) : "1";
  document.getElementById("item-unit").value = item?.unit || "ชิ้น";
  document.getElementById("item-expiry").value = item?.expiry_date || "";
  document.getElementById("item-date-kind").value = item?.date_kind || "exp";
  const noExpiry = Boolean(item) && !item.expiry_date;
  document.getElementById("item-no-expiry").checked = noExpiry;
  document.getElementById("item-expiry").disabled = noExpiry;
  document.getElementById("item-note").value = item?.note || "";
  renderItemImagePreview();
  clearExpiryOcrResult(); // อยู่ใน js/pantry-ocr.js

  const section = document.getElementById("item-form-section");
  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth" });
}

function closeItemForm() {
  stopBarcodeScanner();
  pantryState.editingItem = null;
  document.getElementById("item-form").reset();
  document.getElementById("item-form-section").style.display = "none";
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
  document.getElementById("item-type").value = guessItemType(product);
  renderItemImagePreview();
  setLookupStatus(`พบ: ${product.name} — ตรวจข้อมูลแล้วใส่วันหมดอายุด้านล่าง`);
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

  let imageUrl = pantryState.lookup.imageUrl;
  if (pantryState.selectedImageFile) {
    try {
      imageUrl = await uploadProductImage(pantryState.selectedImageFile);
    } catch (err) {
      alert(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
      return;
    }
  }

  const note = document.getElementById("item-note").value.trim();
  const payload = {
    name: document.getElementById("item-name").value.trim(),
    item_type: document.getElementById("item-type").value,
    location: document.getElementById("item-location").value,
    quantity: Number(document.getElementById("item-quantity").value),
    unit: document.getElementById("item-unit").value.trim() || "ชิ้น",
    expiry_date: noExpiry ? null : expiryDate,
    date_kind: document.getElementById("item-date-kind").value,
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
