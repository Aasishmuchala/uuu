// Dates as the owner reads them. Draft dates are YYYY-MM-DD and mean India time (UTC+5:30).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const IST_MS = 5.5 * 3600000;

const parts = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return { y, m: m - 1, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

// Today in India as YYYY-MM-DD.
export function indiaToday(now = new Date()) {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
}

// "Thursday 12 November".
export function plainDay(iso) {
  const p = parts(iso);
  return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m]}`;
}

// "9 to 15 November", or "30 November to 6 December" across months.
export function plainRange(from, to) {
  const a = parts(from);
  const b = parts(to);
  return a.m === b.m && a.y === b.y ? `${a.d} to ${b.d} ${MONTHS[b.m]}` : `${a.d} ${MONTHS[a.m]} to ${b.d} ${MONTHS[b.m]}`;
}
