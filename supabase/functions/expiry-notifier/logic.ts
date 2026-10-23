// ตรรกะเลือกว่า "ใครต้องได้แจ้งเตือนเรื่องอะไรวันนี้" — แยกจาก index.ts และไม่มี import
// เพื่อทดสอบได้โดยไม่ต้องเรียกฐานข้อมูลหรือส่ง push จริง

export const DEFAULT_DAYS_BEFORE = [3, 0];

export type PantryItem = {
  id: string;
  household_id: string;
  name: string;
  expiry_date: string; // YYYY-MM-DD
  date_kind: "exp" | "bbe";
};

export type UserPrefs = { enabled: boolean; days_before: number[] };

export type PlannedNotification = {
  userId: string;
  itemIds: string[];
  title: string;
  body: string;
};

// "วันนี้" ตามเวลาไทย (UTC+7) — cron รันตอน 01:00 UTC ซึ่งเป็น 08:00 ของวันเดียวกันในไทย
export function thaiToday(nowMs: number): string {
  return new Date(nowMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function describeItem(item: PantryItem, daysLeft: number): string {
  const kind = item.date_kind === "bbe" ? "ควรบริโภคก่อน" : "หมดอายุ";
  if (daysLeft === 0) return `${item.name} ${kind}วันนี้`;
  if (daysLeft === 1) return `${item.name} ${kind}พรุ่งนี้`;
  return `${item.name} อีก ${daysLeft} วัน`;
}

const MAX_ITEMS_IN_BODY = 2;

export function buildBody(lines: string[]): string {
  const shown = lines.slice(0, MAX_ITEMS_IN_BODY).join(" · ");
  const rest = lines.length - MAX_ITEMS_IN_BODY;
  return rest > 0 ? `${shown} และอีก ${rest} รายการ` : shown;
}

// รวมทุกรายการของผู้ใช้หนึ่งคน (จากทุกบ้านที่เป็นสมาชิก) เป็นแจ้งเตือนเดียว
// alreadySent: "userId:itemId" ที่แจ้งไปแล้ววันนี้ (กัน cron ซ้ำ หรือกดรันซ้ำ)
export function buildDailyNotifications(params: {
  today: string;
  userIds: string[];
  prefsByUser: Record<string, UserPrefs | undefined>;
  householdsByUser: Record<string, string[]>;
  items: PantryItem[];
  alreadySent: Set<string>;
}): PlannedNotification[] {
  const { today, userIds, prefsByUser, householdsByUser, items, alreadySent } = params;
  const planned: PlannedNotification[] = [];

  for (const userId of userIds) {
    const prefs = prefsByUser[userId] ?? { enabled: true, days_before: DEFAULT_DAYS_BEFORE };
    if (!prefs.enabled) continue;

    const households = new Set(householdsByUser[userId] ?? []);
    const matches = items
      .filter((item) => households.has(item.household_id))
      .map((item) => ({ item, daysLeft: daysBetween(today, item.expiry_date) }))
      .filter(({ item, daysLeft }) =>
        prefs.days_before.includes(daysLeft) && !alreadySent.has(`${userId}:${item.id}`)
      )
      .sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name));

    if (matches.length === 0) continue;

    planned.push({
      userId,
      itemIds: matches.map(({ item }) => item.id),
      title:
        matches[0].daysLeft === 0
          ? `⚠️ ของหมดอายุวันนี้ ${matches.filter((m) => m.daysLeft === 0).length} รายการ`
          : `🔔 ของใกล้หมดอายุ ${matches.length} รายการ`,
      body: buildBody(matches.map(({ item, daysLeft }) => describeItem(item, daysLeft))),
    });
  }

  return planned;
}
