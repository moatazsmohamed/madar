// Client-side mirror of the database rules. The database (RLS + triggers) remains the source of
// truth; these helpers only decide which actions to show.
import type { Department, PointSettings, Profile, Project, Role, Task } from "./types";
import { todayISO } from "./format";

const DEPT_LEADS: Role[] = ["manager", "supervisor"];

export const isDeveloper = (me: Profile | null | undefined) => me?.role === "developer";
export const isAdmin = (me: Profile | null | undefined) => me?.role === "admin";
export const isViewer = (me: Profile | null | undefined) => me?.role === "viewer";
/** Reads the whole company. */
export const isLead = (me: Profile | null | undefined) => !!me && (me.role === "admin" || DEPT_LEADS.includes(me.role));
/** Department-scoped oversight (manager or supervisor). */
export const isDeptLead = (me: Profile | null | undefined) => !!me && DEPT_LEADS.includes(me.role);
/** Leads of the department flagged as general supervision oversee every department. */
export const isGeneralLead = (me: Profile | null | undefined) => isDeptLead(me) && !!me?.department_supervises_all;

export function isAssignee(me: Profile | null | undefined, task: Task) {
  return !!me && !!task.task_assignees?.some((a) => a.user_id === me.id);
}

/** Closed months are archived: everything inside them is read-only. */
export function isMonthLocked(task: Task) {
  return task.month?.status === "closed";
}

/** Closed days are archived too; reviewers may still decide on tasks waiting for review. */
export function isTaskDayClosed(task: Task, dayStatus?: "open" | "closed") {
  if (dayStatus) return dayStatus === "closed";
  return !!task.day && task.day < todayISO();
}

export function canReviewTask(me: Profile | null | undefined, task: Task) {
  if (!me || me.status !== "active" || isMonthLocked(task)) return false;
  if (me.role === "admin") return true;
  if (!isDeptLead(me)) return false;
  return (!!me.department_id && task.department_id === me.department_id) || !!me.department_supervises_all;
}

/** Admins manage the whole company; managers manage their department (or all departments under general supervision). */
export function canManageTask(me: Profile | null | undefined, task: Task) {
  if (!me || me.status !== "active" || isMonthLocked(task)) return false;
  if (me.role === "admin") return true;
  if (me.role !== "manager") return false;
  return (!!me.department_id && task.department_id === me.department_id) || !!me.department_supervises_all;
}

export function canWorkOnTask(me: Profile | null | undefined, task: Task) {
  if (!me || me.status !== "active" || me.role === "viewer" || isMonthLocked(task)) return false;
  return me.role === "admin" || canManageTask(me, task) || isAssignee(me, task);
}

export function canEditTaskDetails(me: Profile | null | undefined, task: Task) {
  return canManageTask(me, task);
}

export function canDeleteTask(me: Profile | null | undefined, task: Task) {
  return canManageTask(me, task);
}

/** Legacy self-owned tasks (created by me, no reviewer) can be closed without review. */
export function isSelfOwned(me: Profile | null | undefined, task: Task) {
  return !!me && task.created_by === me.id && !task.reviewer_id;
}

/** Only the company admin plans and distributes monthly work. */
export function canCreateTask(me: Profile | null | undefined) {
  return !!me && me.status === "active" && me.role === "admin";
}

export function canCreateProject(me: Profile | null | undefined) {
  return !!me && (me.role === "admin" || me.role === "manager");
}

export function canEditProject(me: Profile | null | undefined, project: Project) {
  if (!me) return false;
  if (me.role === "admin") return true;
  if (me.role !== "manager") return false;
  return (!!me.department_id && project.department_id === me.department_id) || !!me.department_supervises_all;
}

export function canDeleteProject(me: Profile | null | undefined, project: Project) {
  return canEditProject(me, project);
}

export function canManageMembers(me: Profile | null | undefined) {
  return !!me && (me.role === "admin" || me.role === "manager");
}

export function canEditMember(me: Profile | null | undefined, member: Profile) {
  if (!me) return false;
  if (me.role === "admin") return true;
  return me.role === "manager" && !!me.department_id && member.department_id === me.department_id && member.id !== me.id;
}

/** Roles a member manager may assign when adding people. */
export function assignableRoles(me: Profile | null | undefined): Role[] {
  if (me?.role === "admin") return ["admin", "manager", "supervisor", "employee", "viewer"];
  if (me?.role === "manager") return ["supervisor", "employee", "viewer"];
  return [];
}

export const canCreateDepartment = (me: Profile | null | undefined) => isAdmin(me);
export const canEditDepartment = (me: Profile | null | undefined, dept: Department) =>
  isAdmin(me) || (me?.role === "manager" && !!me.department_id && dept.id === me.department_id);
export const canDeleteDepartment = (me: Profile | null | undefined) => isAdmin(me);

/** Mirrors start_timer / add_time_entry. */
export function canTrackTime(me: Profile | null | undefined, task: Task) {
  if (!me || me.status !== "active" || me.role === "viewer") return false;
  if (task.status === "done" || isMonthLocked(task)) return false;
  return me.role === "admin" || canManageTask(me, task) || isAssignee(me, task);
}

/** Mirrors point_live_settings(): every points screen is dead until the company admin turns it on. */
export const canSeePoints = (me: Profile | null | undefined, settings?: PointSettings | null) =>
  !!me && me.status === "active" && !isDeveloper(me) && (settings === undefined || !!settings?.enabled);

/** Mirrors save_point_settings / save_point_rule / save_reward. */
export const canManagePointsSettings = (me: Profile | null | undefined) => isAdmin(me);

/** Mirrors can_manage_points: the admin covers the company, a lead only their own department. */
export function canManagePoints(me: Profile | null | undefined, target: Pick<Profile, "id" | "status" | "department_id">) {
  if (!me || me.status !== "active" || me.role === "viewer" || !me.company_id) return false;
  if (target.status !== "active") return false;
  if (me.role === "admin") return true;
  if (!DEPT_LEADS.includes(me.role)) return false;
  return (!!me.department_id && target.department_id === me.department_id) || !!me.department_supervises_all;
}

/** Mirrors request_points: a viewer reads, it does not ask. */
export const canRequestPoints = (me: Profile | null | undefined) =>
  !!me && me.status === "active" && me.role !== "viewer" && !isDeveloper(me);

/** Mirrors redeem_reward / decide_redemption / fulfil_redemption for a given member. */
export const canRedeemPoints = (me: Profile | null | undefined) => canRequestPoints(me);

/** Mirrors expire_points, which only runs as the company admin. */
export const canExpirePoints = (me: Profile | null | undefined) => isAdmin(me);

/** Mirrors point_balances: I always see my own row, a lead sees who they can manage. */
export function canViewPointsReport(me: Profile | null | undefined, target?: Profile) {
  if (!me || me.status !== "active") return false;
  if (isAdmin(me)) return true;
  return !!target && canManagePoints(me, target);
}
