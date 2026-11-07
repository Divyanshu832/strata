// Small display helpers shared by server and client components.

export const TYPE_COLORS: Record<string, string> = {
  person: "var(--t-person)",
  project: "var(--t-project)",
  place: "var(--t-place)",
  org: "var(--t-org)",
  topic: "var(--t-topic)",
  thing: "var(--t-thing)",
};

/** Raw hex values for canvas drawing (CSS variables don't work there). */
export const TYPE_HEX: Record<string, string> = {
  person: "#3987e5",
  project: "#199e70",
  place: "#c98500",
  org: "#9085e9",
  topic: "#d55181",
  thing: "#7d8b91",
};

export const TYPE_ORDER = ["person", "project", "place", "org", "topic", "thing"] as const;

export const TYPE_LABEL: Record<string, string> = {
  person: "People",
  project: "Projects",
  place: "Places",
  org: "Organisations",
  topic: "Topics",
  thing: "Things",
};

export const typeColor = (type: string) => TYPE_COLORS[type] ?? TYPE_COLORS.thing!;
export const typeHex = (type: string) => TYPE_HEX[type] ?? TYPE_HEX.thing!;

/** "user" is the person the agents help: show it as "You". */
export const displayName = (name: string) => (name === "user" ? "You" : name);

export const predicateLabel = (p: string) => p.replace(/_/g, " ");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function day(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function month(iso: string | Date): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function ago(iso: string | Date, now = Date.now()): string {
  const s = Math.max(0, (now - +new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86_400 * 30) return `${Math.floor(s / 86_400)} d ago`;
  return day(iso);
}

export const num = (n: number) => n.toLocaleString("en-US");

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
