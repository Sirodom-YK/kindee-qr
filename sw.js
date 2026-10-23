// Service Worker ของ KinDee QR — รับ Web Push แจ้งเตือนของใกล้หมดอายุ
// ต้องอยู่ที่ root ของเว็บ (scope ครอบทุกหน้า) และเว็บต้องเปิดผ่าน HTTPS หรือ localhost
// ข้อความแจ้งเตือนส่งมาจาก edge function supabase/functions/expiry-notifier

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "KinDee QR";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "มีของใกล้หมดอายุ",
      icon: "assets/icons/icon-192.png",
      badge: "assets/icons/icon-192.png",
      // tag เดียวกัน = แจ้งเตือนใหม่แทนที่อันเก่า ไม่กองซ้อนกันทุกวัน
      tag: payload.tag || "kindee-expiry",
      // ถ้าไม่ใส่ renotify การแทนที่อันเก่าที่ยังค้างอยู่ใน Notification Center จะเงียบ ไม่เด้งขึ้นจอ
      renotify: true,
      data: { url: payload.url || "pantry.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "pantry.html", self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === target);
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
