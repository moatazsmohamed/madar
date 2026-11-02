import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Page } from "@/components/madar/shell";
import { DecideEntrySheet, EntryRow, GrantSheet, SignedPoints, Stat } from "@/components/madar/points-views";
import {
  Avatar,
  Button,
  C,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  InfoBox,
  Input,
  Loading,
  Pill,
  Row,
  SearchInput,
  SectionLabel,
  Select,
  Sheet,
  T,
  Tap,
  confirmAction,
  useToast,
} from "@/components/madar/ui";
import { exportCSV, toCSV } from "@/lib/madar/csv";
import { fmtDateTime, fmtDay, isoDateInTz } from "@/lib/madar/format";
import {
  POINT_ENTRY_STATUS_LABELS,
  POINT_KIND_LABELS,
  POINT_SOURCE_LABELS,
  ROLE_LABELS,
} from "@/lib/madar/labels";
import { filterBalances, pointsLabel } from "@/lib/madar/points";
import { canExpirePoints, canManagePoints, canManagePointsSettings, canSeePoints } from "@/lib/madar/permissions";
import {
  useCorrectPointEntry,
  useExpirePoints,
  useLookups,
  useMyPoints,
  usePointBalances,
  usePointEntries,
  usePointRules,
  usePointSettings,
} from "@/lib/madar/queries";
import { useMe } from "@/lib/madar/session";
import type { PointEntry, PointSettings, Profile } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

const NO_DEPARTMENT = "بلا قسم";

export default function ManagePointsScreen() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const settings = usePointSettings();
  const rules = usePointRules();
  const balances = usePointBalances();
  const queue = usePointEntries({ status: "pending" });
  const mine = useMyPoints();
  const expire = useExpirePoints();
  const { profiles, departments, departmentMap, profileMap } = useLookups();

  const [search, setSearch] = useState("");
  const [deptId, setDeptId] = useState<string | null>(null);
  const [granting, setGranting] = useState<{ open: boolean; memberId: string | null }>({ open: false, memberId: null });
  const [reviewing, setReviewing] = useState<PointEntry | null>(null);
  const [historyOf, setHistoryOf] = useState<Profile | null>(null);

  const live = settings.data ?? null;
  const manual = (rules.data ?? []).find((r) => r.event_key === "manual" && r.enabled);
  const manageable = useMemo(() => profiles.filter((p) => canManagePoints(me, p)), [profiles, me]);

  const pendingQueue = useMemo(
    () => (queue.data ?? []).filter((e) => !profileMap.has(e.member_id) || canManagePoints(me, profileMap.get(e.member_id)!)),
    [queue.data, profileMap, me],
  );

  const rows = useMemo(() => filterBalances(balances.data ?? [], { departmentId: deptId, search }), [balances.data, deptId, search]);
  const totals = useMemo(
    () => ({
      balance: rows.reduce((s, r) => s + r.balance, 0),
      pending: rows.reduce((s, r) => s + r.pending, 0),
      entries: rows.reduce((s, r) => s + r.entries, 0),
    }),
    [rows],
  );

  const exportBalances = () => {
    if (!rows.length) return toast.show("لا صفّ للتصدير", "error");
    exportCSV(
      `madar-points-${isoDateInTz(new Date())}.csv`,
      toCSV(
        ["العضو", "الدور", "القسم", "الرصيد", "معلّق", "عدد الحركات"],
        rows.map((r) => [
          r.full_name,
          ROLE_LABELS[r.role],
          r.department_id ? departmentMap.get(r.department_id)?.name ?? NO_DEPARTMENT : NO_DEPARTMENT,
          r.balance,
          r.pending,
          r.entries,
        ]),
      ),
    );
    toast.show("صُدّرت الأرصدة");
  };

  const runExpiry = async () => {
    if (!(await confirmAction("إسقاط النقاط المنتهية الآن؟ تُكتب حركة إسقاط لكل رصيد منتهي.", "تشغيل"))) return;
    expire.mutate(undefined, {
      onSuccess: (n) => toast.show(n ? `أُسقطت النقاط في ${n} حركة منتهية` : "لا نقاط منتهية"),
      onError: (e) => toast.show(errorMessage(e), "error"),
    });
  };

  if (!settings.isLoading && !canSeePoints(me, live)) {
    return (
      <Page title="إدارة النقاط" maxWidth={900}>
        <EmptyState icon="award" title="النقاط غير مفعّلة" hint="يفعّلها مدير الشركة من إعدادات النقاط أولًا." />
      </Page>
    );
  }

  const loading = settings.isLoading || balances.isLoading || queue.isLoading;

  return (
    <Page
      title="إدارة النقاط"
      subtitle={live ? `${live.require_approval ? "كل حركة تحتاج موافقة" : "الحركات تُعتمد فورًا"} · وحدتها ${live.unit_label}` : "لم تُضبط إعدادات النقاط بعد"}
      back={() => router.push("/points" as any)}
      actions={
        <>
          <Button title="منح نقاط" icon="plus" size="sm" onPress={() => setGranting({ open: true, memberId: null })} disabled={!manageable.length} />
          <Button title="تصدير الأرصدة" icon="download" variant="secondary" size="sm" onPress={exportBalances} />
          {canManagePointsSettings(me) ? (
            <Button title="الإعدادات" icon="settings" variant="ghost" size="sm" onPress={() => router.push("/points/settings" as any)} />
          ) : null}
          {canManagePointsSettings(me) ? (
            <Button title="المكافآت" icon="gift" variant="ghost" size="sm" onPress={() => router.push("/points/rewards" as any)} />
          ) : null}
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <View style={{ gap: 16 }}>
          <Card style={{ gap: 14 }}>
            <Row style={{ flexWrap: "wrap", gap: 16 }}>
              <Stat label="أرصدة معتمدة" value={totals.balance} unit={live?.unit_label} color={C.primary} hint={`${rows.length} عضو`} />
              <Stat
                label="بانتظار الموافقة"
                value={totals.pending}
                unit={live?.unit_label}
                color={totals.pending ? C.warning : undefined}
                hint={`${pendingQueue.length} حركة معلّقة`}
              />
              <Stat label="حركات السجل" value={totals.entries} hint="منذ تشغيل النظام" />
            </Row>
            <T className="text-[11.5px] text-muted">
              {`رصيدك ${mine.data ? pointsLabel(mine.data.balance, live) : "—"}. لا تظهر هنا إلا الأرصدة التي تسمح بها صلاحياتك.`}
            </T>
          </Card>

          <Card style={{ gap: 10 }}>
            <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <SectionLabel>{`بانتظار الموافقة (${pendingQueue.length})`}</SectionLabel>
              {canExpirePoints(me) ? (
                <Button title="إسقاط المنتهي" icon="clock" variant="ghost" size="sm" loading={expire.isPending} onPress={runExpiry} />
              ) : null}
            </Row>
            {pendingQueue.length === 0 ? (
              <EmptyState icon="check-circle" title="لا طلبات معلّقة" hint="تصل هنا طلبات الأعضاء والمنح التي تحتاج موافقة." />
            ) : (
              pendingQueue.map((e, i) => (
                <View key={e.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                  <EntryRow entry={e} settings={live} who={profileMap.get(e.member_id) ?? null} right={<Button title="مراجعة" icon="check" size="sm" onPress={() => setReviewing(e)} />} />
                </View>
              ))
            )}
          </Card>

          <Card style={{ gap: 12 }}>
            <SectionLabel>أرصدة الفريق</SectionLabel>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <SearchInput value={search} onChangeText={setSearch} placeholder="ابحث باسم العضو…" />
              </View>
              <View style={{ minWidth: 190, flex: 1, maxWidth: 280 }}>
                <Select
                  value={deptId}
                  onChange={setDeptId}
                  options={departments.map((d) => ({ value: d.id, label: d.name, color: d.color }))}
                  noneLabel="كل الأقسام"
                  placeholder="كل الأقسام"
                  title="القسم"
                />
              </View>
            </View>
            {rows.length === 0 ? (
              <EmptyState icon="users" title="لا أحد مطابق" hint="جرّب اسمًا آخر أو أزل فلتر القسم." />
            ) : (
              <View>
                <Row style={{ gap: 10, paddingVertical: 6 }}>
                  <T weight="semibold" className="flex-1 text-[11.5px] text-muted">
                    العضو
                  </T>
                  <T weight="semibold" className="text-[11.5px] text-muted" style={{ width: 80, textAlign: "center" }}>
                    الرصيد
                  </T>
                  <T weight="semibold" className="text-[11.5px] text-muted" style={{ width: 68, textAlign: "center" }}>
                    معلّق
                  </T>
                  <T weight="semibold" className="text-[11.5px] text-muted" style={{ width: 58, textAlign: "center" }}>
                    حركات
                  </T>
                </Row>
                {rows.map((r) => {
                  const profile = profileMap.get(r.member_id);
                  return (
                    <Tap key={r.member_id} onPress={() => profile && setHistoryOf(profile)} style={{ borderTopWidth: 1, borderTopColor: C.border }}>
                      <Row style={{ gap: 10, paddingVertical: 10 }}>
                        <Avatar id={r.member_id} name={r.full_name} size={32} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <T weight="medium" numberOfLines={1}>
                            {r.full_name}
                          </T>
                          <T className="text-[11.5px] text-muted" numberOfLines={1}>
                            {`${r.department_id ? departmentMap.get(r.department_id)?.name ?? NO_DEPARTMENT : NO_DEPARTMENT} · ${ROLE_LABELS[r.role]}`}
                          </T>
                        </View>
                        <T weight="bold" style={{ width: 80, textAlign: "center", fontVariant: ["tabular-nums"], color: r.balance < 0 ? C.error : C.foreground }}>
                          {r.balance}
                        </T>
                        <T style={{ width: 68, textAlign: "center", fontVariant: ["tabular-nums"], color: r.pending ? C.warning : C.muted }}>
                          {r.pending || "—"}
                        </T>
                        <T className="text-[12px] text-muted" style={{ width: 58, textAlign: "center" }}>
                          {r.entries}
                        </T>
                      </Row>
                    </Tap>
                  );
                })}
              </View>
            )}
            <InfoBox tone="info" icon="info">
              كل كتابة تمر بدوال الخادم: لا يُعدَّل ولا يُمحى أي حركة قديمة، والتصحيح حركة معاكسة موثّقة بسببها.
            </InfoBox>
          </Card>
        </View>
      )}

      <GrantSheet
        visible={granting.open}
        onClose={() => setGranting({ open: false, memberId: null })}
        settings={live}
        members={manageable}
        initialMemberId={granting.memberId}
        defaultPoints={manual?.points ?? null}
      />
      <DecideEntrySheet
        visible={!!reviewing}
        onClose={() => setReviewing(null)}
        entry={reviewing}
        settings={live}
        member={reviewing ? profileMap.get(reviewing.member_id) ?? null : null}
      />
      <HistorySheet
        visible={!!historyOf}
        onClose={() => setHistoryOf(null)}
        member={historyOf}
        settings={live}
        onGrant={(id) => {
          setHistoryOf(null);
          setGranting({ open: true, memberId: id });
        }}
      />
    </Page>
  );
}

/** One member's ledger, with the correction path that never rewrites history. */
function HistorySheet({
  visible,
  onClose,
  member,
  settings,
  onGrant,
}: {
  visible: boolean;
  onClose: () => void;
  member: Profile | null;
  settings: PointSettings | null;
  onGrant: (memberId: string) => void;
}) {
  const entries = usePointEntries({ member: member?.id ?? null }, visible && !!member);
  const [correcting, setCorrecting] = useState<PointEntry | null>(null);

  useEffect(() => {
    if (!visible) setCorrecting(null);
  }, [visible]);

  if (!member) return null;

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title={`سجل ${member.full_name}`}
        subtitle={ROLE_LABELS[member.role]}
        footer={<Button title="منح نقاط" icon="plus" onPress={() => onGrant(member.id)} />}
      >
        {entries.isLoading ? (
          <Loading />
        ) : (entries.data ?? []).length === 0 ? (
          <EmptyState icon="award" title="لا حركات" hint="لم تُسجَّل نقاط لهذا العضو بعد." />
        ) : (
          <View>
            {(entries.data ?? []).map((e, i) => (
              <View key={e.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                <EntryRow
                  entry={e}
                  settings={settings}
                  right={
                    e.status === "approved" && e.kind !== "redeem" && e.kind !== "expire" ? (
                      <Button title="تصحيح" icon="corner-up-left" variant="ghost" size="sm" onPress={() => setCorrecting(e)} />
                    ) : null
                  }
                />
              </View>
            ))}
          </View>
        )}
      </Sheet>
      <CorrectSheet visible={!!correcting} onClose={() => setCorrecting(null)} entry={correcting} settings={settings} />
    </>
  );
}

/** A correction writes a new reverse row; the original stays untouched. */
function CorrectSheet({
  visible,
  onClose,
  entry,
  settings,
}: {
  visible: boolean;
  onClose: () => void;
  entry: PointEntry | null;
  settings: PointSettings | null;
}) {
  const correct = useCorrectPointEntry();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setNote("");
      setError(null);
    }
  }, [visible]);

  if (!entry) return null;

  const submit = () => {
    setError(null);
    if (!note.trim()) return setError("اكتب سبب التصحيح — يظهر في السجل مع الحركة المعاكسة");
    correct.mutate(
      { id: entry.id, note: note.trim() },
      {
        onSuccess: () => {
          toast.show(`أُضيفت حركة معاكسة ${pointsLabel(-entry.points, settings)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="تصحيح حركة"
      subtitle={`${POINT_KIND_LABELS[entry.kind]} · ${POINT_SOURCE_LABELS[entry.source]} · ${fmtDay(isoDateInTz(new Date(entry.created_at)))}`}
      footer={
        <>
          <Button title="حفظ التصحيح" icon="corner-up-left" onPress={submit} loading={correct.isPending} />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Card style={{ gap: 8 }}>
        <Row style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            <T weight="medium">{entry.reason}</T>
            <T className="text-[11.5px] text-muted">{fmtDateTime(entry.created_at)}</T>
          </View>
          <SignedPoints value={entry.points} settings={settings} />
        </Row>
        <Pill label={POINT_ENTRY_STATUS_LABELS[entry.status]} tone="success" />
      </Card>
      <InfoBox tone="warning" icon="alert-triangle">
        لا تُمحى الحركة الأصلية: تُكتب حركة معاكسة بنفس القيمة وموثّقة بسببك، ويظل السجل كما هو.
      </InfoBox>
      <Field label="سبب التصحيح" required hint="لا يمكن أن يكون فارغًا.">
        <Input
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={300}
          placeholder="مثال: مُنحت النقاط مرتين بالخطأ"
          style={{ minHeight: 90, textAlignVertical: "top" }}
        />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
}
