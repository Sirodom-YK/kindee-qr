// สร้าง js/icons.js ใหม่ (เช่น เพิ่มไอคอน): เพิ่มชื่อใน names ด้านล่าง แล้วรัน
//   curl -L -o lucide.min.js https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js
//   node tools/build-icons.js lucide.min.js js/icons.js
// ชื่อไอคอนทั้งหมดดูได้ที่ https://lucide.dev/icons
// ดึงเฉพาะไอคอนที่ใช้จาก lucide@0.469.0 (ISC license) มาเป็น js/icons.js ขนาดเล็ก
const fs = require("fs");
const L = require(process.argv[2]);
const out = process.argv[3];

const names = [
  "house", "scan-line", "scan-barcode", "camera", "image", "search", "package", "package-open",
  "refrigerator", "snowflake", "archive", "bath", "pill", "spray-can", "apple", "ellipsis",
  "plus", "minus", "check", "trash-2", "pencil", "chart-column", "bell", "bell-ring", "user",
  "log-out", "users", "user-plus", "link", "copy", "chevron-right", "chevron-left", "arrow-left",
  "calendar-days", "triangle-alert", "circle-alert", "circle-check", "clock", "info", "x",
  "settings", "shield-check", "leaf", "send", "keyboard", "mail", "bot", "languages",
  "file-text", "list-checks", "sparkles", "upload", "lock", "door-open",
];

const pascal = (n) => n.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
const data = {};
for (const n of names) {
  const node = L.icons[pascal(n)];
  if (!node) throw new Error(`missing icon ${n}`);
  // IconNode ของ lucide 0.469 อยู่ในรูป ["svg", attrs, children] — เก็บแค่ children
  data[n] = node[0] === "svg" ? node[2] : node;
}

const js = `// ไอคอนเส้นจาก Lucide (https://lucide.dev, ISC License) — ดึงมาเฉพาะที่ใช้ เพื่อให้โหลดเร็วบนมือถือ
// สร้างไฟล์นี้ใหม่ได้ด้วย tools/build-icons.js — ห้ามแก้ข้อมูลไอคอนด้วยมือ
//
// ใช้ 2 แบบ:
//   ใน HTML: <i data-icon="scan-line"></i>  → renderStaticIcons() แปลงเป็น <svg> (เรียกใน partials.js)
//   ใน JS:   element.appendChild(icon("plus"))

const ICON_DATA = ${JSON.stringify(data)};

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(name, { size = 20, className = "" } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", \`icon \${className}\`.trim());

  (ICON_DATA[name] || []).forEach(([tag, attrs]) => {
    const child = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => child.setAttribute(k, v));
    svg.appendChild(child);
  });
  return svg;
}

function renderStaticIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => {
    const size = Number(el.dataset.size) || 20;
    el.replaceWith(icon(el.dataset.icon, { size, className: el.className }));
  });
}
`;
fs.writeFileSync(out, js);
console.log(`icons: ${names.length}, bytes: ${Buffer.byteLength(js)}`);
