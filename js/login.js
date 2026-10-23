// หน้าเข้าสู่ระบบ/สมัครสมาชิกของผู้ใช้ทั่วไป (Supabase Auth แบบอีเมล + รหัสผ่าน)
// สิทธิ์ผู้ดูแลแยกอยู่ในตาราง app_admins — สมัครที่นี่ได้แค่บัญชีผู้ใช้ทั่วไป

const nextPage = getSafeNextPage(new URLSearchParams(window.location.search).get("next"));
// ลิงก์ในอีเมล (ยืนยันสมัคร/ตั้งรหัสผ่านใหม่) ต้องกลับมาที่หน้านี้ของเว็บเรา
const authRedirectUrl = new URL("login.html", window.location.href).href;

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("auth-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (btn) showPanel(btn.dataset.tab);
  });

  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("signup-form").addEventListener("submit", handleSignup);
  document.getElementById("forgot-form").addEventListener("submit", handleForgot);
  document.getElementById("reset-form").addEventListener("submit", handleResetPassword);

  // กดลิงก์ "ตั้งรหัสผ่านใหม่" จากอีเมล → supabase-js อ่าน token จาก URL แล้วส่ง event นี้
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") showPanel("reset");
  });

  // login อยู่แล้ว (และไม่ได้มาตั้งรหัสผ่านใหม่) → ไปหน้าที่ตั้งใจจะไปเลย
  const isRecovery = window.location.hash.includes("type=recovery");
  if (!isRecovery && (await getCurrentUser())) {
    window.location.href = nextPage;
  }
});

function showPanel(name) {
  document.querySelectorAll(".auth-panel").forEach((panel) => {
    panel.style.display = panel.id === `panel-${name}` ? "block" : "none";
  });
  document.querySelectorAll("#auth-tabs button").forEach((btn) => {
    btn.className = `btn ${btn.dataset.tab === name ? "btn-primary" : "btn-secondary"}`;
  });
  document.getElementById("auth-tabs").style.display = name === "reset" ? "none" : "flex";
  setStatus("");
}

function setStatus(text) {
  const el = document.getElementById("auth-status");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}

// แปลง error ของ Supabase Auth ที่เจอบ่อยเป็นภาษาไทย
function describeAuthError(error) {
  const message = error.message || "";
  if (/invalid login credentials/i.test(message)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/email not confirmed/i.test(message)) return "ยังไม่ได้ยืนยันอีเมล — กดลิงก์ในอีเมลที่ระบบส่งไปก่อน";
  if (/already registered/i.test(message)) return "อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบ หรือกด \"ลืมรหัสผ่าน\"";
  if (/password/i.test(message)) return "รหัสผ่านไม่ผ่านเงื่อนไข (อย่างน้อย 8 ตัวอักษร)";
  if (/rate limit|too many/i.test(message)) return "ส่งคำขอบ่อยเกินไป รอสักครู่แล้วลองใหม่";
  return "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

async function handleLogin(e) {
  e.preventDefault();
  setStatus("กำลังเข้าสู่ระบบ...");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: document.getElementById("login-email").value.trim(),
    password: document.getElementById("login-password").value,
  });

  if (error) {
    setStatus(describeAuthError(error));
    return;
  }
  window.location.href = nextPage;
}

async function handleSignup(e) {
  e.preventDefault();
  const password = document.getElementById("signup-password").value;
  if (password !== document.getElementById("signup-password2").value) {
    setStatus("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    return;
  }

  setStatus("กำลังสมัครสมาชิก...");
  const { data, error } = await supabaseClient.auth.signUp({
    email: document.getElementById("signup-email").value.trim(),
    password,
    options: { emailRedirectTo: authRedirectUrl },
  });

  if (error) {
    setStatus(describeAuthError(error));
    return;
  }

  // ถ้าโปรเจกต์เปิด "Confirm email" ไว้ จะยังไม่มี session จนกว่าผู้ใช้จะกดลิงก์ในอีเมล
  if (!data.session) {
    setStatus("สมัครสำเร็จ! กรุณาเปิดอีเมลแล้วกดลิงก์ยืนยัน จากนั้นกลับมาเข้าสู่ระบบ");
    document.getElementById("signup-form").reset();
    return;
  }
  window.location.href = nextPage;
}

async function handleForgot(e) {
  e.preventDefault();
  setStatus("กำลังส่งอีเมล...");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(
    document.getElementById("forgot-email").value.trim(),
    { redirectTo: authRedirectUrl }
  );

  // ตอบข้อความเดียวกันไม่ว่าอีเมลจะมีในระบบหรือไม่ — ไม่บอกใบ้ว่าใครเป็นสมาชิก
  setStatus(
    error && /rate limit|too many/i.test(error.message)
      ? describeAuthError(error)
      : "ถ้าอีเมลนี้มีในระบบ จะได้รับลิงก์ตั้งรหัสผ่านใหม่ภายในไม่กี่นาที"
  );
}

async function handleResetPassword(e) {
  e.preventDefault();
  setStatus("กำลังบันทึก...");
  const { error } = await supabaseClient.auth.updateUser({
    password: document.getElementById("reset-password").value,
  });

  if (error) {
    setStatus(describeAuthError(error));
    return;
  }
  setStatus("ตั้งรหัสผ่านใหม่เรียบร้อย กำลังพาไปหน้าของในบ้าน...");
  setTimeout(() => {
    window.location.href = "pantry.html";
  }, 1200);
}
