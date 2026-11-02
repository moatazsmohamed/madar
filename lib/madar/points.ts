// Pure points arithmetic shared by the points screens. The ledger on the server stays the source of
// truth: these helpers only pre-compute what the server will do, so the UI can hint before it calls.
import type { PointBalanceRow, PointEntry, PointRule, PointSettings, Reward, Redemption } from "./types";

/** A one-time token per click: the server replays it instead of writing a second entry. */
export function dedupeToken(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

/** "${n} نقطة" with the company's own wording. */
export function pointsLabel(n: number, settings?: Pick<PointSettings, "unit_label"> | null): string {
  return `${n} ${settings?.unit_label ?? "نقطة"}`;
}

/** Sum of approved entries — the same figure point_balance() returns server-side. */
export function approvedTotal(entries: Pick<PointEntry, "points" | "status">[]): number {
  return entries.filter((e) => e.status === "approved").reduce((sum, e) => sum + e.points, 0);
}

export interface LedgerSummary {
  balance: number;
  pending: number;
  approvedCount: number;
  pendingCount: number;
  /** Approved gains that carry an expiry, soonest first — the same set my_points() reads for expires_on. */
  expiring: PointEntry[];
}

export function summarizeLedger(entries: PointEntry[]): LedgerSummary {
  let balance = 0;
  let pending = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  const expiring: PointEntry[] = [];
  for (const e of entries) {
    if (e.status === "approved") {
      balance += e.points;
      approvedCount += 1;
      if (e.points > 0 && e.expires_at) expiring.push(e);
    } else if (e.status === "pending") {
      pending += e.points;
      pendingCount += 1;
    }
  }
  expiring.sort((a, b) => (a.expires_at! < b.expires_at! ? -1 : 1));
  return { balance, pending, approvedCount, pendingCount, expiring };
}

/** How much of the per-member period cap is still free — pending counts, exactly like the server. */
export function capRemaining(entries: PointEntry[], cap: number | null): number | null {
  if (cap === null) return null;
  const earned = entries
    .filter((e) => (e.status === "approved" || e.status === "pending") && e.points > 0)
    .reduce((sum, e) => sum + e.points, 0);
  return Math.max(cap - earned, 0);
}

export type RuleWindow = "active" | "scheduled" | "ended";

/** The rule's own date window, in the company's calendar day. */
export function ruleWindow(rule: Pick<PointRule, "starts_on" | "ends_on">, today: string): RuleWindow {
  if (rule.starts_on && today < rule.starts_on) return "scheduled";
  if (rule.ends_on && today > rule.ends_on) return "ended";
  return "active";
}

export type RedeemBlock = "enough" | "balance" | "minimum" | "stock" | "per_member" | "off";

export interface RedeemCheck {
  block: RedeemBlock;
  /** Points still missing for a balance shortfall, otherwise zero. */
  shortBy: number;
}

/** Mirrors redeem_reward's gates so the button can say why it is disabled before the call. */
export function checkRedeem(
  reward: Pick<Reward, "cost_points" | "stock" | "per_member_max" | "enabled">,
  standing: { balance: number; redeemedByMember: number },
  settings: Pick<PointSettings, "min_redeem_points"> | null,
): RedeemCheck {
  if (!reward.enabled) return { block: "off", shortBy: 0 };
  if (reward.stock !== null && reward.stock <= 0) return { block: "stock", shortBy: 0 };
  if (reward.per_member_max !== null && standing.redeemedByMember >= reward.per_member_max) {
    return { block: "per_member", shortBy: 0 };
  }
  const min = settings?.min_redeem_points ?? null;
  if (standing.balance < reward.cost_points) return { block: "balance", shortBy: reward.cost_points - standing.balance };
  if (min !== null && standing.balance < min) return { block: "minimum", shortBy: Math.max(min - standing.balance, 0) };
  return { block: "enough", shortBy: 0 };
}

/** True when a redemption still holds stock that has not been cancelled. */
export function countsTowardsStock(r: Pick<Redemption, "status">): boolean {
  return r.status !== "rejected" && r.status !== "cancelled";
}

/** Balance rows for one department, keeping the company-wide rows when the caller sees them all. */
export function filterBalances(
  rows: PointBalanceRow[],
  opts: { departmentId?: string | null; search?: string } = {},
): PointBalanceRow[] {
  const q = (opts.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (opts.departmentId && r.department_id !== opts.departmentId) return false;
    if (!q) return true;
    return r.full_name.toLowerCase().includes(q);
  });
}
