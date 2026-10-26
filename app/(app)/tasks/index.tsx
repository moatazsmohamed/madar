import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { DayCalendar } from "@/components/madar/day-calendar";
import { Page } from "@/components/madar/shell";
import { TaskForm } from "@/components/madar/tasks";
import { TaskCalendar, TaskKanban, TaskTable, TaskTimeline } from "@/components/madar/task-views";
import {
  Button,
  Chip,
  EmptyState,
  InfoBox,
  Loading,
  SearchInput,
  Segmented,
  Select,
  T,
  ErrorBox,
  confirmAction,
  useIsWide,
  useToast,
} from "@/components/madar/ui";
import { addDays, endOfMonth, fmtDateTime, fmtDayFull, fmtHours, fmtMonth, isOverdue, todayISO } from "@/lib/madar/format";
import { PRIORITY_LABELS, PRIORITY_ORDER, STATUS_LABELS, STATUS_ORDER } from "@/lib/madar/labels";
import { canCreateTask, canReviewTask, isAssignee, isGeneralLead, isLead } from "@/lib/madar/permissions";
import { useCloseDay, useCloseMonth, useDays, useLookups, useMonths, useTasks } from "@/lib/madar/queries";
import { sortTasks, useMinutesMap, type Sort } from "@/lib/madar/task-utils";
import { useMe } from "@/lib/madar/session";
import type { Priority, TaskStatus } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

type ViewMode = "table" | "kanban" | "calendar" | "timeline";
type Scope = "all" | "mine" | "created" | "review" | "overdue";

export default function TasksScreen() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ view?: string; scope?: string; project?: string; new?: string; day?: string }>();
  const tasksQuery = useTasks();
  const monthsQuery = useMonths();
  const daysQuery = useDays();
  const closeMonth = useCloseMonth();
  const closeDay = useCloseDay();
  const minutes = useMinutesMap();
  const { profiles, projects, departments } = useLookups();
  const wide = useIsWide();
  const today = todayISO();

  const companyAdmin = me.role === "admin";
  const lead = isLead(me);
  const companyScope = companyAdmin || isGeneralLead(me);
  const scopes: { value: Scope; label: string }[] = companyAdmin
    ? [
        { value: "all", label: "كل المهام" },
        { value: "mine", label: "مهامي" },
        { value: "created", label: "أنشأتها" },
        { value: "review", label: "للمراجعة" },
        { value: "overdue", label: "متأخرة" },
      ]
    : lead
      ? [
          { value: "all", label: companyScope ? "كل المهام" : "مهام القسم" },
          { value: "mine", label: "مهامي" },
          { value: "review", label: "للمراجعة" },
          { value: "overdue", label: "متأخرة" },
        ]
      : me.role === "viewer"
        ? [
            { value: "all", label: "مهام القسم" },
            { value: "overdue", label: "متأخرة" },
          ]
        : [
            { value: "mine", label: "مهامي" },
            { value: "overdue", label: "متأخرة" },
          ];
  const requestedScope = scopes.find((s) => s.value === params.scope)?.value;

  const [view, setView] = useState<ViewMode>((params.view as ViewMode) || "table");
  const [scope, setScope] = useState<Scope>(requestedScope ?? (companyAdmin || lead || me.role === "viewer" ? "all" : "mine"));
  const [monthId, setMonthId] = useState<string | null>(null);
  const [daySel, setDaySel] = useState<string | null | undefined>(params.day);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [projectId, setProjectId] = useState<string | null>(params.project ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [sort, setSort] = useState<Sort>("due");
  const [creating, setCreating] = useState(params.new === "1");

  const months = monthsQuery.data ?? [];
  const openMonth = months.find((m) => m.status === "open") ?? null;
  const selectedMonth = (monthId ? months.find((m) => m.id === monthId) : null) ?? openMonth ?? months[0] ?? null;
  const locked = selectedMonth?.status === "closed";
  const canCreate = canCreateTask(me) && (!monthsQuery.isSuccess || !!openMonth);

  const monthTasks = useMemo(
    () => (tasksQuery.data ?? []).filter((t) => !selectedMonth || t.month_id === selectedMonth.id),
    [tasksQuery.data, selectedMonth],
  );

  const monthIsCurrent = selectedMonth?.period.slice(0, 7) === today.slice(0, 7);
  const selectedDay = daySel === undefined ? (monthIsCurrent ? today : null) : daySel;
  const days = daysQuery.data ?? [];
  const closedDays = useMemo(() => {
    const set = new Set<string>();
    (daysQuery.data ?? []).forEach((d) => {
      if (d.status === "closed") set.add(d.day);
    });
    // The database closes any past day even before the sync call lands.
    monthTasks.forEach((t) => {
      if (t.day < today) set.add(t.day);
    });
    return set;
  }, [daysQuery.data, monthTasks, today]);
  const todayRow = days.find((d) => d.day === today);
  const canCloseToday = companyAdmin && selectedMonth?.status === "open" && monthIsCurrent && todayRow?.status === "open";
  const monthLastDay = selectedMonth ? endOfMonth(selectedMonth.period) : null;
  const canCloseMonth = companyAdmin && selectedMonth?.status === "open" && monthLastDay === today;

  /** New tasks land on the selected day, or the first open day from today. */
  const defaultDay = useMemo(() => {
    if (selectedDay && !closedDays.has(selectedDay)) return selectedDay;
    if (!closedDays.has(today)) return today;
    for (let i = 1; i <= 31; i += 1) {
      const candidate = addDays(today, i);
      if (candidate.slice(0, 7) !== today.slice(0, 7)) break;
      if (!closedDays.has(candidate)) return candidate;
    }
    return today;
  }, [selectedDay, closedDays, today]);

  const tasks = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = monthTasks.filter((t) => {
      if (selectedDay && t.day !== selectedDay) return false;
      if (scope === "mine" && !isAssignee(me, t)) return false;
      if (scope === "created" && t.created_by !== me.id) return false;
      if (scope === "review" && !(t.status === "review" && canReviewTask(me, t))) return false;
      if (scope === "overdue" && !isOverdue(t)) return false;
      if (status && t.status !== status) return false;
      if (priority && t.priority !== priority) return false;
      if (projectId && t.project_id !== projectId) return false;
      if (departmentId && t.department_id !== departmentId) return false;
      if (assigneeId && !t.task_assignees?.some((a) => a.user_id === assigneeId)) return false;
      if (hideDone && t.status === "done") return false;
      if (term && !`${t.title} ${t.description ?? ""} #${t.number}`.toLowerCase().includes(term)) return false;
      return true;
    });
    list = sortTasks(list, sort);
    return list;
  }, [monthTasks, selectedDay, q, scope, status, priority, projectId, assigneeId, departmentId, hideDone, sort, me]);

  const filtersActive = !!(status || priority || projectId || assigneeId || departmentId || q);

  const closeSelectedMonth = async () => {
    if (!selectedMonth || !canCloseMonth) return;
    if (!(await confirmAction(`إغلاق ${fmtMonth(selectedMonth.period)}؟ سيُحفظ كل ما فيه ويصبح للعرض فقط ولا يمكن تعديله بعد ذلك.`, "إغلاق الشهر"))) return;
    closeMonth.mutate(selectedMonth.id, {
      onSuccess: () => toast.show("أُغلق الشهر وأُرشف بكل بياناته"),
      onError: (e) => toast.show(errorMessage(e), "error"),
    });
  };

  const closeToday = async () => {
    if (!(await confirmAction(`إغلاق يوم ${fmtDayFull(today)}؟ ستُغلق مهام اليوم ويتوقف تسجيل الوقت عليه، وتبقى بياناته محفوظة للعرض.`, "إغلاق اليوم"))) return;
    closeDay.mutate(today, {
      onSuccess: () => toast.show("أُغلق اليوم وأُرشف بكل مهامه"),
      onError: (e) => toast.show(errorMessage(e), "error"),
    });
  };

  const pickMonth = (id: string | null) => {
    setMonthId(id);
    setDaySel(undefined);
  };

  return (
    <Page
      title="المهام"
      subtitle={
        selectedMonth
          ? `${fmtMonth(selectedMonth.period)}${selectedDay ? ` · ${selectedDay === today ? "مهام اليوم" : fmtDayFull(selectedDay)}` : ""} · ${tasks.length} من ${monthTasks.length} مهمة`
          : tasksQuery.data
            ? `${tasks.length} مهمة`
            : undefined
      }
      actions={
        <>
          {canCreate ? <Button title="مهمة جديدة" icon="plus" onPress={() => setCreating(true)} /> : null}
          {canCloseToday ? (
            <Button title="إغلاق اليوم" icon="lock" variant="secondary" onPress={closeToday} loading={closeDay.isPending} />
          ) : null}
          {companyAdmin && selectedMonth?.status === "open" ? (
            <Button
              title="إغلاق الشهر"
              icon="archive"
              variant="ghost"
              onPress={closeSelectedMonth}
              loading={closeMonth.isPending}
              disabled={!canCloseMonth}
            />
          ) : null}
        </>
      }
      maxWidth={view === "kanban" ? 1600 : 1240}
    >
      <View style={{ gap: 7, marginBottom: 16 }}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {months.slice(0, 6).map((m) => (
            <Chip
              key={m.id}
              label={fmtMonth(m.period)}
              icon={m.status === "open" ? "unlock" : "archive"}
              active={selectedMonth?.id === m.id}
              onPress={() => pickMonth(m.id)}
            />
          ))}
          {months.length > 6 ? (
            <View style={{ minWidth: 190, flex: 1, maxWidth: 240 }}>
              <Select
                value={selectedMonth?.id ?? null}
                onChange={pickMonth}
                options={months.map((m) => ({ value: m.id, label: fmtMonth(m.period), hint: m.status === "open" ? "مفتوح" : "مؤرشف" }))}
                title="كل الأشهر"
                placeholder="كل الأشهر"
              />
            </View>
          ) : null}
        </View>
        {selectedMonth ? (
          <T className="text-[12px] text-muted">
            {selectedMonth.status === "open"
              ? "كل يوم يُغلق تلقائيًا في منتصف الليل بتوقيت الشركة (أو يدويًا من مدير الشركة)، ويُفتح يوم جديد. المهام غير المنتهية تبقى مؤرشفة كمتأخرة."
              : `شهر مؤرشف — أُغلق ${fmtDateTime(selectedMonth.closed_at)}. كل بياناته محفوظة للعرض فقط.`}
          </T>
        ) : null}
        {companyAdmin && selectedMonth?.status === "open" && !canCloseMonth && monthLastDay ? (
          <T className="text-[12px] text-muted">
            {`إغلاق الشهر يدويًا متاح في آخر يوم فقط (${fmtDayFull(monthLastDay)})؛ بعدها يتقفل تلقائيًا ويُفتح شهر جديد.`}
          </T>
        ) : null}
      </View>

      {selectedMonth ? (
        <View style={{ gap: 10, marginBottom: 12 }}>
          <DayCalendar month={selectedMonth.period} tasks={monthTasks} days={days} selected={selectedDay} onSelect={setDaySel} />
          {selectedDay && closedDays.has(selectedDay) && selectedMonth.status === "open" ? (
            <InfoBox tone="neutral" icon="lock">
              <T weight="semibold" className="text-[13px]">
                {selectedDay === today ? "أُغلق اليوم" : `أُغلق يوم ${fmtDayFull(selectedDay)}`}
              </T>
              <T className="text-[12.5px]">المهام والتعليقات والوقت محفوظة للعرض فقط. المهام التي لم تُنجز تبقى مسجلة كمتأخرة.</T>
            </InfoBox>
          ) : null}
        </View>
      ) : null}

      {locked && selectedMonth?.summary ? (
        <InfoBox tone="warning" icon="lock">
          <T weight="semibold" className="text-[13px]">
            ملخص {fmtMonth(selectedMonth.period)}
          </T>
          <T className="text-[12.5px]">
            {`${selectedMonth.summary.tasks} مهمة · ${selectedMonth.summary.done} مكتملة · ${selectedMonth.summary.employees} موظف · ${fmtHours(selectedMonth.summary.minutes)} ساعة عمل`}
          </T>
        </InfoBox>
      ) : null}

      <View style={{ gap: 12, marginBottom: 16, marginTop: 12 }}>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "table", label: wide ? "جدول" : "قائمة", icon: "list" },
              { value: "kanban", label: "كانبان", icon: "columns" },
              { value: "calendar", label: "تقويم", icon: "calendar" },
              { value: "timeline", label: "زمني", icon: "sliders" },
            ]}
          />
          <SearchInput value={q} onChangeText={setQ} placeholder="ابحث بالعنوان أو الرقم…" />
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {scopes.map((s) => (
            <Chip key={s.value} label={s.label} active={scope === s.value} onPress={() => setScope(s.value)} />
          ))}
          <Chip label="إخفاء المكتملة" icon={hideDone ? "eye-off" : "eye"} active={hideDone} onPress={() => setHideDone(!hideDone)} />
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <View style={{ minWidth: 150, flex: 1, maxWidth: 220 }}>
            <Select value={status} onChange={setStatus} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} noneLabel="كل الحالات" placeholder="كل الحالات" title="الحالة" />
          </View>
          <View style={{ minWidth: 150, flex: 1, maxWidth: 220 }}>
            <Select value={priority} onChange={setPriority} options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} noneLabel="كل الأولويات" placeholder="كل الأولويات" title="الأولوية" />
          </View>
          <View style={{ minWidth: 150, flex: 1, maxWidth: 220 }}>
            <Select value={projectId} onChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name, color: p.color }))} noneLabel="كل المشاريع" placeholder="كل المشاريع" title="المشروع" />
          </View>
          {lead || me.role === "viewer" ? (
            <View style={{ minWidth: 150, flex: 1, maxWidth: 220 }}>
              <Select
                value={assigneeId}
                onChange={setAssigneeId}
                options={profiles.filter((p) => p.status === "active").map((p) => ({ value: p.id, label: p.full_name }))}
                noneLabel="كل الموظفين"
                placeholder="كل الموظفين"
                title="المسؤول"
              />
            </View>
          ) : null}
          {companyScope && departments.length ? (
            <View style={{ minWidth: 150, flex: 1, maxWidth: 220 }}>
              <Select value={departmentId} onChange={setDepartmentId} options={departments.map((d) => ({ value: d.id, label: d.name, color: d.color }))} noneLabel="كل الأقسام" placeholder="كل الأقسام" title="القسم" />
            </View>
          ) : null}
          {view === "table" ? (
            <View style={{ minWidth: 150, flex: 1, maxWidth: 200 }}>
              <Select
                value={sort}
                onChange={(v) => setSort((v as Sort) ?? "due")}
                options={[
                  { value: "due", label: "ترتيب: الاستحقاق" },
                  { value: "priority", label: "ترتيب: الأولوية" },
                  { value: "recent", label: "ترتيب: الأحدث" },
                ]}
                title="الترتيب"
              />
            </View>
          ) : null}
          {filtersActive ? (
            <Button
              title="مسح الفلاتر"
              variant="ghost"
              icon="x"
              size="sm"
              onPress={() => {
                setQ("");
                setStatus(null);
                setPriority(null);
                setProjectId(null);
                setAssigneeId(null);
                setDepartmentId(null);
              }}
            />
          ) : null}
        </View>
      </View>

      {tasksQuery.isLoading ? (
        <Loading />
      ) : tasksQuery.error ? (
        <ErrorBox message={errorMessage(tasksQuery.error)} />
      ) : monthTasks.length === 0 ? (
        <EmptyState
          icon="check-square"
          title={selectedMonth ? `لا توجد مهام في ${fmtMonth(selectedMonth.period)}` : "لا توجد مهام بعد"}
          hint={canCreate ? "أضف مهام الشهر ووزّعها على الفريق." : "ستظهر هنا المهام المسندة إليك."}
          action={canCreate ? <Button title="مهمة جديدة" icon="plus" onPress={() => setCreating(true)} /> : null}
        />
      ) : tasks.length === 0 && selectedDay ? (
        <EmptyState
          icon="calendar"
          title={selectedDay === today ? "لا توجد مهام لليوم" : `لا توجد مهام في ${fmtDayFull(selectedDay)}`}
          hint={closedDays.has(selectedDay) ? "هذا اليوم مؤرشف؛ اختر يومًا آخر من التقويم." : canCreate ? "أضف مهمة لهذا اليوم وحدد المسؤول عنها." : "لم تُسند إليك مهام في هذا اليوم."}
          action={canCreate && !closedDays.has(selectedDay) ? <Button title="مهمة جديدة" icon="plus" onPress={() => setCreating(true)} /> : null}
        />
      ) : view === "kanban" ? (
        <TaskKanban tasks={tasks} minutes={minutes} closedDays={closedDays} />
      ) : view === "calendar" ? (
        <TaskCalendar tasks={tasks} minutes={minutes} closedDays={closedDays} />
      ) : view === "timeline" ? (
        <TaskTimeline tasks={tasks} minutes={minutes} closedDays={closedDays} />
      ) : (
        <TaskTable tasks={tasks} minutes={minutes} closedDays={closedDays} empty={<EmptyState icon="filter" title="لا توجد مهام مطابقة" hint="جرّب تغيير الفلاتر أو نطاق العرض." />} />
      )}
      {!tasksQuery.isLoading && scope === "mine" && tasks.length === 0 && monthTasks.length > 0 && scopes[0]?.value !== "mine" ? (
        <T className="mt-3 text-center text-[12px] text-muted">اعرض «{scopes[0].label}» لرؤية بقية المهام.</T>
      ) : null}

      <TaskForm
        visible={creating}
        onClose={() => setCreating(false)}
        defaults={{ project_id: projectId, day: defaultDay }}
        onSaved={(id) => router.push(`/tasks/${id}` as any)}
      />
    </Page>
  );
}
