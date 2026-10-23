// ตัวสแกนบาร์โค้ด/QR ที่ใช้ร่วมกันระหว่างหน้าสแกน (scan.html) และหน้าของในบ้าน (pantry.html)
// ใช้ไลบรารี html5-qrcode — หน้าที่ใช้ต้องโหลด https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js ก่อน
// เรียก onCode แค่ครั้งเดียวต่อการเปิดกล้องหนึ่งครั้ง แล้วปิดกล้องให้อัตโนมัติ

let activeBarcodeScanner = null;
let hasHandledBarcode = false;

function startBarcodeScanner(elementId, onCode) {
  stopBarcodeScanner();
  hasHandledBarcode = false;
  activeBarcodeScanner = new Html5QrcodeScanner(
    elementId,
    { fps: 10, qrbox: 250 },
    /* verbose= */ false
  );
  activeBarcodeScanner.render(
    (decodedText) => {
      if (hasHandledBarcode) return;
      hasHandledBarcode = true;
      stopBarcodeScanner();
      // ไลบรารีสแกนบางตัวแถมช่องว่าง/บรรทัดใหม่ติดมา ต้องตัดก่อนนำไปจับคู่กับฐานข้อมูล
      onCode(decodedText.trim());
    },
    () => {
      // เรียกซ้ำ ๆ ตลอดเวลาที่ยังหาโค้ดไม่เจอในเฟรมกล้อง — ไม่ต้องทำอะไร
    }
  );
}

function stopBarcodeScanner() {
  // กันไม่ให้ผลสแกนที่ค้างอยู่ในเฟรมสุดท้ายถูกส่งต่อหลังปิดกล้องแล้ว
  hasHandledBarcode = true;
  if (activeBarcodeScanner) {
    activeBarcodeScanner.clear().catch(() => {});
    activeBarcodeScanner = null;
  }
}

// รหัสที่ผู้ใช้พิมพ์เอง: ถ้าเป็นตัวเลขล้วน ตัดช่องว่าง/ขีดที่คนมักพิมพ์คั่นเลขบาร์โค้ด (เช่น "885 0123 456781")
// ถ้ามีตัวอักษร (เช่น QR "KINDEE-0001") คงขีดไว้ตามเดิม
function normalizeTypedCode(raw) {
  const value = raw.trim();
  return /^[\d\s-]+$/.test(value) ? value.replace(/[\s-]/g, "") : value;
}
