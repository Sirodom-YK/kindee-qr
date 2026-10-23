async function renderSampleProducts() {
  const grid = document.getElementById("product-grid");
  const products = await getAllProducts();

  if (products.length === 0) {
    grid.innerHTML = '<p class="text-muted">ยังไม่มีสินค้าในระบบ หรือเกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล</p>';
    return;
  }

  products.forEach((product) => {
    grid.appendChild(createProductCardElement(product));
  });
}

renderSampleProducts();
