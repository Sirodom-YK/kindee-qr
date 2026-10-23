// รายงาน "ใช้ทัน vs หมดอายุ/ทิ้ง" ของบ้านที่เลือก คำนวณจาก pantry_items ที่จบแล้ว (status ≠ active)
//   ใช้ทัน       = ใช้หมด (used) ก่อนหรือในวันหมดอายุ หรือของที่ไม่มีวันหมดอายุ
//   หมดอายุ/ทิ้ง = ทิ้ง (discarded) หรือใช้หมดหลังวันหมดอายุไปแล้ว
// นับตามเดือนที่ "จบ" (finished_at) — ของที่ลบเพราะบันทึกผิดไม่อยู่ในตารางแล้ว จึงไม่ถูกนับ

const CHART_MONTHS = 6;

const reportState = { items: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const household = pickCurrentHousehold(await getMyHouseholds(user.id));
  const line = document.getElementById("report-household-line");
  if (!household) {
    line.textContent = "";
    document.getElementById("report-no-household").style.display = "block";
    return;
  }
  line.textContent = "";
  line.appendChild(icon("house", { size: 16 }));
  line.appendChild(document.createTextNode(` ${household.name}`));

  const monthInput = document.getElementById("report-month");
  monthInput.value = todayIsoDate().slice(0, 7);
  monthInput.max = monthInput.value;
  monthInput.addEventListener("change", renderReport);

  await loadFinishedItems(household.id);
  document.getElementById("report-panel").style.display = "block";
  renderReport();
});

async function loadFinishedItems(householdId) {
  // โหลดย้อนหลัง 12 เดือน พอสำหรับเลือกเดือนย้อนหลังแล้วยังมีกราฟ 6 เดือน
  const since = new Date();
  since.setMonth(since.getMonth() - 12, 1);

  const { data, error } = await supabaseClient
    .from("pantry_items")
    .select("name, item_type, expiry_date, status, finished_at")
    .eq("household_id", householdId)
    .neq("status", "active")
    .gte("finished_at", since.toISOString());

  if (error) {
    console.error("loadFinishedItems error:", error.message);
    return;
  }

  reportState.items = data.map((item) => {
    const finishedDate = toLocalIsoDate(new Date(item.finished_at));
    const onTime =
      item.status === "used" && (!item.expiry_date || finishedDate <= item.expiry_date);
    return { ...item, finishedDate, month: finishedDate.slice(0, 7), onTime };
  });
}

function toLocalIsoDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-10" → ["2026-05", ..., "2026-10"]
function lastMonths(endMonth, count) {
  const [y, m] = endMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1 - (count - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function formatThaiMonth(month, style = "short") {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: style, year: "2-digit" });
}

function renderReport() {
  const month = document.getElementById("report-month").value || todayIsoDate().slice(0, 7);
  const monthItems = reportState.items.filter((item) => item.month === month);

  renderStats(monthItems);
  renderMonthChart(month);
  renderWastedTypes(monthItems.filter((item) => !item.onTime));
  renderWastedList(monthItems.filter((item) => !item.onTime));
}

// ============ ตัวเลขสรุป ============

function renderStats(items) {
  const onTime = items.filter((item) => item.onTime).length;
  const wasted = items.length - onTime;
  const rate = items.length > 0 ? Math.round((onTime / items.length) * 100) : null;

  const row = document.getElementById("stat-row");
  row.innerHTML = "";
  row.appendChild(createStatTile("ใช้ทัน", `${onTime}`, "รายการ"));
  row.appendChild(createStatTile("หมดอายุ/ทิ้ง", `${wasted}`, "รายการ"));
  row.appendChild(
    createStatTile("ใช้ทันเวลา", rate === null ? "–" : `${rate}%`, items.length ? `จาก ${items.length} รายการ` : "ยังไม่มีข้อมูล")
  );
}

function createStatTile(label, value, note) {
  const tile = document.createElement("div");
  tile.className = "card stat-tile";

  const labelEl = document.createElement("p");
  labelEl.className = "text-muted";
  labelEl.textContent = label;
  tile.appendChild(labelEl);

  const valueEl = document.createElement("p");
  valueEl.className = "stat-value";
  valueEl.textContent = value;
  tile.appendChild(valueEl);

  const noteEl = document.createElement("p");
  noteEl.className = "text-muted";
  noteEl.textContent = note;
  tile.appendChild(noteEl);

  return tile;
}

// ============ กราฟแท่งซ้อน 6 เดือน (SVG) ============

function renderMonthChart(endMonth) {
  const months = lastMonths(endMonth, CHART_MONTHS);
  const rows = months.map((month) => {
    const items = reportState.items.filter((item) => item.month === month);
    const onTime = items.filter((item) => item.onTime).length;
    return { month, onTime, wasted: items.length - onTime };
  });

  renderMonthTable(rows);

  const container = document.getElementById("month-chart");
  container.innerHTML = "";

  const max = Math.max(1, ...rows.map((r) => r.onTime + r.wasted));
  const width = 560;
  const height = 220;
  const pad = { top: 20, right: 8, bottom: 28, left: 28 };
  const plotH = height - pad.top - pad.bottom;
  const band = (width - pad.left - pad.right) / rows.length;
  const barW = Math.min(24, band * 0.5);
  const y = (v) => pad.top + plotH - (v / max) * plotH;
  const ns = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "จำนวนของที่ใช้ทันและหมดอายุ/ทิ้ง 6 เดือนล่าสุด");

  const el = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // เส้นกริดจาง ๆ 3 เส้น + ค่าแกน y
  const ticks = [0, Math.ceil(max / 2), max];
  ticks.forEach((t) => {
    svg.appendChild(el("line", { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: "chart-grid" }));
    svg.appendChild(el("text", { x: pad.left - 6, y: y(t) + 4, class: "chart-axis", "text-anchor": "end" }, t));
  });

  rows.forEach((row, i) => {
    const cx = pad.left + band * i + band / 2;
    const x = cx - barW / 2;
    const total = row.onTime + row.wasted;

    // ใช้ทันอยู่ล่าง (ติดฐาน) หมดอายุ/ทิ้งซ้อนบน — เว้นช่อง 2px ระหว่างสองส่วน
    const onTimeTop = y(row.onTime);
    if (row.onTime > 0) {
      svg.appendChild(segmentPath(ns, x, onTimeTop, barW, y(0) - onTimeTop, row.wasted === 0, "series-ontime"));
    }
    if (row.wasted > 0) {
      const top = y(total);
      const gap = row.onTime > 0 ? 2 : 0;
      svg.appendChild(segmentPath(ns, x, top, barW, onTimeTop - top - gap, true, "series-wasted"));
    }
    if (total > 0) {
      svg.appendChild(el("text", { x: cx, y: y(total) - 6, class: "chart-value", "text-anchor": "middle" }, total));
    }
    svg.appendChild(el("text", { x: cx, y: height - 8, class: "chart-axis", "text-anchor": "middle" }, formatThaiMonth(row.month)));

    // พื้นที่ hover กว้างทั้งช่อง ใหญ่กว่าแท่งจริง
    const hit = el("rect", { x: pad.left + band * i, y: pad.top, width: band, height: plotH, class: "chart-hit", tabindex: "0" });
    const tip = `${formatThaiMonth(row.month, "long")}: ใช้ทัน ${row.onTime} · หมดอายุ/ทิ้ง ${row.wasted}`;
    hit.setAttribute("aria-label", tip);
    hit.addEventListener("mouseenter", () => showTooltip(tip, cx / width));
    hit.addEventListener("focus", () => showTooltip(tip, cx / width));
    hit.addEventListener("mouseleave", hideTooltip);
    hit.addEventListener("blur", hideTooltip);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

// แท่งมุมบนโค้ง 4px (เฉพาะส่วนที่อยู่บนสุด) ฐานเป็นมุมเหลี่ยม
function segmentPath(ns, x, yTop, w, h, roundTop, cls) {
  const r = roundTop ? Math.min(4, h, w / 2) : 0;
  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z`
  );
  path.setAttribute("class", cls);
  return path;
}

function showTooltip(text, xRatio) {
  const tip = document.getElementById("chart-tooltip");
  tip.textContent = text;
  tip.style.left = `${Math.min(80, Math.max(0, xRatio * 100 - 10))}%`;
  tip.style.display = "block";
}

function hideTooltip() {
  document.getElementById("chart-tooltip").style.display = "none";
}

function renderMonthTable(rows) {
  const table = document.getElementById("month-table");
  table.innerHTML = "";
  const head = document.createElement("tr");
  ["เดือน", "ใช้ทัน", "หมดอายุ/ทิ้ง"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  table.appendChild(head);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    [formatThaiMonth(row.month, "long"), row.onTime, row.wasted].forEach((v, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      cell.textContent = v;
      tr.appendChild(cell);
    });
    table.appendChild(tr);
  });
}

// ============ รายการที่ทิ้ง ============

function renderWastedTypes(wastedItems) {
  const container = document.getElementById("wasted-types");
  container.innerHTML = "";

  if (wastedItems.length === 0) {
    container.appendChild(createMuted("เดือนนี้ไม่มีของที่หมดอายุหรือทิ้ง"));
    return;
  }

  const counts = {};
  wastedItems.forEach((item) => {
    counts[item.item_type] = (counts[item.item_type] || 0) + 1;
  });

  const list = document.createElement("ol");
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([type, count]) => {
      const li = document.createElement("li");
      li.textContent = `${ITEM_TYPE_LABELS[type] || type} — ${count} รายการ`;
      list.appendChild(li);
    });
  container.appendChild(list);
}

function renderWastedList(wastedItems) {
  const container = document.getElementById("wasted-list");
  container.innerHTML = "";

  if (wastedItems.length === 0) {
    container.appendChild(createMuted("ไม่มีรายการ"));
    return;
  }

  const list = document.createElement("ul");
  wastedItems
    .sort((a, b) => b.finishedDate.localeCompare(a.finishedDate))
    .slice(0, 20)
    .forEach((item) => {
      const li = document.createElement("li");
      const how = item.status === "discarded" ? "ทิ้ง" : "ใช้หลังหมดอายุ";
      const expiry = item.expiry_date ? ` · หมดอายุ ${formatThaiDate(item.expiry_date)}` : "";
      li.textContent = `${item.name} — ${how} ${formatThaiDate(item.finishedDate)}${expiry}`;
      list.appendChild(li);
    });
  container.appendChild(list);
}

function createMuted(text) {
  const p = document.createElement("p");
  p.className = "text-muted";
  p.textContent = text;
  return p;
}
