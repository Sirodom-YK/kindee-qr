// สถานะการเข้าสู่ระบบของผู้ใช้ทั่วไป (ระบบของในบ้าน) — ใช้ Supabase Auth แบบอีเมล + รหัสผ่าน
// หน้าไหนต้อง login ก่อน เรียก requireLogin() ตอนเริ่มหน้า

async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.user || null;
}

// ถ้ายังไม่ login ส่งไปหน้า login พร้อมจำหน้าที่จะกลับมา (login.html?next=pantry.html)
async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) {
    const here = window.location.pathname.split("/").pop() + window.location.search;
    window.location.href = `login.html?next=${encodeURIComponent(here)}`;
    return null;
  }
  return user;
}

// รับเฉพาะชื่อหน้าในเว็บเราเอง (เช่น "pantry.html?x=1") กันไม่ให้ลิงก์ ?next= พาไปเว็บอื่น (open redirect)
function getSafeNextPage(next) {
  return next && /^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(next) ? next : "pantry.html";
}

async function signOutAndGoHome() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}
