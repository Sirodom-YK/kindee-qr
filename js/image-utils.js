// ย่อรูปฝั่งเบราว์เซอร์ด้วย canvas ก่อนส่งขึ้นเซิร์ฟเวอร์ (ใช้ทั้งตอนให้ AI อ่านฉลาก และตอนผู้ใช้อัปโหลดรูปสินค้า)
// ผลลัพธ์เป็น JPEG เสมอ — ช่วยตัดข้อมูลแฝงในไฟล์ (เช่น พิกัด GPS ใน EXIF) ออกไปด้วย

function resizeImageToBase64(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ไม่สามารถเปิดไฟล์รูปภาพนี้ได้"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// แบบ Blob สำหรับอัปโหลดเข้า Supabase Storage
async function resizeImageToBlob(file, maxDimension, quality) {
  const { base64, mimeType } = await resizeImageToBase64(file, maxDimension, quality);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

// อัปโหลดรูปสินค้า (ย่อเป็น JPEG 1024px ก่อน) เข้า Supabase Storage แล้วคืน public URL
// ใช้ทั้งฟอร์มส่งข้อมูลของผู้ใช้และฟอร์ม Admin — bucket และสิทธิ์ตั้งไว้ใน supabase/submission-edits.sql
// ชื่อไฟล์เป็น UUID สุ่ม เดาหรือทับไฟล์ของคนอื่นไม่ได้
const PRODUCT_IMAGE_BUCKET = "submission-images";

async function uploadProductImage(file) {
  const blob = await resizeImageToBlob(file, 1024, 0.8);
  const path = `${crypto.randomUUID()}.jpg`;

  const { error } = await supabaseClient.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw error;

  return supabaseClient.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
