export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function startOfDay(dateLike = new Date()) {
  const date = new Date(dateLike);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isoDay(dateLike = new Date()) {
  return startOfDay(dateLike).toISOString().slice(0, 10);
}

export function addDays(dateLike, count) {
  const date = new Date(dateLike);
  date.setDate(date.getDate() + count);
  return isoDay(date);
}

export function differenceInDays(dateLike, fromDate = new Date()) {
  const target = startOfDay(dateLike);
  const start = startOfDay(fromDate);
  return Math.round((target - start) / 86400000);
}

export function formatDate(dateLike) {
  if (!dateLike) return "No date";
  return new Date(dateLike).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatLong(dateLike) {
  if (!dateLike) return "No date";
  return new Date(dateLike).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function normalizeWhitespace(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function excerpt(text = "", maxLength = 160) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

export function slugify(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function parsePercent(value = "") {
  const match = String(value).match(/(\d{1,3})(?:\.\d+)?\s*%/);
  return match ? Number(match[1]) : null;
}

export function priorityClass(priority) {
  if (priority === "High") return "priority-high";
  if (priority === "Medium") return "priority-medium";
  return "priority-low";
}

export function inferPriority(days) {
  if (days <= 2) return "High";
  if (days <= 6) return "Medium";
  return "Low";
}

export function monthMatrix(items = []) {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstDay = base.getDay();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push({ empty: true });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), day);
    const iso = isoDay(date);
    cells.push({
      date: iso,
      day,
      isToday: iso === isoDay(today),
      items: items.filter((item) => item.date === iso).slice(0, 3),
    });
  }
  return cells;
}
