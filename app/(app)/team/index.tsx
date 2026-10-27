import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { AddMemberSheet, ApproveSheet } from "@/components/madar/member-forms";
import { SendMessageSheet } from "@/components/madar/message-form";
import { Page } from "@/components/madar/shell";
import { Avatar, Button, C, Card, Chip, EmptyState, IconButton, Input, Loading, Pill, SearchInput, SectionLabel, T, Tap, alpha, confirmAction, useIsWide, useToast } from "@/components/madar/ui";
import { fmtRelative, isOverdue } from "@/lib/madar/format";
import { MEMBER_STATUS_LABELS, ROLE_LABELS, ROLE_ORDER } from "@/lib/madar/labels";
import { copyText, joinUrl } from "@/lib/madar/links";
import { canManageMembers, isAdmin } from "@/lib/madar/permissions";
import { useInvitationActions, useInvitations, useLookups, useProfiles, useTasks, useUpdateProfile } from "@/lib/madar/queries";
import { useMe, useSession } from "@/lib/madar/session";
import type { Profile, Role } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

export default function TeamScreen() {
  const me = useMe();
  const router = useRouter();
  const admin = isAdmin(me);
  const profilesQuery = useProfiles();
  const { departments, departmentMap } = useLookups();
  const tasks = useTasks();
  const invitations = useInvitations(canManageMembers(me));
  const { remove: removeInvite } = useInvitationActions();
  const update = useUpdateProfile();
  const toast = useToast();
  const wide = useIsWide(760);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState<Profile | null>(null);
  const [messaging, setMessaging] = useState<Profile | null>(null);

  const all = profilesQuery.data ?? [];
  const pending = all.filter((p) => p.status === "pending");
  const members = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((p) => p.status !== "pending")
      .filter((p) => showDisabled || p.status === "active")
      .filter((p) => !dept || p.department_id === dept)
      .filter((p) => !role || p.role === role)
      .filter((p) => !term || `${p.full_name} ${p.email} ${p.job_title ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.full_name.localeCompare(b.full_name, "ar"));
  }, [all, q, dept, role, showDisabled]);

  const openTasks = (id: string) => (tasks.data ?? []).filter((t) => t.status !== "done" && t.task_assignees?.some((a) => a.user_id === id));
  const pendingInvites = (invitations.data ?? []).filter((i) => !i.accepted_at);
  const disabledCount = all.filter((p) => p.status === "disabled").length;

  return (
    <Page
      title="الفريق"
      subtitle={`${all.filter((p) => p.status === "active").length} عضو نشط`}
      actions={canManageMembers(me) ? <Button title="إضافة موظف" icon="user-plus" onPress={() => setAdding(true)} /> : null}
    >
      {admin && pending.length ? (
        <Card style={{ gap: 10, marginBottom: 16, borderColor: alpha(C.warning, 40), backgroundColor: C["warning-soft"] }}>
          <SectionLabel>طلبات الانضمام · {pending.length}</SectionLabel>
          {pending.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 14, padding: 10, flexWrap: "wrap" }}>
              <Avatar id={p.id} name={p.full_name} size={36} />
              <View style={{ flex: 1, minWidth: 160 }}>
                <T weight="semibold">{p.full_name}</T>
                <T className="text-[12px] text-muted">
                  {p.email} · {fmtRelative(p.created_at)}
                </T>
              </View>
              <Button title="مراجعة وتفعيل" icon="check" size="sm" onPress={() => setApproving(p)} />
              <Button
                title="رفض"
                variant="danger"
                size="sm"
                onPress={async () => {
                  if (!(await confirmAction(`رفض طلب ${p.full_name}؟ سيُوقف الحساب.`, "رفض"))) return;
                  update.mutate({ id: p.id, patch: { status: "disabled" } }, { onError: (e) => toast.show(errorMessage(e), "error") });
                }}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {admin ? <InviteLinkCard /> : null}

      <View style={{ gap: 10, marginBottom: 16 }}>
        <SearchInput value={q} onChangeText={setQ} placeholder="ابحث بالاسم أو البريد أو المسمى…" />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label="كل الأقسام" active={!dept} onPress={() => setDept(null)} />
          {departments.map((d) => (
            <Chip key={d.id} label={d.name} color={d.color} active={dept === d.id} onPress={() => setDept(dept === d.id ? null : d.id)} />
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label="كل الأدوار" active={!role} onPress={() => setRole(null)} />
          {ROLE_ORDER.map((r) => (
            <Chip key={r} label={ROLE_LABELS[r]} active={role === r} onPress={() => setRole(role === r ? null : r)} />
          ))}
          {disabledCount ? <Chip label={`الموقوفون (${disabledCount})`} icon="user-x" active={showDisabled} onPress={() => setShowDisabled(!showDisabled)} /> : null}
        </View>
      </View>

      {profilesQuery.isLoading ? (
        <Loading />
      ) : members.length === 0 ? (
        <EmptyState icon="users" title="لا يوجد أعضاء مطابقون" hint={canManageMembers(me) ? "أضف موظفين ليبدأ إسناد المهام لهم." : undefined} />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {members.map((p) => {
            const open = openTasks(p.id);
            const late = open.filter((t) => isOverdue(t)).length;
            const d = p.department_id ? departmentMap.get(p.department_id) : null;
            return (
              <View
                key={p.id}
                style={{
                  flexBasis: wide ? 300 : "100%",
                  flexGrow: 1,
                  maxWidth: wide ? 420 : undefined,
                  backgroundColor: C.surface,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: C.border,
                  padding: 14,
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "center",
                  opacity: p.status === "disabled" ? 0.6 : 1,
                }}
              >
                <Tap
                  onPress={() => router.push(`/team/${p.id}` as any)}
                  style={{ flex: 1, flexDirection: "row", gap: 12, alignItems: "center" }}
                >
                  <Avatar id={p.id} name={p.full_name} size={46} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <T weight="bold" numberOfLines={1}>
                      {p.full_name}
                      {p.id === me.id ? <T className="text-[12px] text-muted"> (أنت)</T> : null}
                    </T>
                    <T className="text-[12px] text-muted" numberOfLines={1}>
                      {[p.job_title, d?.name].filter(Boolean).join(" · ") || "—"}
                    </T>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      <Pill label={ROLE_LABELS[p.role]} tone={p.role === "admin" ? "primary" : p.role === "manager" ? "info" : p.role === "supervisor" ? "warning" : "neutral"} />
                      {p.status === "disabled" ? <Pill label={MEMBER_STATUS_LABELS.disabled} tone="error" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: "center", minWidth: 50 }}>
                    <T weight="bold" style={{ fontSize: 20, lineHeight: 28 }}>
                      {open.length}
                    </T>
                    <T className="text-[10.5px] text-muted">مفتوحة</T>
                    {late ? (
                      <T weight="semibold" className="text-[10.5px]" style={{ color: C.error }}>
                        {late} متأخرة
                      </T>
                    ) : null}
                  </View>
                </Tap>
                {admin && p.id !== me.id ? (
                  <IconButton
                    icon="message-circle"
                    label={`إرسال رسالة إلى ${p.full_name}`}
                    color={C.muted}
                    onPress={() => setMessaging(p)}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {canManageMembers(me) && pendingInvites.length ? (
        <Card style={{ gap: 8, marginTop: 20 }}>
          <SectionLabel>تصاريح تسجيل لم تُستخدم بعد</SectionLabel>
          <T className="text-[12px] text-muted">يُفعّل صاحب البريد تلقائيًا بالدور المحدد عندما يسجّل من صفحة الدخول.</T>
          {pendingInvites.map((i) => (
            <View key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.border }}>
              <View style={{ flex: 1 }}>
                <T weight="semibold" className="text-[13px]">
                  {i.full_name || i.email}
                </T>
                <T className="text-[12px] text-muted">
                  {i.email} · {ROLE_LABELS[i.role]}
                  {i.department_id && departmentMap.get(i.department_id) ? ` · ${departmentMap.get(i.department_id)!.name}` : ""}
                </T>
              </View>
              <IconButton
                icon="x"
                color={C.muted}
                label="إلغاء التصريح"
                onPress={async () => {
                  if (await confirmAction(`إلغاء تصريح ${i.email}؟`, "إلغاء التصريح")) removeInvite.mutate(i.id, { onError: (e) => toast.show(errorMessage(e), "error") });
                }}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <AddMemberSheet visible={adding} onClose={() => setAdding(false)} />
      <ApproveSheet visible={!!approving} onClose={() => setApproving(null)} member={approving} />
      {admin ? <SendMessageSheet visible={!!messaging} onClose={() => setMessaging(null)} member={messaging} /> : null}
    </Page>
  );
}

function InviteLinkCard() {
  const { company } = useSession();
  const toast = useToast();
  if (!company) return null;
  const url = joinUrl(company.join_code);
  return (
    <Card style={{ gap: 10, marginBottom: 16 }}>
      <SectionLabel>رابط دعوة الموظفين</SectionLabel>
      <T className="text-[12.5px] text-muted">
        شارك هذا الرابط مع موظفيك: يفتح صفحة باسم الشركة، يسجّل الموظف بنفسه، ثم توافق على حسابه من طلبات الانضمام هنا.
      </T>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Input value={url} editable={false} style={{ textAlign: "left", writingDirection: "ltr", fontSize: 12.5 }} />
        </View>
        <Button
          title="نسخ الرابط"
          icon="copy"
          size="sm"
          onPress={async () => {
            try {
              await copyText(url);
              toast.show("تم نسخ رابط الدعوة");
            } catch {
              toast.show("تعذّر نسخ الرابط", "error");
            }
          }}
        />
      </View>
      <T className="text-[11.5px] text-muted">كود الدعوة: {company.join_code}</T>
    </Card>
  );
}
