// Supabase Edge Function: ส่ง Web Push แจ้งเตือนของใกล้หมดอายุ (ระบบของในบ้าน)
//
// เรียกได้ 2 แบบ:
//   1. cron ทุกวัน 08:00 เวลาไทย (supabase/cron.sql) — header "Authorization: Bearer <CRON_SECRET>"
//      → หาของที่ใกล้หมดตาม notification_prefs ของแต่ละคน แล้วส่งให้ทุกเครื่องที่สมัครไว้
//   2. ผู้ใช้กด "ส่งแจ้งเตือนทดสอบ" (js/push.js) — ใช้ access token ของผู้ใช้ → ส่งข้อความทดสอบให้เครื่องของคนนั้นเท่านั้น
//
// deploy ด้วย --no-verify-jwt เพราะ cron ไม่มี JWT ของผู้ใช้ — จึงตรวจสิทธิ์เองทั้ง 2 แบบด้านล่าง
// secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), CRON_SECRET
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้ใน edge function อยู่แล้ว (service role ข้าม RLS — ใช้เฉพาะฝั่งเซิร์ฟเวอร์)

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { addDays, buildDailyNotifications, thaiToday, type PantryItem } from "./logic.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET");
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type PrefsRow = { user_id: string; enabled: boolean; days_before: number[] };
type MemberRow = { user_id: string; household_id: string };
type LogRow = { user_id: string; item_id: string };

// ส่งให้ทุกเครื่องของผู้ใช้ คืนจำนวนเครื่องที่ส่งสำเร็จ — เครื่องที่ยกเลิกไปแล้ว (404/410) ลบทิ้ง
async function sendToSubscriptions(subs: Subscription[], payload: Record<string, string>) {
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 12 * 60 * 60 } // ถ้าเครื่องปิดอยู่ เก็บไว้ส่งได้ภายใน 12 ชั่วโมง
      );
      sent++;
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("web push error:", statusCode, (e as Error).message);
      }
    }
  }
  return sent;
}

async function runDaily() {
  const today = thaiToday(Date.now());

  const { data: subsData, error: subsError } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth");
  if (subsError) throw subsError;
  const subs = (subsData ?? []) as Subscription[];
  if (subs.length === 0) return { today, users: 0, sent: 0 };

  const userIds: string[] = [...new Set(subs.map((s) => s.user_id))];

  const [prefsRes, membersRes, logsRes] = await Promise.all([
    db.from("notification_prefs").select("user_id, enabled, days_before").in("user_id", userIds),
    db.from("household_members").select("user_id, household_id").in("user_id", userIds),
    db.from("notification_log").select("user_id, item_id").eq("notify_date", today).in("user_id", userIds),
  ]);
  const prefs = (prefsRes.data ?? []) as PrefsRow[];
  const members = (membersRes.data ?? []) as MemberRow[];
  const logs = (logsRes.data ?? []) as LogRow[];

  const prefsByUser = Object.fromEntries(prefs.map((p) => [p.user_id, p]));
  const householdsByUser: Record<string, string[]> = {};
  members.forEach((m) => {
    (householdsByUser[m.user_id] ??= []).push(m.household_id);
  });

  const householdIds: string[] = [...new Set(members.map((m) => m.household_id))];
  const maxDays = Math.max(3, ...prefs.flatMap((p) => p.days_before));
  const { data: items, error: itemsError } = householdIds.length
    ? await db
        .from("pantry_items")
        .select("id, household_id, name, expiry_date, date_kind")
        .eq("status", "active")
        .in("household_id", householdIds)
        .gte("expiry_date", today)
        .lte("expiry_date", addDays(today, maxDays))
    : { data: [], error: null };
  if (itemsError) throw itemsError;

  const planned = buildDailyNotifications({
    today,
    userIds,
    prefsByUser,
    householdsByUser,
    items: (items ?? []) as PantryItem[],
    alreadySent: new Set(logs.map((l) => `${l.user_id}:${l.item_id}`)),
  });

  let sent = 0;
  for (const plan of planned) {
    const userSubs = subs.filter((s) => s.user_id === plan.userId);
    const count = await sendToSubscriptions(userSubs, {
      title: plan.title,
      body: plan.body,
      url: "pantry.html",
      tag: `kindee-expiry-${today}`,
    });
    sent += count;
    // บันทึกว่าแจ้งแล้วเฉพาะเมื่อส่งถึงอย่างน้อย 1 เครื่อง (ส่งไม่ถึงเลย พรุ่งนี้ยังได้แจ้งตามรอบ)
    if (count > 0) {
      await db.from("notification_log").upsert(
        plan.itemIds.map((itemId) => ({ user_id: plan.userId, item_id: itemId, notify_date: today })),
        { onConflict: "user_id,item_id,notify_date", ignoreDuplicates: true }
      );
    }
  }

  return { today, users: planned.length, sent };
}

async function sendTest(userId: string) {
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  const sent = await sendToSubscriptions((subs ?? []) as Subscription[], {
    title: "🔔 ทดสอบแจ้งเตือน KinDee QR",
    body: "ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนของใกล้หมดอายุพร้อมใช้งานแล้ว",
    url: "pantry.html",
    tag: "kindee-test",
  });
  return { sent };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return jsonResponse({ error: "VAPID keys ยังไม่ถูกตั้งค่าในฝั่งเซิร์ฟเวอร์" }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  try {
    // 1. cron
    if (CRON_SECRET && token === CRON_SECRET) {
      return jsonResponse(await runDaily());
    }

    // 2. ผู้ใช้ที่ login แล้วขอส่งทดสอบให้เครื่องตัวเอง
    const { data: userData } = await db.auth.getUser(token);
    if (!userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body: { action?: string } = {};
    try {
      body = await req.json();
    } catch {
      // ไม่มี body
    }
    if (body.action !== "test") {
      return jsonResponse({ error: "ไม่รู้จักคำสั่งนี้" }, 400);
    }
    return jsonResponse(await sendTest(userData.user.id));
  } catch (e) {
    console.error("expiry-notifier error:", e);
    return jsonResponse({ error: "เกิดข้อผิดพลาดในการส่งแจ้งเตือน" }, 500);
  }
});
