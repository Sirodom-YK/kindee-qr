// ตั้งค่าแจ้งเตือน Web Push ในหน้า "บ้านของฉัน" (household.html)
// ขั้นตอน: register sw.js → ขออนุญาตแจ้งเตือน (ต้องมาจากการกดปุ่มเท่านั้น) → subscribe ด้วย VAPID key
// → บันทึก subscription ลงตาราง push_subscriptions → edge function expiry-notifier ส่งให้ทุกเช้า 08:00

const NOTIFY_DAY_OPTIONS = [
  { days: 7, label: "7 วันก่อน" },
  { days: 3, label: "3 วันก่อน" },
  { days: 1, label: "1 วันก่อน" },
  { days: 0, label: "วันที่หมดอายุ" },
];
const DEFAULT_NOTIFY_DAYS = [3, 0];

document.addEventListener("DOMContentLoaded", async () => {
  const user = await getCurrentUser();
  if (user) await renderNotificationSection(user);
});

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

async function renderNotificationSection(user) {
  const section = document.getElementById("notification-section");
  section.style.display = "block";
  section.innerHTML = "";

  const h3 = document.createElement("h3");
  h3.className = "section-title";
  h3.appendChild(icon("bell", { size: 20 }));
  h3.appendChild(document.createTextNode("แจ้งเตือนของใกล้หมดอายุ"));
  section.appendChild(h3);

  const supported =
    window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  if (!supported) {
    section.appendChild(
      createNote(
        isIos() && !isInstalledApp()
          ? "บน iPhone/iPad ต้องติดตั้งเว็บนี้ก่อน: กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ใน Safari → \"เพิ่มลงหน้าจอโฮม\" แล้วเปิดจากไอคอนบนหน้าจอโฮม (ต้องเป็น iOS 16.4 ขึ้นไป)"
          : "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน หรือเว็บยังไม่ได้เปิดผ่าน HTTPS"
      )
    );
    return;
  }

  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("YOUR_")) {
    section.appendChild(createNote("ผู้ดูแลยังไม่ได้ตั้งค่า VAPID key (js/push-config.js)"));
    return;
  }

  const registration = await navigator.serviceWorker.register("sw.js");
  const subscription = await registration.pushManager.getSubscription();
  const permission = Notification.permission;

  const status = createNote(
    permission === "denied"
      ? "คุณบล็อกการแจ้งเตือนของเว็บนี้ไว้ — เปิดได้ในการตั้งค่าเว็บไซต์ของเบราว์เซอร์"
      : subscription
        ? "เปิดแจ้งเตือนบนเครื่องนี้แล้ว"
        : "ยังไม่ได้เปิดแจ้งเตือนบนเครื่องนี้"
  );
  section.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "hero-actions";

  if (permission !== "denied") {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = subscription ? "btn btn-secondary" : "btn btn-primary";
    toggleBtn.textContent = subscription ? "ปิดแจ้งเตือนบนเครื่องนี้" : "เปิดแจ้งเตือนบนเครื่องนี้";
    toggleBtn.addEventListener("click", async () => {
      toggleBtn.disabled = true;
      try {
        if (subscription) await unsubscribePush(subscription);
        else await subscribePush(registration, user);
      } catch (err) {
        console.error("push toggle error:", err);
        alert("ตั้งค่าแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่");
      }
      await renderNotificationSection(user);
    });
    actions.appendChild(toggleBtn);
  }

  if (subscription) {
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn btn-secondary";
    testBtn.textContent = "ส่งแจ้งเตือนทดสอบ";
    testBtn.addEventListener("click", () => sendTestPush(testBtn));
    actions.appendChild(testBtn);
  }
  section.appendChild(actions);

  await renderNotifyPrefs(section, user);
}

function createNote(text) {
  const p = document.createElement("p");
  p.className = "text-muted";
  p.textContent = text;
  return p;
}

// VAPID public key เป็น base64url → Uint8Array ตามที่ pushManager.subscribe ต้องการ
function urlBase64ToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function subscribePush(registration, user) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = subscription.toJSON();

  const { error } = await supabaseClient.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) throw error;
}

async function unsubscribePush(subscription) {
  await supabaseClient.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

async function sendTestPush(btn) {
  btn.disabled = true;
  const { data, error } = await supabaseClient.functions.invoke("expiry-notifier", {
    body: { action: "test" },
  });
  btn.disabled = false;

  if (error || data?.error) {
    console.error("test push error:", error?.message || data?.error);
    alert("ส่งแจ้งเตือนทดสอบไม่สำเร็จ (ได้ deploy expiry-notifier และตั้ง VAPID secrets แล้วหรือยัง?)");
    return;
  }
  btn.textContent = `ส่งแล้ว ${data.sent} เครื่อง`;
}

// ============ แจ้งล่วงหน้ากี่วัน (ค่าเดียวกันทุกเครื่องของผู้ใช้คนนี้) ============

async function renderNotifyPrefs(section, user) {
  const { data } = await supabaseClient
    .from("notification_prefs")
    .select("enabled, days_before")
    .eq("user_id", user.id)
    .maybeSingle();
  const enabled = data ? data.enabled : true;
  const days = data ? data.days_before : DEFAULT_NOTIFY_DAYS;

  const form = document.createElement("form");
  form.className = "admin-form notify-prefs";

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "checkbox-label";
  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = enabled;
  enabledLabel.appendChild(enabledInput);
  enabledLabel.appendChild(document.createTextNode(" รับแจ้งเตือนทุกเช้า 08:00 (ทุกเครื่องที่เปิดไว้)"));
  form.appendChild(enabledLabel);

  const legend = document.createElement("p");
  legend.textContent = "แจ้งเมื่อของเหลือ:";
  form.appendChild(legend);

  const dayInputs = NOTIFY_DAY_OPTIONS.map(({ days: d, label }) => {
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(d);
    input.checked = days.includes(d);
    lbl.appendChild(input);
    lbl.appendChild(document.createTextNode(` ${label}`));
    form.appendChild(lbl);
    return input;
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-secondary";
  saveBtn.textContent = "บันทึกการตั้งค่า";
  form.appendChild(saveBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const selected = dayInputs.filter((i) => i.checked).map((i) => Number(i.value));
    const { error } = await supabaseClient.from("notification_prefs").upsert({
      user_id: user.id,
      enabled: enabledInput.checked,
      days_before: selected.length > 0 ? selected : DEFAULT_NOTIFY_DAYS,
      updated_at: new Date().toISOString(),
    });
    saveBtn.textContent = error ? "บันทึกไม่สำเร็จ" : "บันทึกแล้ว";
  });

  section.appendChild(form);
}
