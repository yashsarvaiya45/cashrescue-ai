const indianNumber = new Intl.NumberFormat('en-IN');
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatPaise(paise) {
  const amount = BigInt(paise);
  const magnitude = amount < 0n ? -amount : amount;
  const fraction = magnitude % 100n;
  return (amount < 0n ? '−' : '') + '₹' + indianNumber.format(magnitude / 100n)
    + (fraction === 0n ? '' : '.' + fraction.toString().padStart(2, '0'));
}

export function formatDate(date, exact = false) {
  return date ? (exact === true ? fullDate : dayMonth).format(new Date(date + 'T00:00:00Z')) : '—';
}

export function formatChartAxis(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1,
  }).format(paise / 100);
}

export function amountInput(paise) {
  const amount = BigInt(paise);
  const magnitude = amount < 0n ? -amount : amount;
  return (amount < 0n ? '-' : '') + (magnitude / 100n).toString() + '.' + (magnitude % 100n).toString().padStart(2, '0');
}

export function readAmount(value, { signed = false } = {}) {
  const match = /^(-?)(\d{1,14})(?:\.(\d{0,2}))?$/.exec(value.trim());
  if (!match || (!signed && match[1])) return null;
  const paise = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] ? -paise : paise);
}
