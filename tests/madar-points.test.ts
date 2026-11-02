import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, Share: { share: vi.fn() } }));

import {
  approvedTotal,
  capRemaining,
  checkRedeem,
  countsTowardsStock,
  dedupeToken,
  filterBalances,
  pointsLabel,
  ruleWindow,
  summarizeLedger,
} from "@/lib/madar/points";
import {
  canExpirePoints,
  canManagePoints,
  canManagePointsSettings,
  canRedeemPoints,
  canRequestPoints,
  canSeePoints,
  canViewPointsReport,
} from "@/lib/madar/permissions";
import type { PointBalanceRow, PointEntry, PointSettings, Profile, Redemption, Reward } from "@/lib/madar/types";

const profile = (over: Partial<Profile>): Profile =>
  ({
    id: "u1",
    email: "u1@example.com",
    full_name: "U1",
    role: "employee",
    status: "active",
    department_id: "sales",
    company_id: "c1",
    job_title: null,
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as Profile;

const entry = (over: Partial<PointEntry>): PointEntry =>
  ({
    id: "e1",
    company_id: "c1",
    member_id: "u1",
    points: 10,
    kind: "earn",
    status: "approved",
    reason: "سبب",
    source: "manual",
    rule_id: null,
    task_id: null,
    reward_id: null,
    redemption_id: null,
    reverses_entry_id: null,
    actor_id: null,
    decided_at: null,
    reject_note: null,
    expires_at: null,
    dedupe_key: null,
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  }) as PointEntry;

const settings = (over: Partial<PointSettings> = {}): PointSettings =>
  ({
    id: "s1",
    company_id: "c1",
    enabled: true,
    unit_label: "نقطة",
    unit_symbol: "ن",
    require_approval: true,
    period_kind: "month",
    per_member_period_cap: null,
    expiry_days: null,
    min_redeem_points: null,
    updated_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  }) as PointSettings;

const reward = (over: Partial<Reward>): Reward =>
  ({
    id: "r1",
    company_id: "c1",
    name: "يوم إجازة",
    description: null,
    cost_points: 100,
    stock: null,
    per_member_max: null,
    enabled: true,
    created_by: null,
    updated_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  }) as Reward;

const balance = (over: Partial<PointBalanceRow>): PointBalanceRow =>
  ({
    member_id: "u1",
    full_name: "منى فؤاد",
    department_id: "sales",
    role: "employee",
    balance: 40,
    pending: 0,
    entries: 3,
    ...over,
  }) as PointBalanceRow;

describe("points ledger maths", () => {
  it("labels an amount with the company's own unit wording", () => {
    expect(pointsLabel(12)).toBe("12 نقطة");
    expect(pointsLabel(12, settings({ unit_label: "نجمة" }))).toBe("12 نجمة");
    expect(pointsLabel(0, null)).toBe("0 نقطة");
  });

  it("counts only approved rows toward the balance", () => {
    const list = [
      entry({ points: 20, status: "approved" }),
      entry({ points: 50, status: "pending" }),
      entry({ points: 30, status: "rejected" }),
      entry({ points: -25, status: "approved" }),
      entry({ points: 5, status: "cancelled" }),
    ];
    expect(approvedTotal(list)).toBe(-5);
  });

  it("splits the settled balance from what is still awaiting a decision", () => {
    const list = [
      entry({ id: "a", points: 30, status: "approved", expires_at: "2026-12-01T00:00:00Z" }),
      entry({ id: "b", points: 20, status: "approved", expires_at: "2026-11-05T00:00:00Z" }),
      entry({ id: "c", points: -25, kind: "redeem", status: "approved" }),
      entry({ id: "d", points: 50, status: "pending" }),
      entry({ id: "e", points: 15, status: "pending" }),
      entry({ id: "f", points: 9, status: "rejected" }),
    ];
    expect(summarizeLedger(list)).toEqual({
      balance: 25,
      pending: 65,
      approvedCount: 3,
      pendingCount: 2,
      expiring: [list[1], list[0]],
    });
  });

  it("lists only settled gains as expiring, soonest first", () => {
    const summary = summarizeLedger([
      entry({ id: "x", points: 10, status: "approved", expires_at: "2026-12-20T00:00:00Z" }),
      entry({ id: "y", points: 8, status: "approved", expires_at: "2026-11-10T00:00:00Z" }),
      entry({ id: "z", points: -10, kind: "redeem", status: "approved", expires_at: "2026-09-01T00:00:00Z" }),
      entry({ id: "w", points: -6, kind: "expire", status: "approved" }),
      entry({ points: 4, status: "pending", expires_at: "2026-09-01T00:00:00Z" }),
    ]);
    expect(summary.expiring.map((e) => e.id)).toEqual(["y", "x"]);
  });

  it("counts pending rows against the period cap, the way the server does", () => {
    const list = [
      entry({ points: 40, status: "approved" }),
      entry({ points: 30, status: "pending" }),
      entry({ points: 7, status: "rejected" }),
      entry({ points: -25, kind: "redeem", status: "approved" }),
      entry({ points: -3, kind: "expire", status: "approved" }),
    ];
    expect(capRemaining(list, 100)).toBe(30);
    expect(capRemaining(list, 60)).toBe(0);
    expect(capRemaining(list, null)).toBeNull();
    expect(capRemaining([], 25)).toBe(25);
  });
});

describe("points rule windows", () => {
  it("reads a campaign as scheduled, running, or over", () => {
    const window = (starts_on: string | null, ends_on: string | null, today: string) =>
      ruleWindow({ starts_on, ends_on }, today);

    expect(window("2026-12-01", null, "2026-11-02")).toBe("scheduled");
    expect(window("2026-11-02", null, "2026-11-02")).toBe("active");
    expect(window(null, "2026-11-01", "2026-11-02")).toBe("ended");
    expect(window(null, "2026-11-02", "2026-11-02")).toBe("active");
    expect(window("2026-11-01", "2026-11-30", "2026-11-02")).toBe("active");
    expect(window(null, null, "2026-11-02")).toBe("active");
  });
});

describe("redemption gates", () => {
  const standing = { balance: 90, redeemedByMember: 1 };

  it("stops a redemption at the first gate it fails", () => {
    expect(checkRedeem(reward({ enabled: false, cost_points: 1000 }), standing, settings({ min_redeem_points: 500 }))).toEqual({
      block: "off",
      shortBy: 0,
    });
    expect(checkRedeem(reward({ stock: 0 }), standing, null)).toEqual({ block: "stock", shortBy: 0 });
    expect(checkRedeem(reward({ per_member_max: 1 }), standing, null)).toEqual({ block: "per_member", shortBy: 0 });
    expect(checkRedeem(reward({ cost_points: 120 }), standing, null)).toEqual({ block: "balance", shortBy: 30 });
    expect(checkRedeem(reward({ cost_points: 40 }), standing, settings({ min_redeem_points: 100 }))).toEqual({
      block: "minimum",
      shortBy: 10,
    });
    expect(checkRedeem(reward({ cost_points: 90 }), standing, settings({ min_redeem_points: 90 }))).toEqual({
      block: "enough",
      shortBy: 0,
    });
  });

  it("reports the balance gap before the minimum, exactly like redeem_reward", () => {
    expect(checkRedeem(reward({ cost_points: 300 }), standing, settings({ min_redeem_points: 200 })).block).toBe("balance");
  });

  it("treats unlimited stock and per-member limits as no limit", () => {
    expect(checkRedeem(reward({ stock: null, per_member_max: null }), standing, null).block).toBe("balance");
    expect(checkRedeem(reward({ stock: 1, cost_points: 10 }), standing, null).block).toBe("enough");
  });

  it("keeps a unit of stock reserved until the request is rejected or cancelled", () => {
    const statuses: Redemption["status"][] = ["requested", "approved", "fulfilled", "rejected", "cancelled"];
    expect(statuses.map((s) => countsTowardsStock({ status: s }))).toEqual([true, true, true, false, false]);
  });
});

describe("balance roster filtering", () => {
  const rows = [
    balance({ member_id: "u1", full_name: "منى فؤاد", department_id: "sales" }),
    balance({ member_id: "u2", full_name: "Hala Samy", department_id: "sales" }),
    balance({ member_id: "u3", full_name: "سارة خالد", department_id: "ops" }),
    balance({ member_id: "u4", full_name: "بدون قسم", department_id: null }),
  ];

  it("narrows by department and by name, case-insensitively", () => {
    expect(filterBalances(rows, { departmentId: "sales" }).map((r) => r.member_id)).toEqual(["u1", "u2"]);
    expect(filterBalances(rows, { search: "hala" }).map((r) => r.member_id)).toEqual(["u2"]);
    expect(filterBalances(rows, { search: "  سارة " }).map((r) => r.member_id)).toEqual(["u3"]);
    expect(filterBalances(rows, { departmentId: "ops", search: "منى" })).toEqual([]);
  });

  it("keeps every row when no filter is set", () => {
    expect(filterBalances(rows)).toHaveLength(4);
    expect(filterBalances(rows, { departmentId: null, search: "" })).toHaveLength(4);
  });
});

describe("idempotency tokens", () => {
  it("produces a fresh uuid-shaped token per click", () => {
    const first = dedupeToken();
    const second = dedupeToken();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(second).not.toBe(first);
  });
});

describe("points permission mirrors", () => {
  const admin = profile({ id: "boss", role: "admin" });
  const lead = profile({ id: "lead", role: "manager", department_id: "sales" });
  const member = profile({ id: "u1", role: "employee", department_id: "sales" });
  const otherDept = profile({ id: "u9", role: "employee", department_id: "ops" });
  const viewer = profile({ id: "v1", role: "viewer" });
  const dev = profile({ id: "d1", role: "developer", company_id: null });

  it("hides every points screen until the company turns the system on", () => {
    expect(canSeePoints(member, settings({ enabled: true }))).toBe(true);
    expect(canSeePoints(member, settings({ enabled: false }))).toBe(false);
    expect(canSeePoints(member, null)).toBe(false);
    expect(canSeePoints(member)).toBe(true);
    expect(canSeePoints(viewer, settings())).toBe(true);
    expect(canSeePoints(dev, settings())).toBe(false);
    expect(canSeePoints(profile({ status: "pending" }), settings())).toBe(false);
    expect(canSeePoints(null, settings())).toBe(false);
  });

  it("restricts settings, rules and rewards to the company admin", () => {
    expect(canManagePointsSettings(admin)).toBe(true);
    expect(canManagePointsSettings(lead)).toBe(false);
    expect(canManagePointsSettings(viewer)).toBe(false);
  });

  it("lets a lead grant only inside their own department", () => {
    expect(canManagePoints(admin, member)).toBe(true);
    expect(canManagePoints(admin, otherDept)).toBe(true);
    expect(canManagePoints(lead, member)).toBe(true);
    expect(canManagePoints(lead, otherDept)).toBe(false);
    expect(canManagePoints(profile({ role: "supervisor", department_supervises_all: true }), otherDept)).toBe(true);
    expect(canManagePoints(lead, profile({ status: "disabled", department_id: "sales" }))).toBe(false);
    expect(canManagePoints(viewer, member)).toBe(false);
    expect(canManagePoints(profile({ company_id: null }), member)).toBe(false);
    expect(canManagePoints(lead, lead)).toBe(true);
  });

  it("keeps a viewer out of requests and redemptions", () => {
    expect(canRequestPoints(member)).toBe(true);
    expect(canRequestPoints(admin)).toBe(true);
    expect(canRequestPoints(viewer)).toBe(false);
    expect(canRequestPoints(dev)).toBe(false);
    expect(canRedeemPoints(viewer)).toBe(false);
    expect(canRedeemPoints(member)).toBe(true);
  });

  it("reserves the expiry sweep for the admin and the report for whoever may manage", () => {
    expect(canExpirePoints(admin)).toBe(true);
    expect(canExpirePoints(lead)).toBe(false);

    expect(canViewPointsReport(admin)).toBe(true);
    expect(canViewPointsReport(lead, member)).toBe(true);
    expect(canViewPointsReport(lead, otherDept)).toBe(false);
    expect(canViewPointsReport(member)).toBe(false);
    expect(canViewPointsReport(member, member)).toBe(false);
  });
});
