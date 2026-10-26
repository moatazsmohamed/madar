import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, Share: { share: vi.fn() } }));

import { parseCSV, toCSV } from "@/lib/madar/csv";
import {
  addDays,
  addMonths,
  daysBetween,
  fmtClock,
  fmtHours,
  fmtMinutes,
  isoDateInTz,
  isOverdue,
  sessionMinutes,
  setCompanyTimezone,
  startOfWeek,
  timeInTz,
  zonedToUtc,
} from "@/lib/madar/format";
import { assignableRoles, canCreateTask, canDeleteTask, canManageTask, canReviewTask, canTrackTime, canWorkOnTask, isGeneralLead, isMonthLocked, isSelfOwned, isTaskDayClosed } from "@/lib/madar/permissions";
import { completionPercent, memberTallies, tallyTasks } from "@/lib/madar/progress";
import type { CompanyMonth, Profile, Task } from "@/lib/madar/types";

const profile = (over: Partial<Profile>): Profile =>
  ({
    id: "u1",
    email: "u1@example.com",
    full_name: "U1",
    role: "employee",
    status: "active",
    department_id: "sales",
    job_title: null,
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  }) as Profile;

const openMonth: CompanyMonth = {
  id: "m1",
  company_id: "c1",
  period: "2026-10-01",
  status: "open",
  opened_at: "2026-10-01T00:00:00Z",
  closed_at: null,
  closed_by: null,
  summary: null,
};

const task = (over: Partial<Task>): Task =>
  ({
    id: "t1",
    number: 1,
    title: "Task",
    status: "todo",
    priority: "medium",
    department_id: "sales",
    project_id: null,
    created_by: "boss",
    reviewer_id: null,
    due_date: null,
    start_date: null,
    day: "2026-10-25",
    task_assignees: [],
    month_id: "m1",
    month: openMonth,
    ...over,
  }) as Task;

describe("company timezone handling", () => {
  it("converts a Cairo wall-clock time to UTC and back", () => {
    setCompanyTimezone("Africa/Cairo");
    // 25 Oct 2026 Cairo is UTC+3 (summer time ends on the last Thursday of October).
    const utc = zonedToUtc("2026-10-25", "09:00");
    expect(utc.toISOString()).toBe("2026-10-25T06:00:00.000Z");
    expect(isoDateInTz(utc)).toBe("2026-10-25");
    expect(timeInTz(utc)).toBe("09:00");
  });

  it("keeps late-evening UTC timestamps on the correct local day", () => {
    setCompanyTimezone("Asia/Riyadh");
    expect(isoDateInTz(new Date("2026-03-10T22:30:00Z"))).toBe("2026-03-11");
    setCompanyTimezone("Africa/Cairo");
  });

  it("does calendar math on plain dates without drifting", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addMonths("2026-01-31", 1).slice(0, 7)).toBe("2026-02");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });

  it("starts weeks on Saturday", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-24"); // Sunday -> Saturday
    expect(startOfWeek("2026-10-24")).toBe("2026-10-24");
    expect(startOfWeek("2026-10-30")).toBe("2026-10-24"); // Friday
  });
});

describe("work time", () => {
  it("measures sessions from start to end, or to now for a running timer", () => {
    expect(sessionMinutes({ started_at: "2026-10-25T06:00:00Z", ended_at: "2026-10-25T08:30:00Z" })).toBe(150);
    const now = new Date("2026-10-25T06:45:00Z").getTime();
    expect(sessionMinutes({ started_at: "2026-10-25T06:00:00Z", ended_at: null }, now)).toBe(45);
    expect(sessionMinutes({ started_at: "2026-10-25T06:00:00Z", ended_at: "2026-10-25T05:00:00Z" })).toBe(0);
  });

  it("formats durations in Arabic units", () => {
    expect(fmtMinutes(150)).toBe("2س 30د");
    expect(fmtMinutes(45)).toBe("45د");
    expect(fmtMinutes(120)).toBe("2س");
    expect(fmtHours(150)).toBe("2.5");
    expect(fmtHours(720)).toBe("12");
    expect(fmtClock(3723000)).toBe("01:02:03");
  });

  it("flags open tasks past their due date only", () => {
    expect(isOverdue({ due_date: "2000-01-01", status: "in_progress" })).toBe(true);
    expect(isOverdue({ due_date: "2000-01-01", status: "done" })).toBe(false);
    expect(isOverdue({ due_date: null, status: "todo" })).toBe(false);
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas and Arabic text", () => {
    const csv = toCSV(["العنوان", "الوصف"], [["عرض \"خاص\"", "سطر, ثانٍ"]]);
    expect(parseCSV(csv)).toEqual([
      ["العنوان", "الوصف"],
      ['عرض "خاص"', "سطر, ثانٍ"],
    ]);
  });

  it("ignores a BOM and blank lines and accepts CRLF", () => {
    expect(parseCSV("\uFEFFa,b\r\n\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("month completion percentages", () => {
  const today = "2026-10-27";

  it("rounds whole percentages and treats an empty scope as zero", () => {
    expect(completionPercent(0, 0)).toBe(0);
    expect(completionPercent(3, 10)).toBe(30);
    expect(completionPercent(2, 3)).toBe(67);
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(-1, 3)).toBe(0);
    expect(completionPercent(5, 3)).toBe(100);
  });

  it("counts done, review and late tasks from the same denominator", () => {
    const list = [
      task({ id: "a", status: "done", day: "2026-10-10" }),
      task({ id: "b", status: "review", day: today }),
      task({ id: "c", status: "todo", day: "2026-10-20" }),
      task({ id: "d", status: "in_progress", day: "2026-10-30", due_date: "2026-10-26" }),
    ];
    expect(tallyTasks(list, today)).toEqual({ total: 4, done: 1, review: 1, open: 3, overdue: 2, percent: 25 });
  });

  it("counts a shared task once per assignee and lists the lowest percentage first", () => {
    const people = [profile({ id: "a", full_name: "Ali" }), profile({ id: "b", full_name: "Basma" })];
    const list = [
      task({ id: "t1", status: "done", day: today, task_assignees: [{ user_id: "a" }, { user_id: "b" }] }),
      task({ id: "t2", status: "done", day: today, task_assignees: [{ user_id: "a" }] }),
      task({ id: "t3", status: "todo", day: today, task_assignees: [{ user_id: "b" }] }),
    ];
    expect(memberTallies(list, people, today).map((r) => [r.user_id, r.done, r.total, r.percent])).toEqual([
      ["b", 1, 2, 50],
      ["a", 2, 2, 100],
    ]);
  });
});

describe("permission mirrors", () => {
  const employee = profile({ id: "emp" });
  const manager = profile({ id: "mgr", role: "manager" });
  const otherManager = profile({ id: "mgr2", role: "manager", department_id: "marketing" });
  const supervisor = profile({ id: "sup", role: "supervisor" });
  const otherSupervisor = profile({ id: "sup2", role: "supervisor", department_id: "marketing" });
  const admin = profile({ id: "adm", role: "admin", department_id: null });
  const viewer = profile({ id: "view", role: "viewer" });
  const assigned = task({ task_assignees: [{ user_id: "emp" }] });
  const closed = task({
    task_assignees: [{ user_id: "emp" }],
    status: "review",
    month: { ...openMonth, status: "closed", closed_at: "2026-11-01T00:00:00Z", closed_by: "adm" },
  });

  it("lets the company admin and the department manager manage tasks", () => {
    expect(canManageTask(admin, assigned)).toBe(true);
    expect(canManageTask(manager, assigned)).toBe(true);
    expect(canManageTask(otherManager, assigned)).toBe(false);
    expect(canManageTask(supervisor, assigned)).toBe(false);
    expect(canManageTask(employee, assigned)).toBe(false);
  });

  it("lets supervisors review their department only", () => {
    expect(canReviewTask(admin, assigned)).toBe(true);
    expect(canReviewTask(manager, assigned)).toBe(true);
    expect(canReviewTask(supervisor, assigned)).toBe(true);
    expect(canReviewTask(otherSupervisor, assigned)).toBe(false);
    expect(canReviewTask(employee, assigned)).toBe(false);
  });

  it("gives the general supervision department company-wide oversight", () => {
    const generalManager = profile({ id: "gm", role: "manager", department_id: "general", department_supervises_all: true });
    const generalSupervisor = profile({ id: "gs", role: "supervisor", department_id: "general", department_supervises_all: true });
    const marketing = task({ department_id: "marketing" });
    expect(canManageTask(generalManager, marketing)).toBe(true);
    expect(canReviewTask(generalManager, marketing)).toBe(true);
    expect(canReviewTask(generalSupervisor, marketing)).toBe(true);
    expect(canWorkOnTask(generalManager, marketing)).toBe(true);
    expect(canManageTask(generalSupervisor, marketing)).toBe(false);
    expect(canManageTask(otherManager, task({ department_id: "ops" }))).toBe(false);
    expect(isGeneralLead(generalManager)).toBe(true);
    expect(isGeneralLead(manager)).toBe(false);
  });

  it("reserves task creation for the company admin", () => {
    expect(canCreateTask(admin)).toBe(true);
    expect(canCreateTask(manager)).toBe(false);
    expect(canCreateTask(supervisor)).toBe(false);
    expect(canCreateTask(employee)).toBe(false);
    expect(canCreateTask(viewer)).toBe(false);
  });

  it("lets assignees work on and track time for their tasks", () => {
    expect(canWorkOnTask(employee, assigned)).toBe(true);
    expect(canTrackTime(employee, assigned)).toBe(true);
    expect(canTrackTime(employee, { ...assigned, status: "done" })).toBe(false);
    expect(canWorkOnTask(profile({ id: "someone" }), assigned)).toBe(false);
  });

  it("locks closed months for everyone, including the admin", () => {
    expect(isMonthLocked(closed)).toBe(true);
    expect(canManageTask(admin, closed)).toBe(false);
    expect(canReviewTask(supervisor, closed)).toBe(false);
    expect(canWorkOnTask(employee, closed)).toBe(false);
    expect(canTrackTime(admin, closed)).toBe(false);
    expect(canDeleteTask(admin, closed)).toBe(false);
  });

  it("archives past days but trusts the live day status when given", () => {
    expect(isTaskDayClosed(task({ day: "2000-01-01" }))).toBe(true);
    expect(isTaskDayClosed(task({ day: "2999-01-01" }))).toBe(false);
    expect(isTaskDayClosed(task({ day: "2000-01-01" }), "open")).toBe(false);
    expect(isTaskDayClosed(task({ day: "2999-01-01" }), "closed")).toBe(true);
  });

  it("keeps viewers and disabled accounts read-only", () => {
    expect(canWorkOnTask(viewer, assigned)).toBe(false);
    expect(canDeleteTask(viewer, assigned)).toBe(false);
    expect(canManageTask(profile({ id: "adm2", role: "admin", status: "disabled" }), assigned)).toBe(false);
  });

  it("treats creator-owned tasks without a reviewer as self-owned", () => {
    expect(isSelfOwned(employee, task({ created_by: "emp" }))).toBe(true);
    expect(isSelfOwned(employee, task({ created_by: "emp", reviewer_id: "mgr" }))).toBe(false);
  });

  it("limits the roles a manager can grant", () => {
    expect(assignableRoles(manager)).not.toContain("admin");
    expect(assignableRoles(manager)).not.toContain("manager");
    expect(assignableRoles(admin)).toContain("admin");
  });
});
