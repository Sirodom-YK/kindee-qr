let currentEditId = null;
// รูปที่ผู้ดูแลถ่าย/เลือกจากเครื่อง — อัปโหลดตอนกดบันทึกเท่านั้น (ยกเลิกฟอร์มแล้วไม่มีไฟล์ค้าง)
let adminSelectedImageFile = null;
// id ของข้อมูลจากผู้ใช้ที่กำลังอนุมัติอยู่ในฟอร์ม — บันทึกสินค้าสำเร็จแล้วจะเปลี่ยนสถานะเป็น approved
let currentSubmissionId = null;

document.addEventListener("DOMContentLoaded", async () => {
  await refreshAuthUI();

  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);
  document.getElementById("not-admin-logout-btn").addEventListener("click", handleLogout);
  document.getElementById("add-product-btn").addEventListener("click", () => openProductForm(null));
  document.getElementById("cancel-form-btn").addEventListener("click", closeProductForm);
  document.getElementById("product-form").addEventListener("submit", handleSaveProduct);

  document.getElementById("field-image-camera").addEventListener("change", handleAdminImageSelected);
  document.getElementById("field-image-file").addEventListener("change", handleAdminImageSelected);
  document.getElementById("field-image-clear").addEventListener("click", () => {
    adminSelectedImageFile = null;
    document.getElementById("field-image").value = "";
    renderAdminImagePreview();
  });
  // พิมพ์/วาง URL เองแทนการเลือกไฟล์
  document.getElementById("field-image").addEventListener("input", () => {
    adminSelectedImageFile = null;
    renderAdminImagePreview();
  });
});

function handleAdminImageSelected(e) {
  const file = e.target.files[0];
  e.target.value = ""; // เลือกไฟล์เดิมซ้ำได้อีกครั้ง
  if (!file) return;
  adminSelectedImageFile = file;
  renderAdminImagePreview();
}

function renderAdminImagePreview() {
  const img = document.getElementById("field-image-preview");
  const status = document.getElementById("field-image-status");
  const url = document.getElementById("field-image").value.trim();

  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);

  if (adminSelectedImageFile) {
    img.src = URL.createObjectURL(adminSelectedImageFile);
    status.textContent = "รูปใหม่ — จะอัปโหลดเมื่อกดบันทึก";
  } else if (url) {
    img.src = url;
    status.textContent = "ใช้รูปจาก URL ด้านล่าง";
  } else {
    img.src = "assets/images/placeholder-product.svg";
    status.textContent = "ยังไม่มีรูปสินค้า";
  }
}

async function refreshAuthUI() {
  const { data } = await supabaseClient.auth.getSession();
  const isLoggedIn = Boolean(data.session);
  // ผู้ใช้ทั่วไปก็ login ได้แล้ว (ระบบของในบ้าน) จึงต้องเช็กว่าอยู่ในตาราง app_admins ด้วย
  // การซ่อนหน้านี้เป็นแค่ UX — สิทธิ์จริงบังคับด้วย RLS is_admin() ใน supabase/admin-role.sql
  const isAdmin = isLoggedIn && (await checkIsAdmin(data.session.user.id));

  document.getElementById("login-section").style.display = isLoggedIn ? "none" : "block";
  document.getElementById("not-admin-section").style.display =
    isLoggedIn && !isAdmin ? "block" : "none";
  document.getElementById("admin-panel").style.display = isAdmin ? "block" : "none";

  if (isAdmin) {
    await loadSubmissionList();
    await loadProductList();
    await openFormFromBarcodeParam();
  }
}

async function checkIsAdmin(userId) {
  const { data, error } = await supabaseClient
    .from("app_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("checkIsAdmin error:", error.message);
    return false;
  }
  return Boolean(data);
}

// เปิดจากปุ่ม "เพิ่มข้อมูลจากฉลากเข้าระบบ" ในหน้ารายละเอียด (admin.html?barcode=...)
// ถ้ามีในระบบแล้วให้แก้ไขตัวเดิม ถ้ายังไม่มีให้เติมค่าที่ Open Food Facts มีอยู่แล้วไว้ให้ก่อน
// ผู้ดูแลกรอกส่วนที่ขาดตามฉลากจริง — ทำครั้งเดียว ไม่เปิดซ้ำหลังบันทึก
let hasHandledBarcodeParam = false;

async function openFormFromBarcodeParam() {
  if (hasHandledBarcodeParam) return;
  hasHandledBarcodeParam = true;

  const barcode = new URLSearchParams(window.location.search).get("barcode");
  if (!barcode) return;

  const localProduct = await getProductByBarcode(barcode);
  if (localProduct) {
    openProductForm(localProduct);
    return;
  }

  const offProduct = await getProductFromOpenFoodFacts(barcode);
  openProductForm(offProduct || { barcode });
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.style.display = "none";

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.textContent = "เข้าสู่ระบบไม่สำเร็จ: อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    errorEl.style.display = "block";
    return;
  }

  document.getElementById("login-password").value = "";
  await refreshAuthUI();
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  await refreshAuthUI();
}

async function loadProductList() {
  const listEl = document.getElementById("product-list");
  listEl.innerHTML = "";

  const products = await getAllProducts();

  if (products.length === 0) {
    const p = document.createElement("p");
    p.className = "text-muted";
    p.textContent = "ยังไม่มีสินค้าในระบบ";
    listEl.appendChild(p);
    return;
  }

  products.forEach((product) => {
    listEl.appendChild(createAdminProductRow(product));
  });
}

function createAdminProductRow(product) {
  const row = document.createElement("div");
  row.className = "card";

  const title = document.createElement("h3");
  title.textContent = product.name;
  row.appendChild(title);

  const metaParts = [product.brand, product.qr_code_value && `QR: ${product.qr_code_value}`, product.barcode && `บาร์โค้ด: ${product.barcode}`].filter(Boolean);
  const meta = document.createElement("p");
  meta.className = "text-muted";
  meta.textContent = metaParts.join(" • ");
  row.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn-secondary";
  editBtn.textContent = "แก้ไข";
  editBtn.addEventListener("click", () => openProductForm(product));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-secondary";
  deleteBtn.textContent = "ลบ";
  deleteBtn.addEventListener("click", () => handleDeleteProduct(product));
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  return row;
}

function openProductForm(product) {
  // product ที่ไม่มี id คือค่าตั้งต้นสำหรับสินค้าใหม่ (เช่น เติมจาก Open Food Facts) ไม่ใช่การแก้ไข
  currentEditId = product?.id || null;
  // reviewSubmission() จะตั้งค่านี้ใหม่หลังเรียกฟังก์ชันนี้ — การเปิดฟอร์มแบบอื่นต้องไม่ไปอนุมัติข้อมูลผู้ใช้ค้างไว้
  currentSubmissionId = null;
  document.getElementById("form-submission-notice").style.display = "none";
  document.getElementById("form-title").textContent = currentEditId ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่";

  document.getElementById("field-name").value = product?.name || "";
  document.getElementById("field-brand").value = product?.brand || "";
  document.getElementById("field-barcode").value = product?.barcode || "";
  document.getElementById("field-qr").value = product?.qr_code_value || "";
  document.getElementById("field-image").value = product?.image_url || "";
  adminSelectedImageFile = null;
  renderAdminImagePreview();
  document.getElementById("field-category").value = product?.category || "";
  document.getElementById("field-type").value = product?.product_type || "";
  document.getElementById("field-ingredients").value = product?.ingredients || "";
  document.getElementById("field-allergens").value = product?.allergens || "";
  document.querySelectorAll("[data-nutrient]").forEach((input) => {
    input.value = product?.nutrition?.[input.dataset.nutrient] ?? "";
  });
  document.getElementById("field-usage").value = product?.usage_instructions || "";
  document.getElementById("field-warnings").value = product?.warnings || "";
  document.getElementById("field-source").value = product?.source_url || "";

  document.getElementById("product-form-section").style.display = "block";
}

function closeProductForm() {
  currentEditId = null;
  currentSubmissionId = null;
  document.getElementById("form-submission-notice").style.display = "none";
  document.getElementById("product-form").reset();
  adminSelectedImageFile = null;
  renderAdminImagePreview();
  document.getElementById("product-form-section").style.display = "none";
}

async function handleSaveProduct(e) {
  e.preventDefault();

  if (adminSelectedImageFile) {
    try {
      document.getElementById("field-image").value = await uploadProductImage(adminSelectedImageFile);
      adminSelectedImageFile = null;
    } catch (err) {
      alert(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
      return;
    }
  }

  const payload = {
    name: document.getElementById("field-name").value.trim(),
    brand: emptyToNull(document.getElementById("field-brand").value),
    barcode: emptyToNull(document.getElementById("field-barcode").value),
    qr_code_value: emptyToNull(document.getElementById("field-qr").value),
    image_url: emptyToNull(document.getElementById("field-image").value),
    category: emptyToNull(document.getElementById("field-category").value),
    product_type: emptyToNull(document.getElementById("field-type").value),
    ingredients: emptyToNull(document.getElementById("field-ingredients").value),
    allergens: emptyToNull(document.getElementById("field-allergens").value),
    nutrition: readNutritionInputs(),
    usage_instructions: emptyToNull(document.getElementById("field-usage").value),
    warnings: emptyToNull(document.getElementById("field-warnings").value),
    source_url: emptyToNull(document.getElementById("field-source").value),
    updated_at: new Date().toISOString(),
  };

  let error;
  let savedId = currentEditId;
  if (currentEditId) {
    ({ error } = await supabaseClient.from("products").update(payload).eq("id", currentEditId));
  } else {
    let data;
    ({ data, error } = await supabaseClient.from("products").insert(payload).select("id").single());
    savedId = data?.id;
  }

  if (error) {
    alert(`บันทึกไม่สำเร็จ: ${error.message}`);
    return;
  }

  if (currentSubmissionId) {
    await markSubmission(currentSubmissionId, "approved", savedId);
  }

  closeProductForm();
  await loadSubmissionList();
  await loadProductList();
}

async function loadSubmissionList() {
  const listEl = document.getElementById("submission-list");
  listEl.innerHTML = "";

  const { data, error } = await supabaseClient
    .from("product_submissions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("loadSubmissionList error:", error.message);
    const p = document.createElement("p");
    p.className = "text-muted";
    p.textContent = "โหลดข้อมูลจากผู้ใช้ไม่สำเร็จ (ได้รัน supabase/submissions.sql แล้วหรือยัง?)";
    listEl.appendChild(p);
    return;
  }

  if (data.length === 0) {
    const p = document.createElement("p");
    p.className = "text-muted";
    p.textContent = "ไม่มีข้อมูลรอตรวจสอบ";
    listEl.appendChild(p);
    return;
  }

  // ข้อมูลแบบ "เสนอแก้ไข" ต้องเทียบกับสินค้าตัวจริง จึงโหลดสินค้าเป้าหมายทั้งหมดมาครั้งเดียว
  const targetIds = [...new Set(data.map((s) => s.target_product_id).filter(Boolean))];
  const targets = {};
  if (targetIds.length > 0) {
    const { data: products } = await supabaseClient.from("products").select("*").in("id", targetIds);
    (products || []).forEach((product) => {
      targets[product.id] = product;
    });
  }

  data.forEach((submission) => {
    listEl.appendChild(createSubmissionRow(submission, targets[submission.target_product_id]));
  });
}

const SUBMISSION_FIELDS = [
  ["name", "ชื่อสินค้า"],
  ["brand", "แบรนด์"],
  ["barcode", "บาร์โค้ด"],
  ["category", "หมวดหมู่"],
  ["ingredients", "ส่วนประกอบ"],
  ["allergens", "สารก่อภูมิแพ้"],
  ["nutrition", "โภชนาการ"],
  ["usage_instructions", "วิธีเก็บรักษา/รับประทาน"],
  ["warnings", "คำเตือน"],
];

function formatSubmissionValue(key, value) {
  if (key === "nutrition") return formatNutritionText(value);
  if (key === "category") return CATEGORY_LABELS[value] || value;
  return value;
}

// ใช้ DOM API แทน innerHTML เพราะทุกช่องเป็นข้อความที่ผู้ใช้ทั่วไปพิมพ์เข้ามา (ป้องกัน XSS)
// target = สินค้าในระบบที่ผู้ใช้เสนอแก้ไข (ถ้ามี) — ช่องที่ต่างจากเดิมจะถูกไฮไลต์พร้อมค่าเดิม
function createSubmissionRow(submission, target) {
  const row = document.createElement("div");
  row.className = "card";

  const kindBadge = document.createElement("span");
  kindBadge.className = "badge";
  kindBadge.textContent = target ? "เสนอแก้ไขสินค้าเดิม" : "สินค้าใหม่";
  row.appendChild(kindBadge);

  if (submission.image_url) {
    const img = document.createElement("img");
    img.src = submission.image_url;
    img.alt = submission.name;
    img.className = "submission-image";
    if (target && submission.image_url !== target.image_url) img.classList.add("changed-image");
    row.appendChild(img);
  }

  const title = document.createElement("h3");
  title.textContent = target ? `${target.name} → แก้ไขโดยผู้ใช้` : submission.name;
  row.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "text-muted";
  meta.textContent = `ส่งเมื่อ ${new Date(submission.created_at).toLocaleString("th-TH")}${
    target && submission.image_url !== target.image_url ? " • มีรูปใหม่" : ""
  }`;
  row.appendChild(meta);

  SUBMISSION_FIELDS.forEach(([key, label]) => {
    const value = formatSubmissionValue(key, submission[key]);
    const oldValue = target ? formatSubmissionValue(key, target[key]) : null;
    const changed = Boolean(target) && (value || null) !== (oldValue || null);
    if (!value && !changed) return;

    const p = document.createElement("p");
    p.style.whiteSpace = "pre-line";
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    p.appendChild(strong);

    const span = document.createElement("span");
    span.textContent = value || "(ลบออก)";
    if (changed) span.className = "changed-field";
    p.appendChild(span);

    if (changed) {
      const old = document.createElement("span");
      old.className = "text-muted";
      old.textContent = ` (เดิม: ${oldValue || "ไม่มีข้อมูล"})`;
      p.appendChild(old);
    }
    row.appendChild(p);
  });

  if (submission.note) {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = "หมายเหตุจากผู้ส่ง: ";
    p.appendChild(strong);
    p.appendChild(document.createTextNode(submission.note));
    row.appendChild(p);
  }

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn btn-primary";
  approveBtn.textContent = "ตรวจสอบและอนุมัติ";
  approveBtn.addEventListener("click", () => reviewSubmission(submission, target));
  actions.appendChild(approveBtn);

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "btn btn-secondary";
  rejectBtn.textContent = "ปฏิเสธ";
  rejectBtn.addEventListener("click", () => handleRejectSubmission(submission, target));
  actions.appendChild(rejectBtn);

  row.appendChild(actions);
  return row;
}

// เปิดฟอร์มสินค้าพร้อมข้อมูลที่ผู้ใช้ส่งมาให้ผู้ดูแลตรวจ/แก้ก่อนบันทึก
// - เสนอแก้ไข (มี target): ใช้ค่าที่ผู้ใช้แก้แทนค่าเดิมทั้งหมด (ฟอร์มผู้ใช้เติมค่าเดิมไว้ให้แล้ว
//   ช่องที่ไม่ได้แตะจึงเท่าเดิม) แต่ถ้าผู้ใช้ไม่ได้ส่งรูปมา จะใช้รูปเดิม
// - สินค้าใหม่ แต่บาร์โค้ดซ้ำกับที่มีในระบบ: เติมเฉพาะช่องที่ยังว่าง ไม่ทับข้อมูลเดิม
async function reviewSubmission(submission, target) {
  const fromSubmission = {};
  SUBMISSION_FIELDS.forEach(([key]) => {
    fromSubmission[key] = submission[key];
  });
  fromSubmission.image_url = submission.image_url;

  let product = fromSubmission;
  if (target) {
    product = { ...target, ...fromSubmission, image_url: submission.image_url || target.image_url };
  } else {
    const existing = submission.barcode ? await getProductByBarcode(submission.barcode) : null;
    if (existing) {
      product = { ...existing };
      Object.entries(fromSubmission).forEach(([key, value]) => {
        if (!product[key] && value) product[key] = value;
      });
      product.nutrition = { ...(fromSubmission.nutrition || {}), ...(existing.nutrition || {}) };
    }
  }

  openProductForm(product);
  currentSubmissionId = submission.id;
  document.getElementById("form-submission-notice").style.display = "block";
  document.getElementById("product-form-section").scrollIntoView({ behavior: "smooth" });
}

async function handleRejectSubmission(submission, target) {
  const confirmed = confirm(`ปฏิเสธข้อมูล "${submission.name}" ใช่หรือไม่? ข้อมูลนี้จะไม่แสดงบนเว็บ`);
  if (!confirmed) return;

  await markSubmission(submission.id, "rejected", null);
  if (submission.image_url !== target?.image_url) {
    await deleteSubmissionImage(submission.image_url);
  }
  await loadSubmissionList();
}

// ลบเฉพาะไฟล์ที่ผู้ใช้อัปโหลดเข้า bucket ของเรา (รูปจาก Open Food Facts หรือรูปเดิมของสินค้าไม่ลบ)
async function deleteSubmissionImage(imageUrl) {
  const marker = "/storage/v1/object/public/submission-images/";
  if (!imageUrl || !imageUrl.includes(marker)) return;

  const path = decodeURIComponent(imageUrl.split(marker)[1]);
  const { error } = await supabaseClient.storage.from("submission-images").remove([path]);
  if (error) console.error("deleteSubmissionImage error:", error.message);
}

async function markSubmission(submissionId, status, productId) {
  const { error } = await supabaseClient
    .from("product_submissions")
    .update({ status, product_id: productId, reviewed_at: new Date().toISOString() })
    .eq("id", submissionId);

  if (error) {
    alert(`อัปเดตสถานะข้อมูลจากผู้ใช้ไม่สำเร็จ: ${error.message}`);
  }
}

function emptyToNull(value) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function handleDeleteProduct(product) {
  const confirmed = confirm(`ยืนยันการลบสินค้า "${product.name}" ใช่หรือไม่?`);
  if (!confirmed) return;

  const { error } = await supabaseClient.from("products").delete().eq("id", product.id);

  if (error) {
    alert(`ลบไม่สำเร็จ: ${error.message}`);
    return;
  }

  await loadProductList();
}
