import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { fmtDay, fmtDayFull, isOverdue, todayISO } from "@/lib/madar/format";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  PRIORITY_TONE,
  ROLE_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_TONE,
} from "@/lib/madar/labels";
import { canCreateTask, canEditTaskDetails, canManageTask, canReviewTask, canWorkOnTask, isAdmin, isAssignee, isMonthLocked, isSelfOwned, isTaskDayClosed } from "@/lib/madar/permissions";
import { useImportTasks, useLookups, useSaveTask, useSetTaskStatus } from "@/lib/madar/queries";
import { useMe } from "@/lib/madar/session";
import type { Priority, Task, TaskInput, TaskStatus } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";
import {
  AvatarStack,
  Button,
  C,
  DateField,
  ErrorBox,
  Field,
  Icon,
  Input,
  MultiSelect,
  Pill,
  Segmented,
  Select,
  Sheet,
  T,
  Tap,
  useToast,
} from "./ui";

export function StatusPill({ status }: { status: TaskStatus }) {
  return <Pill label={STATUS_LABELS[status]} tone={STATUS_TONE[status]} dot />;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const icon = priority === "urgent" ? "zap" : priority === "high" ? "arrow-up" : priority === "low" ? "arrow-down" : "minus";
  return <Pill label={PRIORITY_LABELS[priority]} tone={PRIORITY_TONE[priority]} icon={icon as any} />;
}

export function DueLabel({ task, compact }: { task: Task; compact?: boolean }) {
  if (!task.due_date) return <T className="text-[12px] text-muted">{compact ? "" : "بدون موعد"}</T>;
  const overdue = isOverdue(task);
  const today = task.due_date === todayISO() && task.status !== "done";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name="calendar" size={12} color={overdue ? C.error : today ? C.warning : C.muted} />
      <T weight={overdue || today ? "semibold" : "regular"} style={{ fontSize: 12, color: overdue ? C.error : today ? C.warning : C.muted }}>
        {today ? "اليوم" : fmtDay(task.due_date)}
        {overdue ? " · متأخرة" : ""}
      </T>
    </View>
  );
}

/** The day a task belongs to, with the late marker once that day is archived. */
export function DayLabel({ task }: { task: Task }) {
  if (!task.day) return null;
  const today = todayISO();
  const late = task.day < today && task.status !== "done";
  const isToday = task.day === today && task.status !== "done";
  const color = late ? C.error : isToday ? C.warning : C.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name={late ? "alert-circle" : "clock"} size={12} color={color} />
      <T weight={late || isToday ? "semibold" : "regular"} style={{ fontSize: 12, color }}>
        {isToday ? "اليوم" : fmtDay(task.day)}
        {late ? " · متأخرة" : ""}
      </T>
    </View>
  );
}

export function useTaskPeople(task: Task) {
  const { profileMap } = useLookups();
  return (task.task_assignees ?? [])
    .map((a) => profileMap.get(a.user_id))
    .filter(Boolean)
    .map((p) => ({ id: p!.id, full_name: p!.full_name }));
}

export function Assignees({ task, size = 24 }: { task: Task; size?: number }) {
  const people = useTaskPeople(task);
  return <AvatarStack people={people} size={size} />;
}

/** Status transitions the current member is allowed to make (mirrors the tasks_before_write trigger). */
export function allowedTransitions(me: ReturnType<typeof useMe>, task: Task, dayClosed = false): TaskStatus[] {
  if (!me || me.status !== "active" || isMonthLocked(task)) return [];
  if (dayClosed) {
    return task.status === "review" && canReviewTask(me, task) ? ["done", "in_progress"] : [];
  }
  if (canManageTask(me, task)) return STATUS_ORDER.filter((s) => s !== task.status);
  if (canReviewTask(me, task)) return task.status === "review" ? ["done", "in_progress"] : [];
  if (canWorkOnTask(me, task) && isAssignee(me, task)) {
    if (task.status === "done" && !isSelfOwned(me, task)) return [];
    return STATUS_ORDER.filter((s) => s !== task.status && (s !== "done" || isSelfOwned(me, task)));
  }
  return [];
}

/** One-tap finish: sends the task to review, or closes it when it has no reviewer. */
export function FinishButton({
  task,
  dayClosed,
  size = "sm",
  full,
}: {
  task: Task;
  dayClosed?: boolean;
  size?: "sm" | "md";
  full?: boolean;
}) {
  const me = useMe();
  const setStatus = useSetTaskStatus();
  const toast = useToast();
  const locked = isMonthLocked(task) || !!dayClosed;
  const self = isSelfOwned(me, task);
  const canFinish = !!me && me.status === "active" && me.role !== "viewer" && canWorkOnTask(me, task) && task.status !== "done" && task.status !== "review";
  if (!canFinish) return null;
  const target: TaskStatus = self ? "done" : "review";
  return (
    <Button
      title={locked ? "أُغلق" : "إنهاء"}
      icon={locked ? "lock" : "check-circle"}
      size={size}
      full={full}
      variant={locked ? "ghost" : "soft"}
      disabled={locked}
      loading={setStatus.isPending}
      onPress={() =>
        setStatus.mutate(
          { id: task.id, status: target },
          {
            onSuccess: () => toast.show(self ? "أُغلقت المهمة" : "أُرسلت المهمة للمراجعة"),
            onError: (e) => toast.show(errorMessage(e), "error"),
          },
        )
      }
    />
  );
}

export function StatusMenu({ task, trigger, dayClosed }: { task: Task; trigger?: (open: () => void) => React.ReactNode; dayClosed?: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const setStatus = useSetTaskStatus();
  const toast = useToast();
  const options = allowedTransitions(me, task, dayClosed);
  const locked = isMonthLocked(task) || !!dayClosed;
  const opener = () => setOpen(true);
  return (
    <>
      {trigger ? (
        trigger(opener)
      ) : (
        <Tap onPress={options.length ? opener : undefined}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <StatusPill status={task.status} />
            {options.length ? <Icon name="chevron-down" size={13} color={C.muted} /> : null}
          </View>
        </Tap>
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="تغيير الحالة" subtitle={task.title} width={420}>
        <View style={{ gap: 6 }}>
          {options.map((s) => (
            <Tap
              key={s}
              onPress={() =>
                setStatus.mutate(
                  { id: task.id, status: s },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.show(`أصبحت المهمة: ${STATUS_LABELS[s]}`);
                    },
                    onError: (e) => toast.show(errorMessage(e), "error"),
                  },
                )
              }
              style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}
            >
              <StatusPill status={s} />
              <View style={{ flex: 1 }} />
              <Icon name="arrow-left" size={15} color={C.muted} />
            </Tap>
          ))}
          {options.length === 0 ? (
            <T className="text-muted">
              {locked
                ? dayClosed
                  ? "هذا اليوم مغلق ومؤرشف؛ الحالة محفوظة للعرض فقط."
                  : "هذا الشهر مؤرشف؛ الحالة محفوظة للعرض فقط."
                : me.role === "viewer"
                  ? "حساب المشاهدة للاطلاع فقط."
                  : "لا تملك صلاحية تغيير حالة هذه المهمة."}
            </T>
          ) : null}
        </View>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------- form

type Defaults = Partial<Pick<TaskInput, "project_id" | "status" | "due_date" | "start_date" | "day">> & { assignees?: string[] };

export function TaskForm({
  visible,
  onClose,
  task,
  defaults,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  task?: Task | null;
  defaults?: Defaults;
  onSaved?: (id: string) => void;
}) {
  const me = useMe();
  const { profiles, projects, departments, departmentMap, projectMap, profileMap } = useLookups();
  const save = useSaveTask();
  const importTasks = useImportTasks();
  const toast = useToast();
  const admin = isAdmin(me);
  const canCreate = canCreateTask(me);

  const initial = useMemo(
    () => ({
      title: task?.title ?? "",
      description: task?.description ?? "",
      project_id: task?.project_id ?? defaults?.project_id ?? null,
      department_id: task?.department_id ?? (admin ? null : me.department_id),
      status: task?.status ?? defaults?.status ?? ("todo" as TaskStatus),
      priority: task?.priority ?? ("medium" as Priority),
      start_date: task?.start_date ?? defaults?.start_date ?? null,
      due_date: task?.due_date ?? defaults?.due_date ?? null,
      day: task?.day ?? defaults?.day ?? todayISO(),
      estimateHours: task?.estimate_minutes ? String(Math.floor(task.estimate_minutes / 60)) : "",
      estimateMinutes: task?.estimate_minutes ? String(task.estimate_minutes % 60) : "",
      reviewer_id: task?.reviewer_id ?? null,
      assignees: task ? (task.task_assignees ?? []).map((a) => a.user_id) : defaults?.assignees ?? [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [task?.id, visible],
  );
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [multi, setMulti] = useState(false);
  const [bulk, setBulk] = useState("");
  useEffect(() => {
    setForm(initial);
    setError(null);
    setMulti(false);
    setBulk("");
  }, [initial]);

  const bulkLines = useMemo(
    () => bulk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    [bulk],
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const activePeople = profiles.filter((p) => p.status === "active" && p.role !== "viewer");
  // Managers may only staff their own department; the database enforces the same rule.
  const scopedPeople = admin ? activePeople : activePeople.filter((p) => p.department_id === me.department_id || form.assignees.includes(p.id));
  const assigneeOptions = scopedPeople
    .slice()
    .sort((a, b) => {
      const da = a.department_id === me.department_id ? 0 : 1;
      const db = b.department_id === me.department_id ? 0 : 1;
      return da - db || a.full_name.localeCompare(b.full_name, "ar");
    })
    .map((p) => ({
      value: p.id,
      label: p.id === me.id ? `${p.full_name} (أنا)` : p.full_name,
      hint: [p.job_title, p.department_id ? departmentMap.get(p.department_id)?.name : null].filter(Boolean).join(" · "),
    }));
  const reviewerOptions = activePeople
    .filter((p) => p.role === "admin" || p.role === "manager" || p.role === "supervisor")
    .map((p) => ({ value: p.id, label: p.full_name, hint: ROLE_LABELS[p.role] }));
  const projectOptions = projects
    .filter((p) => p.status !== "archived" || p.id === form.project_id)
    .filter((p) => admin || !p.department_id || p.department_id === me.department_id || p.id === form.project_id)
    .map((p) => ({ value: p.id, label: p.name, color: p.color }));

  const buildInput = (
    title: string,
    description: string | null,
    opts: { dates: boolean; status?: TaskStatus },
  ): TaskInput => {
    let departmentId = form.department_id;
    if (admin && !departmentId && form.project_id) departmentId = projectMap.get(form.project_id)?.department_id ?? null;
    if (!admin) departmentId = task ? task.department_id : me.department_id;
    const h = Number(form.estimateHours || 0);
    const m = Number(form.estimateMinutes || 0);
    const estimate = opts.dates && h * 60 + m > 0 ? Math.round(h * 60 + m) : null;
    return {
      title,
      description,
      project_id: form.project_id,
      department_id: departmentId,
      status: opts.status ?? form.status,
      priority: form.priority,
      start_date: opts.dates ? form.start_date : null,
      due_date: opts.dates ? form.due_date : null,
      estimate_minutes: estimate,
      reviewer_id: form.reviewer_id,
      day: form.day,
    };
  };

  const submitOne = (keepOpen: boolean) => {
    setError(null);
    if (!form.title.trim()) return setError("اكتب عنوان المهمة");
    if (!form.day) return setError("اختر يوم التنفيذ");
    if (form.start_date && form.due_date && form.due_date < form.start_date) return setError("تاريخ الاستحقاق يجب أن يكون بعد تاريخ البدء");
    if (form.start_date && form.start_date > form.day) return setError("تاريخ البدء يجب أن يكون قبل يوم التنفيذ أو في نفس اليوم");
    if (form.due_date && form.due_date < form.day) return setError("تاريخ الاستحقاق يجب أن يكون بعد يوم التنفيذ أو في نفس اليوم");
    const h = Number(form.estimateHours || 0);
    const m = Number(form.estimateMinutes || 0);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0) return setError("الوقت المقدّر غير صحيح");

    const full = buildInput(form.title.trim(), form.description.trim() || null, { dates: true });
    let input: Partial<TaskInput> = full;
    if (task) {
      input = {};
      (Object.keys(full) as (keyof TaskInput)[]).forEach((k) => {
        if ((full[k] ?? null) !== ((task as any)[k] ?? null)) (input as any)[k] = full[k];
      });
      delete input.status;
    }
    save.mutate(
      { id: task?.id, input, assignees: form.assignees, previousAssignees: (task?.task_assignees ?? []).map((a) => a.user_id) },
      {
        onSuccess: (id) => {
          toast.show(task ? "تم حفظ التعديلات" : "تمت إضافة المهمة");
          if (!task && keepOpen) {
            setForm((f) => ({ ...f, title: "", description: "" }));
            return;
          }
          onClose();
          onSaved?.(id);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  const submitBulk = () => {
    setError(null);
    if (!form.day) return setError("اختر يوم التنفيذ");
    if (!bulkLines.length) return setError("اكتب مهمة واحدة على الأقل، كل مهمة في سطر");
    if (bulkLines.length > 100) return setError("الحد الأقصى 100 مهمة في المرة");
    const rows = bulkLines.map((title) => ({
      input: buildInput(title, null, { dates: false, status: "todo" }),
      assignees: form.assignees,
    }));
    importTasks.mutate(rows, {
      onSuccess: (count) => {
        toast.show(`أُضيفت ${count} مهام`);
        setBulk("");
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  if (!(task ? canEditTaskDetails(me, task) : canCreate)) return null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={task ? "تعديل المهمة" : multi ? "إضافة عدة مهام" : "مهمة جديدة"}
      subtitle={
        task
          ? `#${task.number}`
          : multi
            ? "كل سطر مهمة مستقلة؛ الإسناد واليوم والمشروع تُطبّق على الكل"
            : "حدّد المطلوب ومن ينفّذه وموعد التسليم"
      }
      width={640}
      footer={
        <>
          {multi ? (
            <Button
              title={bulkLines.length ? `إضافة ${bulkLines.length} مهمة` : "إضافة المهام"}
              icon="plus"
              onPress={submitBulk}
              loading={importTasks.isPending}
              disabled={!bulkLines.length}
            />
          ) : (
            <Button title={task ? "حفظ" : "إضافة المهمة"} icon="check" onPress={() => submitOne(false)} loading={save.isPending} />
          )}
          {!task && !multi ? (
            <Button title="إضافة وأخرى" icon="plus-circle" variant="secondary" onPress={() => submitOne(true)} loading={save.isPending} />
          ) : null}
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      {!task ? (
        <Segmented
          size="sm"
          value={multi ? "multi" : "single"}
          onChange={(v) => {
            setMulti(v === "multi");
            setError(null);
          }}
          options={[
            { value: "single", label: "مهمة واحدة", icon: "edit-3" },
            { value: "multi", label: "عدة مهام", icon: "list" },
          ]}
        />
      ) : null}
      {multi ? (
        <>
          <Field label="المهام" hint="كل سطر = مهمة. مثال: 10 أسطر تعني 10 مهام لنفس الموظف." required>
            <Input
              value={bulk}
              onChangeText={setBulk}
              placeholder={"متابعة عملاء الجملة\nتجهيز تقرير المبيعات\nمراجعة حسابات الفرع"}
              multiline
              style={{ minHeight: 190 }}
            />
          </Field>
          {bulkLines.length ? (
            <T className="text-[12.5px]" style={{ color: C.primary }} weight="semibold">
              {`${bulkLines.length} مهمة جاهزة للإضافة`}
            </T>
          ) : null}
        </>
      ) : (
        <>
          <Field label="العنوان" required>
            <Input value={form.title} onChangeText={(v) => set("title", v)} placeholder="مثال: إعداد عرض سعر لعميل جديد" autoFocus={!task} />
          </Field>
          <Field label="الوصف">
            <Input value={form.description} onChangeText={(v) => set("description", v)} placeholder="التفاصيل والمخرجات المطلوبة" multiline />
          </Field>
        </>
      )}
      <Field label="الأولوية">
        <Segmented
          size="sm"
          value={form.priority}
          onChange={(v) => set("priority", v)}
          options={PRIORITY_ORDER.slice().reverse().map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
        />
      </Field>
      <Field label="المسؤولون عن التنفيذ">
        <MultiSelect
          values={form.assignees}
          onChange={(v) =>
            setForm((f) => {
              const next = { ...f, assignees: v };
              // Admin tasks inherit the first assignee's department so that department leads can follow them.
              if (admin && !task && !f.department_id) {
                const dept = v.map((id) => profileMap.get(id)?.department_id).find(Boolean);
                if (dept) next.department_id = dept;
              }
              return next;
            })
          }
          options={assigneeOptions}
          placeholder="اختر موظفًا أو أكثر"
          title="إسناد المهمة"
          renderValue={(sel) => <AvatarStack people={sel.map((s) => ({ id: s.value, full_name: s.label }))} max={5} size={24} />}
        />
      </Field>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Field label="المشروع">
            <Select
              value={form.project_id}
              onChange={(v) =>
                setForm((f) => {
                  const next = { ...f, project_id: v };
                  const projectDept = v ? projectMap.get(v)?.department_id : null;
                  if (admin && !task && !f.department_id && projectDept) next.department_id = projectDept;
                  return next;
                })
              }
              options={projectOptions} noneLabel="بدون مشروع" placeholder="بدون مشروع" title="اختر المشروع" />
          </Field>
        </View>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Field label="القسم" hint={admin ? undefined : "تُنشأ المهام داخل قسمك"}>
            <Select
              value={admin ? form.department_id : task ? task.department_id : me.department_id}
              onChange={(v) => set("department_id", v)}
              options={departments.map((d) => ({ value: d.id, label: d.name, color: d.color }))}
              noneLabel="بدون قسم"
              placeholder="بدون قسم"
              disabled={!admin}
            />
          </Field>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field
            label="يوم التنفيذ"
            hint={
              admin
                ? multi
                  ? "تُسند كل المهام لهذا اليوم"
                  : "تُقفل مهام اليوم تلقائيًا مع نهاية اليوم"
                : "نقل المهام بين الأيام من صلاحيات مدير الشركة"
            }
          >
            {admin ? (
              <DateField value={form.day} onChange={(v) => set("day", v ?? todayISO())} />
            ) : (
              <T style={{ paddingVertical: 11 }}>{form.day ? fmtDayFull(form.day) : "—"}</T>
            )}
          </Field>
        </View>
        {!multi ? (
          <>
            <View style={{ flex: 1, minWidth: 180 }}>
              <Field label="تاريخ البدء">
                <DateField value={form.start_date} onChange={(v) => set("start_date", v)} />
              </Field>
            </View>
            <View style={{ flex: 1, minWidth: 180 }}>
              <Field label="تاريخ الاستحقاق">
                <DateField value={form.due_date} onChange={(v) => set("due_date", v)} />
              </Field>
            </View>
          </>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Field label="المراجع" hint="يعتمد المهمة قبل إغلاقها. بدون مراجع: يراجعها مديرو القسم ومنشئ المهمة.">
            <Select value={form.reviewer_id} onChange={(v) => set("reviewer_id", v)} options={reviewerOptions} noneLabel="بدون مراجع محدد" placeholder="بدون مراجع محدد" title="اختر المراجع" />
          </Field>
        </View>
        {!multi ? (
          <View style={{ flex: 1, minWidth: 220 }}>
            <Field label="الوقت المقدّر">
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Input value={form.estimateHours} onChangeText={(v) => set("estimateHours", v.replace(/[^0-9]/g, ""))} placeholder="0" keyboardType="number-pad" style={{ flex: 1 }} />
                <T className="text-muted">ساعة</T>
                <Input value={form.estimateMinutes} onChangeText={(v) => set("estimateMinutes", v.replace(/[^0-9]/g, ""))} placeholder="0" keyboardType="number-pad" style={{ flex: 1 }} />
                <T className="text-muted">دقيقة</T>
              </View>
            </Field>
          </View>
        ) : null}
      </View>
      {!task && !multi ? (
        <Field label="الحالة الأولية">
          <Segmented
            size="sm"
            value={form.status}
            onChange={(v) => set("status", v)}
            options={(["todo", "in_progress", "blocked"] as TaskStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
        </Field>
      ) : null}
      <ErrorBox message={error} />
    </Sheet>
  );
}
