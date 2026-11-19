export function dateKey(value = new Date()) {
  return [String(value.getFullYear()).padStart(4, '0'), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
}

export function parseDay(value: string) {
  return new Date(value + 'T12:00:00');
}

export function shiftDay(value: string, amount: number) {
  const next = parseDay(value);
  next.setDate(next.getDate() + amount);
  return dateKey(next);
}

export function weekStart(value: string) {
  const weekday = parseDay(value).getDay();
  return shiftDay(value, -((weekday + 6) % 7));
}

export function monthDays(value: string) {
  const first = value.slice(0, 7) + '-01';
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, index) => shiftDay(start, index));
}

export function formatDay(value: string) {
  return parseDay(value).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}
