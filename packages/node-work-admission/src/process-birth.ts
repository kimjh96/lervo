import { createHash } from "node:crypto";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const decimal = /^[0-9]{1,20}$/u;

function digest(parts: string[]): string {
  return `proc_${parts[0]}_v1:sha256:${createHash("sha256")
    .update(JSON.stringify(parts.slice(1)))
    .digest("hex")}`;
}

export function linuxBirthIdentity(pid: number, boot: string, stat: string): string | null {
  if (!uuid.test(boot.trim()) || stat.length > 4096 || !stat.startsWith(`${pid} (`)) return null;
  const end = stat.lastIndexOf(") ");
  if (end < 0) return null;
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/u);
  const start = fields[19];
  if (start === undefined || !decimal.test(start) || !/^[A-Zt]$/u.test(fields[0] ?? ""))
    return null;
  return digest(["linux_ticks", boot.trim().toLowerCase(), String(pid), start]);
}

export function darwinBirthIdentity(pid: number, boot: string, start: string): string | null {
  const value = start.trim();
  if (
    !uuid.test(boot.trim()) ||
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(`${value} GMT`))
  )
    return null;
  // ps exposes seconds. Equal coordinates retain ownership, including ambiguous reuse.
  return digest(["darwin_seconds", boot.trim().toLowerCase(), String(pid), value]);
}

export function windowsBirthIdentity(pid: number, start: string): string | null {
  const value = start.trim();
  if (!decimal.test(value) || BigInt(value) <= 0n) return null;
  return digest(["windows_filetime", String(pid), value]);
}
