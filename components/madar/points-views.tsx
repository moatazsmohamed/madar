// Shared pieces for the points screens: one row shape for the ledger, one sheet per decision,
// and the two forms that write a pending or settled movement.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { fmtDay, fmtRelative, isoDateInTz } from "@/lib/madar/format";
import {
  POINT_ENTRY_STATUS_LABELS,
  POINT_ENTRY_STATUS_TONE,
  POINT_KIND_LABELS,
  POINT_SOURCE_LABELS,
  REDEMPTION_STATUS_LABELS,
  REDEMPTION_STATUS_TONE,
} from "@/lib/madar/labels";
import { dedupeToken, pointsLabel } from "@/lib/madar/points";
import { useDecidePointEntry, useGrantPoints, useRequestPoints } from "@/lib/madar/queries";
import type { MyPoints, PointEntry, PointSettings, Profile, Redemption } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";
import {
  Avatar,
  Button,
  C,
  Card,
  ErrorBox,
  Field,
  Icon,
  InfoBox,
  Input,
  Pill,
  SectionLabel,
  Select,
  Segmented,
  Sheet,
  T,
  Tap,
  alpha,
  toneColor,
  useToast,
  type IconName,
} from "./ui";

const REASON_MAX = 300;
const NOTE_MAX = 500;

/** A signed amount in the company's own unit wording. */
export function SignedPoints({
  value,
  settings,
  size = 15,
}: {
  value: number;
  settings: Pick<PointSettings, "unit_label"> | null;
  size?: number;
}) {
  return (
    <T
      weight="bold"
      style={{ color: value > 0 ? C.success : value < 0 ? C.error : C.muted, fontSize: size, fontVariant: ["tabular-nums"] }}
    >
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {pointsLabel(Math.abs(value), settings)}
    </T>
  );
}

export function EntryRow({
  entry,
  settings,
  who,
  onPress,
  right,
}: {
  entry: PointEntry;
  settings: PointSettings | null;
  who?: { id: string; full_name: string } | null;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const gain = entry.points > 0;
  const icon: IconName = entry.kind === "redeem" ? "gift" : entry.kind === "expire" ? "clock" : gain ? "arrow-up" : "arrow-down";
  const color = toneColor(entry.status === "pending" ? "warning" : entry.status === "approved" ? gain ? "success" : "neutral" : "error");
  const meta = [
    POINT_KIND_LABELS[entry.kind],
    POINT_SOURCE_LABELS[entry.source],
    entry.task_id ? "مهمة" : null,
    fmtRelative(entry.created_at),
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          backgroundColor: entry.status === "approved" && gain ? alpha(C.success, 12) : C.sand,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={15} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 120, gap: 2 }}>
        <T weight="medium" numberOfLines={1}>
          {entry.reason}
        </T>
        <T className="text-[11.5px] text-muted" numberOfLines={1}>
          {who ? `${who.full_name} · ` : ""}
          {meta}
        </T>
        {entry.status === "approved" && entry.expires_at ? (
          <T className="text-[11px]" style={{ color: C.warning }}>
            تنتهي صلاحيتها {fmtDay(isoDateInTz(new Date(entry.expires_at)))}
          </T>
        ) : null}
        {entry.status === "rejected" && entry.reject_note ? (
          <T className="text-[11.5px]" style={{ color: C.error }} numberOfLines={2}>
            سبب الرفض: {entry.reject_note}
          </T>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <SignedPoints value={entry.points} settings={settings} />
        {entry.status !== "approved" ? (
          <Pill label={POINT_ENTRY_STATUS_LABELS[entry.status]} tone={POINT_ENTRY_STATUS_TONE[entry.status]} />
        ) : null}
      </View>
      {right ? <View style={{ gap: 6, alignItems: "flex-end" }}>{right}</View> : null}
    </View>
  );

  return onPress ? (
    <Tap onPress={onPress} style={{ paddingVertical: 9 }}>
      {body}
    </Tap>
  ) : (
    <View style={{ paddingVertical: 9 }}>{body}</View>
  );
}

export function RedemptionRow({
  redemption,
  rewardName,
  who,
  right,
}: {
  redemption: Redemption;
  rewardName: string;
  who?: { id: string; full_name: string } | null;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: C["primary-soft"], alignItems: "center", justifyContent: "center" }}>
        <Icon name="gift" size={15} color={C.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 120, gap: 2 }}>
        <T weight="medium" numberOfLines={1}>
          {rewardName}
        </T>
        <T className="text-[11.5px] text-muted" numberOfLines={1}>
          {who ? `${who.full_name} · ` : ""}
          {fmtRelative(redemption.created_at)}
        </T>
        {redemption.note ? (
          <T className="text-[11.5px] text-muted" numberOfLines={2}>
            {redemption.note}
          </T>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <T weight="bold" className="text-[13px]" style={{ color: C.error, fontVariant: ["tabular-nums"] }}>
          −{redemption.points_spent}
        </T>
        <Pill label={REDEMPTION_STATUS_LABELS[redemption.status]} tone={REDEMPTION_STATUS_TONE[redemption.status]} />
      </View>
      {right ? <View style={{ gap: 6, alignItems: "flex-end" }}>{right}</View> : null}
    </View>
  );
}

/** One headline figure. Used by the standing card and the company report. */
export function Stat({
  label,
  value,
  unit,
  hint,
  color = C.foreground,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  color?: string;
}) {
  return (
    <View style={{ flex: 1, minWidth: 130, gap: 3 }}>
      <SectionLabel>{label}</SectionLabel>
      <T weight="bold" style={{ fontSize: 24, color, fontVariant: ["tabular-nums"], lineHeight: 32 }}>
        {value}
        {unit ? <T weight="medium" style={{ fontSize: 13, color: C.muted }}> {unit}</T> : null}
      </T>
      {hint ? <T className="text-[11.5px] text-muted">{hint}</T> : null}
    </View>
  );
}

/** The member's own standing, straight from my_points(). */
export function StandingCard({ points, settings }: { points: MyPoints | undefined; settings: PointSettings | null }) {
  const unit = settings?.unit_label ?? "نقطة";
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
        <Stat label="الرصيد المعتمد" value={points?.balance ?? 0} unit={unit} color={C.primary} />
        <Stat label="متاح للاستبدال" value={points?.available ?? 0} unit={unit} hint={points?.expires_on ? `أقرب انتهاء ${fmtDay(isoDateInTz(new Date(points.expires_on)))}` : "بلا صلاحية محددة"} />
        <Stat label="بانتظار الموافقة" value={points?.pending ?? 0} unit={unit} color={points?.pending ? C.warning : undefined} />
      </View>
      {(points?.balance ?? 0) < 0 ? (
        <InfoBox tone="warning" icon="alert-triangle">
          رصيدك بالسالب بعد حركة تسوية. راجع مدير الشركة قبل أي استبدال.
        </InfoBox>
      ) : null}
    </Card>
  );
}

/** Approve or send back a pending movement; the note travels with the rejection only. */
export function DecideEntrySheet({
  visible,
  onClose,
  entry,
  settings,
  member,
}: {
  visible: boolean;
  onClose: () => void;
  entry: PointEntry | null;
  settings: PointSettings | null;
  member?: Profile | null;
}) {
  const decide = useDecidePointEntry();
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

  const run = (approve: boolean) => {
    setError(null);
    if (!approve && note.trim().length > NOTE_MAX) return setError(`الملاحظة أطول من ${NOTE_MAX} حرف`);
    decide.mutate(
      { id: entry.id, approve, note: approve ? null : note.trim() || null },
      {
        onSuccess: () => {
          toast.show(approve ? "تم اعتماد الحركة" : "تم رفض الحركة");
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
      title={entry.points > 0 ? "مراجعة حركة نقاط" : "مراجعة حركة خصم"}
      subtitle={member ? `${member.full_name} · ${entry.reason}` : entry.reason}
      footer={
        <>
          <Button title="اعتماد" icon="check" onPress={() => run(true)} loading={decide.isPending} />
          <Button title="رفض" icon="x-circle" variant="danger" onPress={() => run(false)} loading={decide.isPending} />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {member ? <Avatar id={member.id} name={member.full_name} size={36} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="semibold">{entry.reason}</T>
            <T className="text-[12px] text-muted">
              {POINT_KIND_LABELS[entry.kind]} · {POINT_SOURCE_LABELS[entry.source]} · {fmtDay(isoDateInTz(new Date(entry.created_at)))}
            </T>
          </View>
          <SignedPoints value={entry.points} settings={settings} size={17} />
        </View>
      </Card>
      <Field label="ملاحظة الرفض" hint="تظهر للعضو في إشعاراته مع الطلب المرفوض، ولا تُحفظ عند الاعتماد.">
        <Input
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={NOTE_MAX}
          placeholder="اكتب سبب الرفض أو ما المطلوب…"
          style={{ minHeight: 100, textAlignVertical: "top" }}
        />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
}

/** Grant or deduct for a member the caller manages. One token per sheet, so a double click replays. */
export function GrantSheet({
  visible,
  onClose,
  settings,
  members,
  initialMemberId,
  defaultPoints,
}: {
  visible: boolean;
  onClose: () => void;
  settings: PointSettings | null;
  members: Profile[];
  initialMemberId?: string | null;
  defaultPoints?: number | null;
}) {
  const grant = useGrantPoints();
  const toast = useToast();
  const [memberId, setMemberId] = useState<string | null>(initialMemberId ?? null);
  const [mode, setMode] = useState<"add" | "deduct">("add");
  const [amount, setAmount] = useState("");
  const [useRule, setUseRule] = useState(false);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => dedupeToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMemberId(initialMemberId ?? null);
      setMode("add");
      setAmount(defaultPoints ? String(defaultPoints) : "");
      setUseRule(!defaultPoints);
      setReason("");
      setRequestId(dedupeToken());
      setError(null);
    }
  }, [visible, initialMemberId, defaultPoints]);

  const target = members.find((m) => m.id === memberId) ?? null;

  const submit = () => {
    setError(null);
    if (!memberId || !target) return setError("اختر العضو أولاً");
    if (!reason.trim()) return setError("اكتب سبب الحركة");
    if (reason.trim().length > REASON_MAX) return setError(`السبب أطول من ${REASON_MAX} حرف`);
    const value = Number(amount || 0);
    if (!useRule && (!amount || !Number.isFinite(value) || value <= 0)) return setError("اكتب عددًا صحيحًا أكبر من صفر");
    if (useRule && !defaultPoints) return setError("لا توجد قاعدة منح مباشر، حدّد النقاط بنفسك");
    grant.mutate(
      {
        member: memberId,
        points: useRule ? null : mode === "add" ? Math.round(value) : -Math.round(value),
        reason: reason.trim(),
        requestId,
      },
      {
        onSuccess: (row) => {
          toast.show(row.status === "pending" ? "الحركة معلّقة بانتظار الموافقة" : `سُجّلت الحركة لـ ${target.full_name}`);
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
      title="منح أو خصم نقاط"
      subtitle="مع طلب الموافقة في الإعدادات تُسجَّل الإضافة معلّقة حتى تُعتمد، أما الخصم فتسوية مباشرة."
      footer={
        <>
          <Button title="حفظ الحركة" icon="check" onPress={submit} loading={grant.isPending} />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Field label="العضو" required>
        <Select
          value={memberId}
          onChange={setMemberId}
          options={members.map((m) => ({ value: m.id, label: m.full_name, hint: m.job_title ?? undefined }))}
          placeholder="اختر عضوًا"
          title="العضو"
        />
      </Field>
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          if (m === "deduct") setUseRule(false);
        }}
        options={[
          { value: "add", label: "إضافة نقاط", icon: "arrow-up" },
          { value: "deduct", label: "خصم نقاط", icon: "arrow-down" },
        ]}
      />
      <Field label="عدد النقاط" required hint={defaultPoints ? `قاعدة المنح المباشر = ${defaultPoints}` : "لا توجد قاعدة منح مباشر بعد."}>
        <View style={{ gap: 8 }}>
          <Input
            value={amount}
            onChangeText={(v) => {
              setAmount(v.replace(/[^0-9]/g, ""));
              setUseRule(false);
            }}
            keyboardType="number-pad"
            placeholder={defaultPoints ? String(defaultPoints) : "0"}
            editable={!useRule}
          />
          {defaultPoints ? (
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pill label={`استخدم ${defaultPoints} من القاعدة`} tone={useRule ? "primary" : "neutral"} icon={useRule ? "check" : undefined} />
              <Button
                title={useRule ? "تحديد يدوي" : "اتركه للقاعدة"}
                variant="ghost"
                size="sm"
                onPress={() => {
                  setUseRule(!useRule);
                  if (!useRule) setMode("add");
                  setError(null);
                }}
              />
            </View>
          ) : null}
        </View>
      </Field>
      <Field label="السبب" required hint="يظهر للعضو في سجل نقاطه.">
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={REASON_MAX}
          placeholder="مثال: إنجاز عرض العملاء قبل الموعد"
          style={{ minHeight: 84, textAlignVertical: "top" }}
        />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
}

/** The member's own ask: it always lands as a pending movement. */
export function RequestPointsSheet({
  visible,
  onClose,
  settings,
  defaultPoints,
}: {
  visible: boolean;
  onClose: () => void;
  settings: PointSettings | null;
  defaultPoints?: number | null;
}) {
  const request = useRequestPoints();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => dedupeToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setAmount(defaultPoints ? String(defaultPoints) : "");
      setReason("");
      setRequestId(dedupeToken());
      setError(null);
    }
  }, [visible, defaultPoints]);

  const submit = () => {
    setError(null);
    const value = Number(amount || 0);
    if (!amount || !Number.isFinite(value) || value <= 0) return setError("اكتب عددًا صحيحًا أكبر من صفر");
    if (!reason.trim()) return setError("اكتب سبب الطلب");
    if (reason.trim().length > REASON_MAX) return setError(`السبب أطول من ${REASON_MAX} حرف`);
    request.mutate(
      { points: Math.round(value), reason: reason.trim(), requestId },
      {
        onSuccess: () => {
          toast.show("أُرسل طلبك لمدير الشركة");
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
      title="طلب نقاط"
      subtitle="يصل طلبك لمدير الشركة معلّقًا بانتظار الموافقة، ولن يُضاف لرصيدك قبل اعتمادها."
      footer={
        <>
          <Button title="إرسال الطلب" icon="send" onPress={submit} loading={request.isPending} />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Field label="عدد النقاط" required hint={defaultPoints ? `قاعدة الشركة للمنح المباشر = ${defaultPoints}` : undefined}>
        <Input value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="0" />
      </Field>
      <Field label="السبب" required hint="اذكر المهمة أو الإنجاز الذي تطلب النقاط من أجله.">
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={REASON_MAX}
          placeholder="مثال: تغطية عمل إضافي على مشروع الفيلا"
          style={{ minHeight: 90, textAlignVertical: "top" }}
        />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
}
