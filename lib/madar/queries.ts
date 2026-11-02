import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";
import { callAccounts, supabase } from "@/lib/supabase";
import { useSession } from "./session";
import type {
  Activity,
  Attachment,
  Comment,
  Company,
  CompanyDay,
  CompanyJoinInfo,
  CompanyMonth,
  Department,
  DeveloperCompanyStats,
  Invitation,
  MessageKind,
  MyPoints,
  NotificationItem,
  PointBalanceRow,
  PointEntry,
  PointEntryStatus,
  PointEventKey,
  PointPeriodKind,
  PointRule,
  PointSettings,
  Profile,
  Project,
  Redemption,
  Reward,
  Role,
  Subtask,
  Task,
  TaskInput,
  TaskStatus,
  TaskTimeTotal,
  TimeSession,
} from "./types";

const TASK_SELECT = "*, task_assignees(user_id), month:company_months(id, period, status, closed_at, summary)";

async function run<T>(promise: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------- reads

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: () =>
      run<Profile[]>(supabase.from("profiles").select("*").order("full_name", { ascending: true }).limit(2000)),
    staleTime: 60_000,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: () =>
      run<Department[]>(supabase.from("departments").select("*").order("name", { ascending: true }).limit(500)),
    staleTime: 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      run<Project[]>(supabase.from("projects").select("*").order("created_at", { ascending: false }).limit(1000)),
    staleTime: 30_000,
  });
}

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () =>
      run<Task[]>(
        supabase.from("tasks").select(TASK_SELECT).order("created_at", { ascending: false }).limit(3000),
      ),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["task", id],
    enabled: !!id,
    queryFn: () => run<Task | null>(supabase.from("tasks").select(TASK_SELECT).eq("id", id!).maybeSingle()),
  });
}

/** Opens today's day (and the current month), closing past days automatically. */
export function useMonths() {
  return useQuery({
    queryKey: ["months"],
    queryFn: async () => {
      const { error } = await supabase.rpc("ensure_day");
      if (error) throw error;
      return run<CompanyMonth[]>(
        supabase.from("company_months").select("*").order("period", { ascending: false }).limit(120),
      );
    },
    staleTime: 60_000,
  });
}

/** Day-by-day archive for the company. Opening the app opens today's day. */
export function useDays() {
  return useQuery({
    queryKey: ["days"],
    queryFn: async () => {
      const { error } = await supabase.rpc("ensure_day");
      if (error) throw error;
      return run<CompanyDay[]>(
        supabase.from("company_days").select("*").order("day", { ascending: false }).limit(500),
      );
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useTimeTotals() {
  return useQuery({
    queryKey: ["time-totals"],
    queryFn: () => run<TaskTimeTotal[]>(supabase.from("task_time_totals").select("*").limit(5000)),
    staleTime: 30_000,
  });
}

export function useSubtasks(taskId: string | undefined) {
  return useQuery({
    queryKey: ["subtasks", taskId],
    enabled: !!taskId,
    queryFn: () =>
      run<Subtask[]>(
        supabase
          .from("subtasks")
          .select("*")
          .eq("task_id", taskId!)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(500),
      ),
  });
}

export function useComments(taskId: string | undefined) {
  return useQuery({
    queryKey: ["comments", taskId],
    enabled: !!taskId,
    queryFn: () =>
      run<Comment[]>(
        supabase.from("comments").select("*").eq("task_id", taskId!).order("created_at", { ascending: true }).limit(500),
      ),
    refetchInterval: 30_000,
  });
}

export function useAttachments(taskId: string | undefined) {
  return useQuery({
    queryKey: ["attachments", taskId],
    enabled: !!taskId,
    queryFn: () =>
      run<Attachment[]>(
        supabase
          .from("attachments")
          .select("*")
          .eq("task_id", taskId!)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
  });
}

export function useTaskSessions(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task-sessions", taskId],
    enabled: !!taskId,
    queryFn: () =>
      run<TimeSession[]>(
        supabase
          .from("time_sessions")
          .select("*")
          .eq("task_id", taskId!)
          .order("started_at", { ascending: false })
          .limit(500),
      ),
  });
}

export function useTaskActivity(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task-activity", taskId],
    enabled: !!taskId,
    queryFn: () =>
      run<Activity[]>(
        supabase
          .from("activities")
          .select("*")
          .eq("task_id", taskId!)
          .order("created_at", { ascending: false })
          .limit(100),
      ),
  });
}

export function useRecentActivity(limit = 12) {
  return useQuery({
    queryKey: ["activity", limit],
    queryFn: () =>
      run<Activity[]>(supabase.from("activities").select("*").order("created_at", { ascending: false }).limit(limit)),
    refetchInterval: 60_000,
  });
}

export function useOpenSession() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["open-session", userId],
    enabled: !!userId,
    queryFn: () =>
      run<TimeSession | null>(
        supabase
          .from("time_sessions")
          .select("*")
          .eq("user_id", userId!)
          .is("ended_at", null)
          .limit(1)
          .maybeSingle(),
      ),
    refetchInterval: 60_000,
  });
}

export function useSessionsBetween(fromUtc: string, toUtc: string, enabled = true) {
  return useQuery({
    queryKey: ["sessions", fromUtc, toUtc],
    enabled,
    queryFn: () =>
      run<TimeSession[]>(
        supabase
          .from("time_sessions")
          .select("*")
          .gte("started_at", fromUtc)
          .lt("started_at", toUtc)
          .order("started_at", { ascending: true })
          .limit(10000),
      ),
  });
}

export function useNotifications() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["notifications", userId],
    enabled: !!userId,
    queryFn: () =>
      run<NotificationItem[]>(
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId!)
          .order("created_at", { ascending: false })
          .limit(150),
      ),
    refetchInterval: 30_000,
  });
}

export function useInvitations(enabled: boolean) {
  return useQuery({
    queryKey: ["invitations"],
    enabled,
    queryFn: () =>
      run<Invitation[]>(supabase.from("invitations").select("*").order("created_at", { ascending: false }).limit(500)),
  });
}

/** Id → record maps used across screens. */
export function useLookups() {
  const { profile: me } = useSession();
  const profiles = useProfiles();
  const departments = useDepartments();
  const projects = useProjects();
  return useMemo(() => {
    const profileMap = new Map((profiles.data ?? []).map((p) => [p.id, p]));
    // A developer acting inside a company is not a company member, but their id
    // still appears as the actor on records they create there.
    if (me) profileMap.set(me.id, me);
    const departmentMap = new Map((departments.data ?? []).map((d) => [d.id, d]));
    const projectMap = new Map((projects.data ?? []).map((p) => [p.id, p]));
    return {
      profiles: profiles.data ?? [],
      departments: departments.data ?? [],
      projects: projects.data ?? [],
      profileMap,
      departmentMap,
      projectMap,
      loading: profiles.isLoading || departments.isLoading || projects.isLoading,
    };
  }, [me, profiles.data, departments.data, projects.data, profiles.isLoading, departments.isLoading, projects.isLoading]);
}

// ---------------------------------------------------------------- writes

function useAction<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    },
  });
}

const TASK_KEYS: QueryKey[] = [["tasks"], ["task"], ["activity"], ["task-activity"], ["notifications"], ["months"], ["days"]];

export function useSaveTask() {
  return useAction(
    async (vars: { id?: string; input: Partial<TaskInput>; assignees?: string[]; previousAssignees?: string[] }) => {
      let taskId = vars.id;
      if (taskId) {
        if (Object.keys(vars.input).length > 0) {
          await run(supabase.from("tasks").update(vars.input).eq("id", taskId).select("id").single());
        }
      } else {
        const created = await run<{ id: string }>(supabase.from("tasks").insert(vars.input).select("id").single());
        taskId = created.id;
      }
      if (vars.assignees) {
        const before = new Set(vars.previousAssignees ?? []);
        const after = new Set(vars.assignees);
        const toAdd = [...after].filter((u) => !before.has(u));
        const toRemove = [...before].filter((u) => !after.has(u));
        if (toRemove.length) {
          await run(supabase.from("task_assignees").delete().eq("task_id", taskId!).in("user_id", toRemove));
        }
        if (toAdd.length) {
          await run(supabase.from("task_assignees").insert([...new Set(toAdd)].map((user_id) => ({ task_id: taskId!, user_id }))));
        }
      }
      return taskId!;
    },
    TASK_KEYS,
  );
}

export function useSetTaskStatus() {
  return useAction(
    async (vars: { id: string; status: TaskStatus; review_note?: string | null }) => {
      const patch: Record<string, unknown> = { status: vars.status };
      if (vars.review_note !== undefined) patch.review_note = vars.review_note;
      await run(supabase.from("tasks").update(patch).eq("id", vars.id).select("id").single());
    },
    TASK_KEYS,
  );
}

export function useDeleteTask() {
  return useAction(async (id: string) => {
    await run(supabase.from("tasks").delete().eq("id", id));
  }, [["tasks"], ["activity"], ["time-totals"]]);
}

/** Archives a month and locks every task, comment, file and time entry inside it. */
export function useCloseMonth() {
  return useAction(
    async (monthId: string) => {
      const { data, error } = await supabase.rpc("close_month", { p_month: monthId });
      if (error) throw error;
      return data as CompanyMonth;
    },
    [["months"], ["days"], ["tasks"], ["task"], ["time-totals"], ["open-session"], ["task-sessions"], ["sessions"], ["activity"]],
  );
}

/** Takes the current month back to work after an accidental close. */
export function useReopenMonth() {
  return useAction(
    async (monthId: string) => {
      const { data, error } = await supabase.rpc("reopen_month", { p_month: monthId });
      if (error) throw error;
      return data as CompanyMonth;
    },
    [["months"], ["days"], ["tasks"], ["task"], ["time-totals"], ["open-session"], ["task-sessions"], ["sessions"], ["activity"]],
  );
}

/** Early close of today (company admin). Unfinished work stays archived as late. */
export function useCloseDay() {
  return useAction(
    async (day: string) => {
      const { data, error } = await supabase.rpc("close_day", { p_day: day });
      if (error) throw error;
      return data as CompanyDay;
    },
    [["days"], ["months"], ["tasks"], ["task"], ["time-totals"], ["open-session"], ["task-sessions"], ["sessions"], ["activity"]],
  );
}

export function useImportTasks() {
  return useAction(
    async (rows: { input: Partial<TaskInput>; assignees: string[] }[]) => {
      let created = 0;
      for (const row of rows) {
        const task = await run<{ id: string }>(supabase.from("tasks").insert(row.input).select("id").single());
        const unique = [...new Set(row.assignees)];
        if (unique.length) {
          await run(supabase.from("task_assignees").insert(unique.map((user_id) => ({ task_id: task.id, user_id }))));
        }
        created += 1;
      }
      return created;
    },
    TASK_KEYS,
  );
}

const TIME_KEYS: QueryKey[] = [["open-session"], ["time-totals"], ["task-sessions"], ["sessions"], ["tasks"], ["task"]];

export function useStartTimer() {
  return useAction(async (taskId: string) => {
    await run(supabase.rpc("start_timer", { p_task: taskId }));
  }, TIME_KEYS);
}

export function useStopTimer() {
  return useAction(async (note: string | null) => {
    await run(supabase.rpc("stop_timer", { p_note: note }));
  }, TIME_KEYS);
}

export function useAddTimeEntry() {
  return useAction(
    async (vars: { taskId: string; started: string; ended: string; note: string | null }) => {
      await run(
        supabase.rpc("add_time_entry", {
          p_task: vars.taskId,
          p_started: vars.started,
          p_ended: vars.ended,
          p_note: vars.note,
        }),
      );
    },
    TIME_KEYS,
  );
}

export function useDeleteTimeSession() {
  return useAction(async (id: string) => {
    await run(supabase.from("time_sessions").delete().eq("id", id));
  }, TIME_KEYS);
}

export function useSubtaskActions(taskId: string) {
  const keys: QueryKey[] = [["subtasks", taskId]];
  const add = useAction(async (title: string) => {
    await run(supabase.from("subtasks").insert({ task_id: taskId, title, position: Date.now() % 2147483647 }));
  }, keys);
  const toggle = useAction(async (vars: { id: string; done: boolean }) => {
    await run(supabase.from("subtasks").update({ done: vars.done }).eq("id", vars.id));
  }, keys);
  const remove = useAction(async (id: string) => {
    await run(supabase.from("subtasks").delete().eq("id", id));
  }, keys);
  return { add, toggle, remove };
}

export function useCommentActions(taskId: string) {
  const keys: QueryKey[] = [["comments", taskId], ["task-activity", taskId], ["activity"]];
  const add = useAction(async (body: string) => {
    await run(supabase.from("comments").insert({ task_id: taskId, body }));
  }, keys);
  const remove = useAction(async (id: string) => {
    await run(supabase.from("comments").delete().eq("id", id));
  }, keys);
  return { add, remove };
}

export type UploadableFile = { name: string; size: number | null; type: string | null; body: Blob | ArrayBuffer };

export function useAttachmentActions(taskId: string) {
  const keys: QueryKey[] = [["attachments", taskId], ["task-activity", taskId], ["activity"]];
  const upload = useAction(async (file: UploadableFile) => {
    const ext = (file.name.split(".").pop() ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
    const key = `${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext ? `.${ext}` : ""}`;
    const { error } = await supabase.storage
      .from("attachments")
      .upload(key, file.body, { contentType: file.type ?? "application/octet-stream", upsert: false });
    if (error) throw error;
    const { error: rowError } = await supabase.from("attachments").insert({
      task_id: taskId,
      file_name: file.name.slice(0, 200),
      storage_path: key,
      size_bytes: file.size,
      mime_type: file.type,
    });
    if (rowError) {
      await supabase.storage.from("attachments").remove([key]);
      throw rowError;
    }
  }, keys);
  const remove = useAction(async (att: Attachment) => {
    await run(supabase.from("attachments").delete().eq("id", att.id));
    await supabase.storage.from("attachments").remove([att.storage_path]);
  }, keys);
  return { upload, remove };
}

export async function attachmentUrl(att: Attachment) {
  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(att.storage_path, 300, { download: att.file_name });
  if (error) throw error;
  return data.signedUrl;
}

export function useSaveProject() {
  return useAction(
    async (vars: { id?: string; input: Partial<Project> }) => {
      if (vars.id) {
        await run(supabase.from("projects").update(vars.input).eq("id", vars.id).select("id").single());
        return vars.id;
      }
      const created = await run<{ id: string }>(supabase.from("projects").insert(vars.input).select("id").single());
      return created.id;
    },
    [["projects"]],
  );
}

export function useDeleteProject() {
  return useAction(async (id: string) => {
    await run(supabase.from("projects").delete().eq("id", id));
  }, [["projects"], ["tasks"]]);
}

export function useSaveDepartment() {
  return useAction(
    async (vars: { id?: string; input: Partial<Department> }) => {
      if (vars.id) {
        await run(supabase.from("departments").update(vars.input).eq("id", vars.id));
      } else {
        await run(supabase.from("departments").insert(vars.input));
      }
    },
    [["departments"]],
  );
}

export function useDeleteDepartment() {
  return useAction(async (id: string) => {
    await run(supabase.from("departments").delete().eq("id", id));
  }, [["departments"], ["profiles"], ["tasks"], ["projects"]]);
}

export function useUpdateProfile() {
  return useAction(
    async (vars: { id: string; patch: Partial<Profile> }) => {
      await run(supabase.from("profiles").update(vars.patch).eq("id", vars.id).select("id").single());
    },
    [["profiles"], ["me"]],
  );
}

export function useCreateMember() {
  return useAction(
    async (vars: {
      email: string;
      password: string;
      full_name: string;
      role: Role;
      department_id: string | null;
      job_title: string | null;
    }) => callAccounts({ action: "create_member", ...vars }),
    [["profiles"], ["invitations"]],
  );
}

export function useResetPassword() {
  return useAction(
    async (vars: { user_id: string; password: string }) => callAccounts({ action: "reset_password", ...vars }),
    [],
  );
}

export function useInvitationActions() {
  const keys: QueryKey[] = [["invitations"]];
  const add = useAction(async (input: Partial<Invitation>) => {
    await run(supabase.from("invitations").insert(input));
  }, keys);
  const remove = useAction(async (id: string) => {
    await run(supabase.from("invitations").delete().eq("id", id));
  }, keys);
  return { add, remove };
}

export function useSaveSettings() {
  const { company } = useSession();
  return useAction(
    async (patch: Partial<Company>) => {
      if (!company) throw new Error("لا توجد شركة مرتبطة بحسابك");
      await run(supabase.from("companies").update(patch).eq("id", company.id).select("id").single());
    },
    [["company"], ["companies"]],
  );
}

export function useCompanies(enabled = true) {
  return useQuery({
    queryKey: ["companies"],
    enabled,
    queryFn: () =>
      run<Company[]>(supabase.from("companies").select("*").order("created_at", { ascending: false }).limit(500)),
    staleTime: 30_000,
  });
}

/** Admins of every company, for the developer companies screen. */
export function useDeveloperCompanyAdmins(enabled = true) {
  return useQuery({
    queryKey: ["developer-company-admins"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("developer_company_admins");
      if (error) throw error;
      return (data ?? []) as { id: string; company_id: string; full_name: string; email: string }[];
    },
    staleTime: 60_000,
  });
}

export function useCreateCompany() {
  return useAction(
    async (vars: {
      name: string;
      timezone: string;
      admin_name: string;
      admin_email: string;
      admin_password: string;
    }) => callAccounts({ action: "create_company", ...vars }),
    [["companies"], ["profiles"], ["developer-stats"], ["developer-company-admins"]],
  );
}

export function useReviewCompany() {
  return useAction(
    async (vars: { company_id: string; decision: "approve" | "reject" }) =>
      callAccounts({ action: "review_company", ...vars }),
    [["companies"], ["profiles"], ["developer-stats"]],
  );
}

export function useCompanyJoinInfo(code: string | undefined) {
  return useQuery({
    queryKey: ["join-info", code],
    enabled: !!code,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("company_join_info", { p_code: code! });
      if (error) throw error;
      return (data ?? null) as CompanyJoinInfo | null;
    },
  });
}

export function useDeveloperStats(enabled = true) {
  return useQuery({
    queryKey: ["developer-stats"],
    enabled,
    // The RPC aggregates every company; a cheap read even with many tenants.
    queryFn: async () => {
      const { data, error } = await supabase.rpc("developer_company_stats");
      if (error) throw error;
      return (data ?? []) as DeveloperCompanyStats[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useSetCompanyStatus() {
  return useAction(
    async (vars: { company_id: string; status: "active" | "suspended" }) => {
      const { error } = await supabase.rpc("set_company_status", {
        p_company: vars.company_id,
        p_status: vars.status,
      });
      if (error) throw error;
    },
    [["companies"], ["developer-stats"]],
  );
}

export function useRegenerateJoinCode() {
  return useAction(
    async (companyId: string) => {
      const { data, error } = await supabase.rpc("regenerate_join_code", { p_company: companyId });
      if (error) throw error;
      return data as string;
    },
    [["companies"], ["developer-stats"]],
  );
}

export function useNotificationActions() {
  const keys: QueryKey[] = [["notifications"]];
  const markRead = useAction(async (id: string) => {
    await run(supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id));
  }, keys);
  const markAll = useAction(async () => {
    await run(supabase.rpc("mark_all_notifications_read"));
  }, keys);
  const clearRead = useAction(async (userId: string) => {
    await run(supabase.from("notifications").delete().eq("user_id", userId).not("read_at", "is", null));
  }, keys);
  return { markRead, markAll, clearRead };
}

/** Messages and warnings an admin sent to a member (admin-only via RLS). */
export function useMemberMessages(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["member-messages", userId],
    enabled: enabled && !!userId,
    queryFn: () =>
      run<NotificationItem[]>(
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId!)
          .in("kind", ["message", "warning"])
          .order("created_at", { ascending: false })
          .limit(50),
      ),
  });
}

export function useSendMemberMessage() {
  return useAction(
    async (vars: { userId: string; kind: MessageKind; body: string }) =>
      run<string>(
        supabase.rpc("send_member_message", {
          p_user: vars.userId,
          p_kind: vars.kind,
          p_body: vars.body,
        }),
      ),
    [["notifications"], ["member-messages"]],
  );
}

// ---------------------------------------------------------------- points reads

/** Every points write moves the ledger, so it touches the standing, the balances and the queues. */
const POINT_KEYS: QueryKey[] = [
  ["my-points"],
  ["point-balances"],
  ["point-entries"],
  ["redemptions"],
  ["rewards"],
  ["notifications"],
];
const POINT_CONFIG_KEYS: QueryKey[] = [["point-settings"], ["point-rules"], ...POINT_KEYS];

/** One row per company; null until the admin saves the settings for the first time. */
export function usePointSettings(enabled = true) {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["point-settings", userId],
    enabled,
    queryFn: () => run<PointSettings | null>(supabase.from("point_settings").select("*").limit(1).maybeSingle()),
    staleTime: 60_000,
  });
}

export function usePointRules(enabled = true) {
  return useQuery({
    queryKey: ["point-rules"],
    enabled,
    queryFn: () =>
      run<PointRule[]>(supabase.from("point_rules").select("*").order("event_key").order("name").limit(200)),
    staleTime: 60_000,
  });
}

export function useRewards(enabled = true) {
  return useQuery({
    queryKey: ["rewards"],
    enabled,
    queryFn: () =>
      run<Reward[]>(
        supabase.from("rewards").select("*").order("cost_points", { ascending: true }).order("name").limit(300),
      ),
    staleTime: 60_000,
  });
}

/** My standing, computed by the server from the ledger. */
export function useMyPoints() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["my-points", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_points");
      if (error) throw error;
      return (data ?? [])[0] as MyPoints | undefined;
    },
  });
}

/** Balances for the members this caller is allowed to see — the same join RLS applies to point_entries. */
export function usePointBalances(enabled = true) {
  return useQuery({
    queryKey: ["point-balances"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("point_balances");
      if (error) throw error;
      return (data ?? []) as PointBalanceRow[];
    },
  });
}

export function usePointEntries(
  opts: { member?: string | null; status?: PointEntryStatus | null; rule?: PointEventKey | null } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["point-entries", opts.member ?? null, opts.status ?? null],
    enabled,
    queryFn: () => {
      let query = supabase.from("point_entries").select("*").order("created_at", { ascending: false }).limit(300);
      if (opts.member) query = query.eq("member_id", opts.member);
      if (opts.status) query = query.eq("status", opts.status);
      if (opts.rule) query = query.in("source", ["rule"]);
      return run<PointEntry[]>(query);
    },
  });
}

export function useRedemptions(scope: "mine" | "company" = "mine", enabled = true) {
  const { userId } = useSession();
  return useQuery({
    queryKey: ["redemptions", scope, userId],
    enabled: enabled && !!userId,
    queryFn: () => {
      let query = supabase.from("redemptions").select("*").order("created_at", { ascending: false }).limit(300);
      if (scope === "mine") query = query.eq("member_id", userId!);
      return run<Redemption[]>(query);
    },
  });
}

// ---------------------------------------------------------------- points writes

export function useSavePointSettings() {
  return useAction(
    async (vars: {
      enabled: boolean;
      unitLabel: string;
      unitSymbol: string;
      requireApproval: boolean;
      periodKind: PointPeriodKind;
      cap: number | null;
      expiryDays: number | null;
      minRedeem: number | null;
    }) => {
      const { data, error } = await supabase.rpc("save_point_settings", {
        p_enabled: vars.enabled,
        p_unit_label: vars.unitLabel,
        p_unit_symbol: vars.unitSymbol,
        p_require_approval: vars.requireApproval,
        p_period_kind: vars.periodKind,
        p_cap: vars.cap,
        p_expiry_days: vars.expiryDays,
        p_min_redeem: vars.minRedeem,
      });
      if (error) throw error;
      return data as PointSettings;
    },
    POINT_CONFIG_KEYS,
  );
}

export function useSavePointRule() {
  return useAction(
    async (vars: {
      id: string | null;
      eventKey: PointEventKey;
      name: string;
      description: string | null;
      points: number;
      enabled: boolean;
      requireApproval: boolean | null;
      maxPerMember: number | null;
      startsOn: string | null;
      endsOn: string | null;
    }) => {
      const { data, error } = await supabase.rpc("save_point_rule", {
        p_id: vars.id,
        p_event_key: vars.eventKey,
        p_name: vars.name,
        p_description: vars.description,
        p_points: vars.points,
        p_enabled: vars.enabled,
        p_require_approval: vars.requireApproval,
        p_max_per_member: vars.maxPerMember,
        p_starts_on: vars.startsOn,
        p_ends_on: vars.endsOn,
      });
      if (error) throw error;
      return data as PointRule;
    },
    POINT_CONFIG_KEYS,
  );
}

export function useSaveReward() {
  return useAction(
    async (vars: {
      id: string | null;
      name: string;
      description: string | null;
      cost: number;
      stock: number | null;
      perMemberMax: number | null;
      enabled: boolean;
    }) => {
      const { data, error } = await supabase.rpc("save_reward", {
        p_id: vars.id,
        p_name: vars.name,
        p_description: vars.description,
        p_cost: vars.cost,
        p_stock: vars.stock,
        p_per_member_max: vars.perMemberMax,
        p_enabled: vars.enabled,
      });
      if (error) throw error;
      return data as Reward;
    },
    [["rewards"], ...POINT_KEYS],
  );
}

/** Grant or deduct for a member; the token makes a double click replay the same entry. */
export function useGrantPoints() {
  return useAction(
    async (vars: { member: string; points: number | null; reason: string; requestId: string }) => {
      const { data, error } = await supabase.rpc("grant_points", {
        p_member: vars.member,
        p_points: vars.points,
        p_reason: vars.reason,
        p_request_id: vars.requestId,
      });
      if (error) throw error;
      return data as PointEntry;
    },
    POINT_KEYS,
  );
}

export function useRequestPoints() {
  return useAction(
    async (vars: { points: number; reason: string; requestId: string }) => {
      const { data, error } = await supabase.rpc("request_points", {
        p_points: vars.points,
        p_reason: vars.reason,
        p_request_id: vars.requestId,
      });
      if (error) throw error;
      return data as PointEntry;
    },
    POINT_KEYS,
  );
}

export function useDecidePointEntry() {
  return useAction(
    async (vars: { id: string; approve: boolean; note?: string | null }) => {
      const { data, error } = await supabase.rpc("decide_point_entry", {
        p_entry: vars.id,
        p_approve: vars.approve,
        p_note: vars.note ?? null,
      });
      if (error) throw error;
      return data as PointEntry;
    },
    POINT_KEYS,
  );
}

/** A correction is a new reverse row — history is never rewritten. */
export function useCorrectPointEntry() {
  return useAction(
    async (vars: { id: string; note: string }) => {
      const { data, error } = await supabase.rpc("correct_point_entry", { p_entry: vars.id, p_note: vars.note });
      if (error) throw error;
      return data as PointEntry;
    },
    POINT_KEYS,
  );
}

export function useRedeemReward() {
  return useAction(
    async (vars: { reward: string; requestId: string }) => {
      const { data, error } = await supabase.rpc("redeem_reward", {
        p_reward: vars.reward,
        p_request_id: vars.requestId,
      });
      if (error) throw error;
      return data as Redemption;
    },
    POINT_KEYS,
  );
}

export function useDecideRedemption() {
  return useAction(
    async (vars: { id: string; approve: boolean; note?: string | null }) => {
      const { data, error } = await supabase.rpc("decide_redemption", {
        p_redemption: vars.id,
        p_approve: vars.approve,
        p_note: vars.note ?? null,
      });
      if (error) throw error;
      return data as Redemption;
    },
    POINT_KEYS,
  );
}

export function useFulfilRedemption() {
  return useAction(
    async (vars: { id: string; note?: string | null }) => {
      const { data, error } = await supabase.rpc("fulfil_redemption", {
        p_redemption: vars.id,
        p_note: vars.note ?? null,
      });
      if (error) throw error;
      return data as Redemption;
    },
    POINT_KEYS,
  );
}

/** Cancels a delivered reward and returns the points as a fresh reverse row. */
export function useRefundRedemption() {
  return useAction(
    async (vars: { id: string; note: string }) => {
      const { data, error } = await supabase.rpc("refund_redemption", { p_redemption: vars.id, p_note: vars.note });
      if (error) throw error;
      return data as Redemption;
    },
    POINT_KEYS,
  );
}

/** Admin-only sweep: expired approved earns become expire rows. */
export function useExpirePoints() {
  return useAction(
    async () => {
      const { data, error } = await supabase.rpc("expire_points");
      if (error) throw error;
      return data as number;
    },
    POINT_KEYS,
  );
}

