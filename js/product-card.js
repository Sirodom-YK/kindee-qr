// ใช้ DOM API แทน innerHTML เพราะการ์ดอาจแสดงสินค้าจาก Open Food Facts
// ซึ่งเป็นฐานข้อมูลสาธารณะที่ใครก็แก้ไขได้ ต้องป้องกัน XSS
function createProductCardElement(product) {
  const card = document.createElement("a");
  card.className = "card product-card";
  card.href = product.id
    ? `product-detail.html?id=${encodeURIComponent(product.id)}`
    : `product-detail.html?barcode=${encodeURIComponent(product.barcode)}`;

  const img = document.createElement("img");
  img.src = product.image_url || "assets/images/placeholder-product.svg";
  img.alt = product.name || "สินค้า";
  card.appendChild(img);

  const h3 = document.createElement("h3");
  h3.textContent = product.name || "ไม่มีชื่อสินค้า";
  card.appendChild(h3);

  const meta = document.createElement("p");
  meta.className = "text-muted";
  meta.textContent = [product.brand, CATEGORY_LABELS[product.category] || product.product_type]
    .filter(Boolean)
    .join(" • ");
  card.appendChild(meta);

  return card;
}
