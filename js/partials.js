async function loadPartials() {
  const [headerHtml, footerHtml] = await Promise.all([
    fetch("partials/header.html").then((r) => r.text()),
    fetch("partials/footer.html").then((r) => r.text()),
  ]);

  document.getElementById("site-header").innerHTML = headerHtml;
  document.getElementById("site-footer").innerHTML = footerHtml;

  highlightActiveNav();
  await updateAccountNav();
}

// เมนูบัญชี: login แล้วไปหน้าบ้านของฉัน ยังไม่ login ไปหน้าเข้าสู่ระบบ
// partials.js โหลดก่อน supabase-client.js แต่ fetch ด้านบนเสร็จหลังทุกสคริปต์รันแล้ว จึงใช้ supabaseClient ได้
async function updateAccountNav() {
  const link = document.getElementById("nav-account");
  if (!link || typeof supabaseClient === "undefined") return;

  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    link.href = "household.html";
    link.textContent = "บ้านของฉัน";
  }
}

function highlightActiveNav() {
  const currentPage = document.body.dataset.page;
  document.querySelectorAll(".nav-link").forEach((link) => {
    if (link.dataset.page === currentPage) {
      link.classList.add("active");
    }
  });
}

loadPartials();
