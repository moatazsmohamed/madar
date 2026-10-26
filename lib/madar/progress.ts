import { isOverdue, todayISO } from "./format";
import type { Profile, Task } from "./types";

export type TaskTally = {
  total: number;
  done: number;
  review: number;
  open: number;
  overdue: number;
  percent: number;
};

export type MemberTally = TaskTally & { user_id: string; name: string };

/** Whole percentage; empty scope reads 0% rather than NaN. */
export function completionPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/** Counts one month of tasks; a task unfinished after its day is late. */
export function tallyTasks(tasks: Task[], today = todayISO()): TaskTally {
  let done = 0;
  let review = 0;
  let overdue = 0;
  tasks.forEach((task) => {
    if (task.status === "done") {
      done += 1;
      return;
    }
    if (task.status === "review") review += 1;
    if (isOverdue(task) || (!!task.day && task.day < today)) overdue += 1;
  });
  return {
    total: tasks.length,
    done,
    review,
    open: tasks.length - done,
    overdue,
    percent: completionPercent(done, tasks.length),
  };
}

/** Per-assignee tallies; a shared task counts once for every assignee. */
export function memberTallies(tasks: Task[], profiles: Profile[], today = todayISO()): MemberTally[] {
  const byMember = new Map<string, Task[]>();
  tasks.forEach((task) => {
    const ids = new Set((task.task_assignees ?? []).map((a) => a.user_id));
    ids.forEach((user_id) => {
      const list = byMember.get(user_id) ?? [];
      list.push(task);
      byMember.set(user_id, list);
    });
  });
  const names = new Map(profiles.map((p) => [p.id, p.full_name]));
  return [...byMember.entries()]
    .map(([user_id, list]) => ({ ...tallyTasks(list, today), user_id, name: names.get(user_id) ?? "عضو" }))
    .sort((a, b) => a.percent - b.percent || b.total - a.total || a.name.localeCompare(b.name, "ar"));
}
