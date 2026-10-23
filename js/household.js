// หน้าจัดการบ้าน: สร้างบ้าน, เชิญ/เข้าร่วมด้วยรหัส, ดู/เอาสมาชิกออก, ออกจากบ้าน
// การเปลี่ยนสมาชิกทั้งหมดทำผ่าน RPC ใน supabase/pantry.sql — RLS ไม่เปิดให้ insert สมาชิกตรง

let currentUser = null;
let myHouseholds = [];
let currentHousehold = null;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  document.getElementById("account-email").textContent = `เข้าสู่ระบบด้วย ${currentUser.email}`;
  document.getElementById("logout-btn").addEventListener("click", signOutAndGoHome);
  document.getElementById("create-household-form").addEventListener("submit", handleCreateHousehold);
  document.getElementById("join-household-form").addEventListener("submit", (e) => {
    e.preventDefault();
    joinWithCode(
      document.getElementById("join-code").value,
      document.getElementById("join-display").value
    );
  });
  document.getElementById("join-invite-form").addEventListener("submit", (e) => {
    e.preventDefault();
    joinWithCode(
      document.getElementById("join-invite-code").value,
      document.getElementById("join-invite-name").value
    );
  });
  document.getElementById("household-switch").addEventListener("change", (e) => {
    selectHousehold(e.target.value);
  });
  document.getElementById("create-invite-btn").addEventListener("click", handleCreateInvite);
  document.getElementById("copy-invite-btn").addEventListener("click", handleCopyInvite);
  document.getElementById("leave-household-btn").addEventListener("click", handleLeaveHousehold);
  document.getElementById("show-add-household-btn").addEventListener("click", () => {
    document.getElementById("add-household-forms").style.display = "block";
    document.getElementById("add-household-toggle").style.display = "none";
  });

  const joinCode = new URLSearchParams(window.location.search).get("join");
  if (joinCode) {
    document.getElementById("join-invite-code").value = joinCode.toUpperCase().slice(0, 8);
    document.getElementById("join-invite-section").style.display = "block";
  }

  await loadHouseholds();
});

function setStatus(text) {
  const el = document.getElementById("household-status");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}

async function loadHouseholds(preferredId) {
  myHouseholds = await getMyHouseholds(currentUser.id);
  setStatus("");

  const hasHousehold = myHouseholds.length > 0;
  document.getElementById("household-panel").style.display = hasHousehold ? "block" : "none";
  // มีบ้านแล้วซ่อนฟอร์มสร้าง/เข้าร่วมไว้หลังปุ่ม เพื่อไม่ให้หน้ารก
  document.getElementById("add-household-forms").style.display = hasHousehold ? "none" : "block";
  document.getElementById("add-household-toggle").style.display = hasHousehold ? "flex" : "none";

  if (!hasHousehold) {
    currentHousehold = null;
    return;
  }

  const switchEl = document.getElementById("household-switch");
  switchEl.innerHTML = "";
  myHouseholds.forEach((h) => {
    const option = document.createElement("option");
    option.value = h.id;
    option.textContent = h.name;
    switchEl.appendChild(option);
  });
  document.getElementById("household-switch-label").style.display =
    myHouseholds.length > 1 ? "block" : "none";

  const preferred = myHouseholds.find((h) => h.id === preferredId);
  await selectHousehold((preferred || pickCurrentHousehold(myHouseholds)).id);
}

async function selectHousehold(householdId) {
  currentHousehold = myHouseholds.find((h) => h.id === householdId);
  if (!currentHousehold) return;
  saveCurrentHouseholdId(householdId);

  document.getElementById("household-switch").value = householdId;
  const nameEl = document.getElementById("household-name");
  nameEl.textContent = "";
  nameEl.appendChild(icon("house", { size: 22 }));
  nameEl.appendChild(document.createTextNode(currentHousehold.name));
  document.getElementById("invite-result").style.display = "none";
  await loadMembers();
}

// ใช้ DOM API แทน innerHTML เพราะชื่อสมาชิกเป็นข้อความที่ผู้ใช้พิมพ์เอง
async function loadMembers() {
  const listEl = document.getElementById("member-list");
  listEl.innerHTML = "";

  const { data, error } = await supabaseClient
    .from("household_members")
    .select("user_id, role, display_name, joined_at")
    .eq("household_id", currentHousehold.id)
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("loadMembers error:", error.message);
    return;
  }

  const isOwner = currentHousehold.role === "owner";
  data.forEach((member) => {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = member.display_name;
    li.appendChild(name);

    if (member.role === "owner") li.appendChild(createMemberBadge("เจ้าของบ้าน"));
    if (member.user_id === currentUser.id) li.appendChild(createMemberBadge("คุณ"));

    if (isOwner && member.user_id !== currentUser.id) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-secondary btn-small";
      removeBtn.textContent = "เอาออก";
      removeBtn.addEventListener("click", () => handleRemoveMember(member));
      li.appendChild(removeBtn);
    }
    listEl.appendChild(li);
  });
}

function createMemberBadge(text) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = text;
  return badge;
}

async function handleCreateHousehold(e) {
  e.preventDefault();
  const { data, error } = await supabaseClient.rpc("create_household", {
    p_name: document.getElementById("new-household-name").value,
    p_display_name: document.getElementById("new-household-display").value,
  });

  if (error) {
    console.error("create_household error:", error.message);
    alert("สร้างบ้านไม่สำเร็จ กรุณาลองใหม่");
    return;
  }

  e.target.reset();
  await loadHouseholds(data);
}

async function joinWithCode(code, displayName) {
  const { data, error } = await supabaseClient.rpc("join_household", {
    p_code: code,
    p_display_name: displayName,
  });

  if (error) {
    console.error("join_household error:", error.message);
    alert(
      error.message.includes("invalid_or_expired_invite")
        ? "รหัสเชิญไม่ถูกต้องหรือหมดอายุแล้ว ขอลิงก์ใหม่จากคนในบ้าน"
        : "เข้าร่วมบ้านไม่สำเร็จ กรุณาลองใหม่"
    );
    return;
  }

  document.getElementById("join-invite-section").style.display = "none";
  document.getElementById("join-household-form").reset();
  // เอา ?join= ออกจาก URL กันกดรีเฟรชแล้วเข้าซ้ำ
  history.replaceState(null, "", "household.html");
  await loadHouseholds(data);
}

async function handleCreateInvite() {
  const { data: code, error } = await supabaseClient.rpc("create_household_invite", {
    p_household_id: currentHousehold.id,
  });

  if (error) {
    console.error("create_household_invite error:", error.message);
    alert("สร้างลิงก์เชิญไม่สำเร็จ กรุณาลองใหม่");
    return;
  }

  const link = new URL(`household.html?join=${code}`, window.location.href).href;
  document.getElementById("invite-code").textContent = code;
  document.getElementById("invite-link").value = link;
  document.getElementById("invite-result").style.display = "block";
}

async function handleCopyInvite() {
  const input = document.getElementById("invite-link");
  try {
    await navigator.clipboard.writeText(input.value);
    const copyBtn = document.getElementById("copy-invite-btn");
    copyBtn.textContent = "";
    copyBtn.appendChild(icon("check", { size: 18 }));
    copyBtn.appendChild(document.createTextNode("คัดลอกแล้ว"));
  } catch {
    // clipboard API ใช้ไม่ได้ (เช่น ไม่ใช่ HTTPS) — เลือกข้อความให้ผู้ใช้กดคัดลอกเอง
    input.select();
  }
}

async function handleRemoveMember(member) {
  if (!confirm(`เอา "${member.display_name}" ออกจากบ้านนี้ใช่หรือไม่?`)) return;

  const { error } = await supabaseClient
    .from("household_members")
    .delete()
    .eq("household_id", currentHousehold.id)
    .eq("user_id", member.user_id);

  if (error) {
    console.error("remove member error:", error.message);
    alert("เอาสมาชิกออกไม่สำเร็จ");
    return;
  }
  await loadMembers();
}

async function handleLeaveHousehold() {
  if (!confirm(`ออกจากบ้าน "${currentHousehold.name}" ใช่หรือไม่?`)) return;

  const { error } = await supabaseClient.rpc("leave_household", {
    p_household_id: currentHousehold.id,
  });

  if (error) {
    console.error("leave_household error:", error.message);
    alert("ออกจากบ้านไม่สำเร็จ");
    return;
  }
  await loadHouseholds();
}
