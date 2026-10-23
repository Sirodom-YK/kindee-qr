-- ตัวอย่าง: คัดลอกไฟล์นี้เป็น supabase/cron.sql (ไฟล์นั้นถูก .gitignore ไว้ ไม่ขึ้น GitHub) แล้วใส่ CRON_SECRET จริง
-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor หลัง deploy edge function expiry-notifier แล้ว
-- ตั้งเวลาให้เรียก expiry-notifier ทุกวัน 01:00 UTC = 08:00 เวลาไทย
--
-- ⚠️ ก่อนรัน แก้ 1 ค่า:
--   (URL ของโปรเจกต์ใส่ไว้ให้แล้ว: wgcxrawztwaqnunvytkn)
--   YOUR_CRON_SECRET  → ค่าเดียวกับที่ตั้งด้วย `npx supabase secrets set CRON_SECRET=...`
-- secret นี้จะอยู่ในตาราง cron.job ซึ่งเห็นได้เฉพาะผู้มีสิทธิ์เข้าฐานข้อมูลเท่านั้น (ไม่ใช่ผู้ใช้เว็บ)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ลบ job เดิมถ้ามี (รันไฟล์นี้ซ้ำได้)
select cron.unschedule(jobid) from cron.job where jobname = 'kindee-expiry-notifier';

select cron.schedule(
  'kindee-expiry-notifier',
  '0 1 * * *',
  $$
  select net.http_post(
    url := 'https://wgcxrawztwaqnunvytkn.supabase.co/functions/v1/expiry-notifier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ดูประวัติการรัน: select * from cron.job_run_details order by start_time desc limit 10;
-- ดูผลตอบกลับของ edge function: select * from net._http_response order by created desc limit 10;
