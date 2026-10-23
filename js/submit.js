// ฟอร์มให้ผู้ใช้ทั่วไปส่งข้อมูลสินค้าที่ไม่พบ/ไม่ครบ หรือเสนอแก้ไขสินค้าที่มีอยู่แล้ว
// บันทึกลงตาราง product_submissions สถานะ pending เท่านั้น (RLS บังคับไว้ใน supabase/submissions.sql)
// หน้าเว็บจะไม่แสดงข้อมูลนี้จนกว่าผู้ดูแลจะตรวจและอนุมัติเข้าตาราง products ในหน้า Admin
//
// เปิดได้ 3 แบบ:
//   submit.html?id=<uuid>      เสนอแก้ไขสินค้าในระบบ (kind = edit)
//   submit.html?barcode=...    ถ้ามีในระบบ = เสนอแก้ไข, ถ้ามีแค่ใน Open Food Facts = เติมข้อมูลนั้นไว้ให้
//   submit.html?name=...       สินค้าใหม่ที่รู้แค่ชื่อ (เช่น ค้นหาไม่พบ)

const PLACEHOLDER_IMAGE = "assets/images/placeholder-product.svg";

const submitState = {
  kind: "new",
  targetProductId: null,
  existingImageUrl: null, // รูปเดิมของสินค้า — ใช้ต่อถ้าผู้ใช้ไม่ได้เลือกรูปใหม่
  selectedImageFile: null,
  originalPayload: null, // ค่าตั้งต้นตอนเสนอแก้ไข ใช้เช็กว่าผู้ใช้แก้อะไรจริงหรือไม่
};

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("submit-form").addEventListener("submit", handleSubmitProduct);
  document.getElementById("sub-image-camera").addEventListener("change", handleImageSelected);
  document.getElementById("sub-image-file").addEventListener("change", handleImageSelected);
  document.getElementById("sub-image-reset").addEventListener("click", resetToExistingImage);

  await prefillFromParams();
});

async function prefillFromParams() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const barcode = params.get("barcode");

  let localProduct = null;
  if (id) localProduct = await getProductById(id);
  else if (barcode) localProduct = await getProductByBarcode(barcode);

  if (localProduct) {
    submitState.kind = "edit";
    submitState.targetProductId = localProduct.id;
    fillForm(localProduct);
    showEditNotice(localProduct.name);
    submitState.originalPayload = readFormPayload();
    return;
  }

  const offProduct = barcode ? await getProductFromOpenFoodFacts(barcode) : null;
  if (offProduct) {
    fillForm(offProduct);
    return;
  }

  document.getElementById("sub-barcode").value = barcode || "";
  document.getElementById("sub-name").value = params.get("name") || "";
}

function fillForm(product) {
  document.getElementById("sub-barcode").value = product.barcode || "";
  document.getElementById("sub-name").value = product.name || "";
  document.getElementById("sub-brand").value = product.brand || "";
  document.getElementById("sub-category").value = product.category || "";
  document.getElementById("sub-ingredients").value = product.ingredients || "";
  document.getElementById("sub-allergens").value = product.allergens || "";
  document.querySelectorAll("#submit-form [data-nutrient]").forEach((input) => {
    input.value = product.nutrition?.[input.dataset.nutrient] ?? "";
  });
  document.getElementById("sub-usage").value = product.usage_instructions || "";
  document.getElementById("sub-warnings").value = product.warnings || "";

  submitState.existingImageUrl =
    product.image_url && product.image_url !== PLACEHOLDER_IMAGE ? product.image_url : null;
  renderImagePreview();
}

function showEditNotice(productName) {
  const notice = document.getElementById("edit-mode-notice");
  notice.textContent = `คุณกำลังเสนอแก้ไขข้อมูลของ "${productName}" — แก้เฉพาะส่วนที่ไม่ตรงกับฉลากจริง ข้อมูลจะเปลี่ยนบนเว็บหลังทีมงานอนุมัติแล้วเท่านั้น`;
  notice.style.display = "block";
}

function handleImageSelected(e) {
  const file = e.target.files[0];
  e.target.value = ""; // เลือกไฟล์เดิมซ้ำได้อีกครั้ง
  if (!file) return;
  submitState.selectedImageFile = file;
  renderImagePreview();
}

function resetToExistingImage() {
  submitState.selectedImageFile = null;
  renderImagePreview();
}

function renderImagePreview() {
  const img = document.getElementById("sub-image-preview");
  const status = document.getElementById("sub-image-status");
  const resetBtn = document.getElementById("sub-image-reset");

  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);

  if (submitState.selectedImageFile) {
    img.src = URL.createObjectURL(submitState.selectedImageFile);
    status.textContent = "จะใช้รูปใหม่ที่คุณเลือก";
    resetBtn.style.display = submitState.existingImageUrl ? "inline-block" : "none";
    resetBtn.textContent = "ใช้รูปเดิม";
  } else if (submitState.existingImageUrl) {
    img.src = submitState.existingImageUrl;
    status.textContent = "ใช้รูปเดิมของสินค้านี้ (ถ่ายหรือเลือกรูปใหม่ได้ถ้ารูปไม่ตรงกับสินค้าจริง)";
    resetBtn.style.display = "none";
  } else {
    img.src = PLACEHOLDER_IMAGE;
    status.textContent = "ยังไม่มีรูปสินค้า — ถ่ายรูปหรือเลือกรูปจากเครื่องได้";
    resetBtn.style.display = "none";
  }
}

function readFormPayload() {
  return {
    barcode: emptyToNull(document.getElementById("sub-barcode").value),
    name: document.getElementById("sub-name").value.trim(),
    brand: emptyToNull(document.getElementById("sub-brand").value),
    category: emptyToNull(document.getElementById("sub-category").value),
    ingredients: emptyToNull(document.getElementById("sub-ingredients").value),
    allergens: emptyToNull(document.getElementById("sub-allergens").value),
    nutrition: readNutritionInputs(document.getElementById("submit-form")),
    usage_instructions: emptyToNull(document.getElementById("sub-usage").value),
    warnings: emptyToNull(document.getElementById("sub-warnings").value),
  };
}

async function handleSubmitProduct(e) {
  e.preventDefault();
  const form = e.target;
  const statusEl = document.getElementById("submit-status");
  const submitBtn = form.querySelector("button[type=submit]");

  // บอทที่กรอกทุกช่องจะเติมช่องที่ซ่อนไว้ด้วย — ทำเหมือนส่งสำเร็จแต่ไม่บันทึกจริง
  if (document.getElementById("sub-website").value) {
    renderSubmitSuccess(form, statusEl);
    return;
  }

  const payload = readFormPayload();
  if (!payload.name) return;

  statusEl.style.display = "block";
  statusEl.className = "text-muted";

  const isUnchangedEdit =
    submitState.kind === "edit" &&
    !submitState.selectedImageFile &&
    JSON.stringify(payload) === JSON.stringify(submitState.originalPayload);
  if (isUnchangedEdit) {
    statusEl.textContent = "ยังไม่ได้แก้ไขข้อมูลส่วนใดเลย";
    return;
  }

  submitBtn.disabled = true;
  statusEl.textContent = "กำลังส่งข้อมูล...";

  try {
    payload.image_url = submitState.selectedImageFile
      ? await uploadProductImage(submitState.selectedImageFile)
      : submitState.existingImageUrl;
  } catch (err) {
    console.error("upload submission image error:", err.message);
    submitBtn.disabled = false;
    statusEl.textContent = "อัปโหลดรูปไม่สำเร็จ (รองรับ JPEG/PNG/WEBP) ลองเลือกรูปใหม่ หรือส่งโดยไม่เปลี่ยนรูป";
    return;
  }

  payload.kind = submitState.kind;
  payload.target_product_id = submitState.targetProductId;
  payload.note = emptyToNull(document.getElementById("sub-note").value);

  // ไม่ใช้ .select() ต่อท้าย เพราะผู้ใช้ทั่วไปไม่มีสิทธิ์อ่านตารางนี้ (ส่งได้อย่างเดียว)
  const { error } = await supabaseClient.from("product_submissions").insert(payload);

  submitBtn.disabled = false;

  if (error) {
    console.error("submit product error:", error.message);
    statusEl.textContent = "ส่งข้อมูลไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่อีกครั้ง";
    return;
  }

  renderSubmitSuccess(form, statusEl);
}

function renderSubmitSuccess(form, statusEl) {
  form.style.display = "none";
  document.getElementById("edit-mode-notice").style.display = "none";
  statusEl.style.display = "block";
  statusEl.className = "";
  statusEl.textContent =
    "ขอบคุณที่ช่วยเพิ่มข้อมูล! ทีมงานจะตรวจสอบกับฉลากก่อน และจะแสดงบนเว็บไซต์หลังจากอนุมัติแล้ว";

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  const scanLink = document.createElement("a");
  scanLink.className = "btn btn-primary";
  scanLink.href = "scan.html";
  scanLink.textContent = "สแกนสินค้าอื่นต่อ";
  actions.appendChild(scanLink);

  statusEl.after(actions);
}

function emptyToNull(value) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
