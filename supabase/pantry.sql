-- รันครั้งเดียวใน Supabase Dashboard > SQL Editor หลัง admin-role.sql
-- ระบบ "ของในบ้าน": ติดตามวันหมดอายุของใช้ในบ้าน ใช้ร่วมกันได้หลายคน (เช่น รูมเมท)
--
-- หลักความปลอดภัย: ทุกตารางเปิด RLS — สมาชิกเห็น/แก้ได้เฉพาะของบ้านตัวเอง
-- การสร้างบ้าน/เชิญ/เข้าร่วม/ออกจากบ้าน ทำผ่านฟังก์ชัน (RPC) เท่านั้น ไม่เปิดให้ insert ตารางสมาชิกตรง
-- เพื่อกันไม่ให้ใครเพิ่มตัวเองเข้าบ้านคนอื่น หรือตั้งตัวเองเป็นเจ้าของบ้าน

-- ============ ตาราง ============

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- ชื่อที่สมาชิกในบ้านเห็น — ไม่เปิดเผยอีเมลให้สมาชิกคนอื่น
  display_name text not null check (char_length(display_name) between 1 and 50),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_idx on household_members (user_id);

create table if not exists household_invites (
  code text primary key,
  household_id uuid not null references households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

create table if not exists pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  barcode text check (char_length(barcode) <= 64),
  name text not null check (char_length(name) between 1 and 200),
  image_url text check (char_length(image_url) <= 1000),
  item_type text not null default 'food'
    check (item_type in ('food', 'medicine', 'cosmetic', 'household', 'other')),
  location text not null default 'pantry'
    check (location in ('fridge', 'freezer', 'pantry', 'bathroom', 'other')),
  quantity numeric not null default 1 check (quantity >= 0 and quantity <= 100000),
  unit text not null default 'ชิ้น' check (char_length(unit) between 1 and 20),
  -- null = ของที่ไม่มีวันหมดอายุบนฉลาก (แสดงแยกท้ายรายการ ไม่แจ้งเตือน)
  expiry_date date,
  -- exp = วันหมดอายุ (ห้ามใช้หลังวันนี้), bbe = ควรบริโภคก่อน (คุณภาพลดลงหลังวันนี้)
  date_kind text not null default 'exp' check (date_kind in ('exp', 'bbe')),
  note text check (char_length(note) <= 500),
  -- active = ยังอยู่ในบ้าน, used = ใช้หมดแล้ว, discarded = ทิ้ง (หมดอายุ/เสีย)
  status text not null default 'active' check (status in ('active', 'used', 'discarded')),
  finished_at timestamptz,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pantry_items_household_idx
  on pantry_items (household_id, status, expiry_date);

-- ตั้งค่าแจ้งเตือนรายคน (ใช้ในเฟส Web Push) — days_before {3,0} = แจ้ง 3 วันก่อน และวันที่หมด
create table if not exists notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  days_before int[] not null default '{3,0}',
  updated_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 2000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  -- unique ต่อผู้ใช้ (ไม่ใช่ทั้งระบบ) เพราะเครื่องเดียวกันอาจสลับบัญชี login ได้
  unique (user_id, endpoint)
);

-- กันส่งแจ้งเตือนเรื่องเดิมซ้ำในวันเดียวกัน (เขียนโดย edge function ด้วย service role เท่านั้น)
create table if not exists notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references pantry_items(id) on delete cascade,
  notify_date date not null,
  primary key (user_id, item_id, notify_date)
);

-- ============ ฟังก์ชันช่วยเช็กสิทธิ์ ============
-- security definer เพื่ออ่าน household_members ได้โดยไม่วนติด RLS ของตารางนั้นเอง

create or replace function is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_members where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ============ RPC ============

create or replace function create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into households (name, created_by) values (trim(p_name), auth.uid())
  returning id into new_id;

  insert into household_members (household_id, user_id, role, display_name)
  values (new_id, auth.uid(), 'owner', trim(p_display_name));

  return new_id;
end;
$$;

create or replace function create_household_invite(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not is_household_member(p_household_id) then
    raise exception 'not_a_member';
  end if;

  -- 8 ตัวอักษรจาก UUID สุ่ม (ตัด 0/O, 1/I ออกไม่ได้เพราะเป็น hex แต่ใช้ตัวพิมพ์ใหญ่ให้อ่านง่าย)
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into household_invites (code, household_id, created_by)
  values (new_code, p_household_id, auth.uid());

  return new_code;
end;
$$;

create or replace function join_household(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select household_id into target
  from household_invites
  where code = upper(trim(p_code)) and expires_at > now();

  if target is null then
    raise exception 'invalid_or_expired_invite';
  end if;

  insert into household_members (household_id, user_id, role, display_name)
  values (target, auth.uid(), 'member', trim(p_display_name))
  on conflict (household_id, user_id) do nothing;

  return target;
end;
$$;

-- ออกจากบ้าน: ถ้าเป็นคนสุดท้าย ลบบ้านทิ้ง (ของในบ้านถูกลบตาม)
-- ถ้าเจ้าของออกแต่ยังมีคนอยู่ ให้คนที่อยู่นานที่สุดเป็นเจ้าของแทน
create or replace function leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_owner boolean;
begin
  delete from household_members
  where household_id = p_household_id and user_id = auth.uid()
  returning role = 'owner' into was_owner;

  if was_owner is null then
    return; -- ไม่ได้เป็นสมาชิกอยู่แล้ว
  end if;

  if not exists (select 1 from household_members where household_id = p_household_id) then
    delete from households where id = p_household_id;
  elsif was_owner and not exists (
    select 1 from household_members where household_id = p_household_id and role = 'owner'
  ) then
    update household_members set role = 'owner'
    where household_id = p_household_id
      and user_id = (
        select user_id from household_members
        where household_id = p_household_id
        order by joined_at
        limit 1
      );
  end if;
end;
$$;

revoke execute on function create_household(text, text) from anon;
revoke execute on function create_household_invite(uuid) from anon;
revoke execute on function join_household(text, text) from anon;
revoke execute on function leave_household(uuid) from anon;

-- ============ RLS ============

alter table households enable row level security;
alter table household_members enable row level security;
alter table household_invites enable row level security;
alter table pantry_items enable row level security;
alter table notification_prefs enable row level security;
alter table push_subscriptions enable row level security;
alter table notification_log enable row level security; -- ไม่มี policy = เข้าได้แค่ service role

create policy "Members can read their households"
  on households for select to authenticated
  using (is_household_member(id));

create policy "Owners can rename households"
  on households for update to authenticated
  using (is_household_owner(id)) with check (is_household_owner(id));

create policy "Members can read members of their households"
  on household_members for select to authenticated
  using (is_household_member(household_id));

-- เจ้าของบ้านเอาสมาชิกคนอื่นออกได้ (ออกเองใช้ leave_household)
create policy "Owners can remove other members"
  on household_members for delete to authenticated
  using (is_household_owner(household_id) and user_id <> auth.uid());

create policy "Members can read invites of their households"
  on household_invites for select to authenticated
  using (is_household_member(household_id));

create policy "Members can revoke invites of their households"
  on household_invites for delete to authenticated
  using (is_household_member(household_id));

create policy "Members can read items"
  on pantry_items for select to authenticated
  using (is_household_member(household_id));

create policy "Members can add items"
  on pantry_items for insert to authenticated
  with check (is_household_member(household_id) and added_by = auth.uid());

create policy "Members can update items"
  on pantry_items for update to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "Members can delete items"
  on pantry_items for delete to authenticated
  using (is_household_member(household_id));

create policy "Users manage their own notification prefs"
  on notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage their own push subscriptions"
  on push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
