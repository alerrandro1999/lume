export function audioTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = String(Math.floor(value / 60) % 60).padStart(2, '0');
  const rest = String(value % 60).padStart(2, '0');
  return `${hours ? `${hours}:` : ''}${minutes}:${rest}`;
}
