import { useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { Page } from "@/components/madar/shell";
import {
  Button,
  C,
  Card,
  DateField,
  EmptyState,
  ErrorBox,
  Field,
  Icon,
  InfoBox,
  Input,
  Loading,
  Pill,
  Row,
  SectionLabel,
  Segmented,
  Sheet,
  T,
  toneColor,
  useToast,
} from "@/components/madar/ui";
import { fmtDay } from "@/lib/madar/format";
import {
  POINT_EVENT_HINTS,
  POINT_EVENT_LABELS,
  POINT_EVENT_ORDER,
  POINT_PERIOD_LABELS,
  POINT_PERIOD_ORDER,
} from "@/lib/madar/labels";
import { canManagePointsSettings, canSeePoints } from "@/lib/madar/permissions";
import { ruleWindow } from "@/lib/madar/points";
import { usePointRules, usePointSettings, useSavePointRule, useSavePointSettings } from "@/lib/madar/queries";
import { useMe } from "@/lib/madar/session";
import type { PointEventKey, PointPeriodKind, PointRule, PointSettings } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

const NUMERIC = { keyboardType: "number-pad" } as const;
const digits = (v: string) => v.replace(/[^0-9]/g, "");

export default function PointSettingsScreen() {
  const me = useMe();
  const router = useRouter();
  const settings = usePointSettings();
  const rules = usePointRules();

  if (!settings.isLoading && !canSeePoints(me, settings.data ?? null)) {
    return (
      <Page title="إعدادات النقاط" maxWidth={900}>
        <EmptyState icon="award" title="النقاط غير مفعّلة" hint="شغّلها من هنا ليبدأ السجل في استقبال الحركات." />
      </Page>
    );
  }

  if (!canManagePointsSettings(me)) {
    return (
      <Page title="إعدادات النقاط" maxWidth={900} back={() => router.push("/points" as any)}>
        <EmptyState icon="lock" title="للمدير فقط" hint="إعدادات النقاط وقواعد الاكتساب يديرها مدير الشركة." />
      </Page>
    );
  }

  const loading = settings.isLoading || rules.isLoading;
  const byEvent = new Map((rules.data ?? []).map((r) => [r.event_key, r]));

  return (
    <Page
      title="إعدادات النقاط"
      subtitle="التغييرات تسري على الحركات الجديدة؛ السجل القديم لا يتعدل."
      back={() => router.push("/points/manage" as any)}
      actions={<Button title="المكافآت" icon="gift" variant="secondary" size="sm" onPress={() => router.push("/points/rewards" as any)} />}
    >
      {loading ? (
        <Loading />
      ) : (
        <View style={{ gap: 16 }}>
          <SettingsForm settings={settings.data ?? null} />

          <Card style={{ gap: 12 }}>
            <SectionLabel>قواعد الاكتساب</SectionLabel>
            <T className="text-[12px] text-muted">قاعدة واحدة لكل حدث. الأحداث التلقائية تُقيَّم عند اعتماد المهمة أو إغلاق الشهر.</T>
            {POINT_EVENT_ORDER.map((event) => (
              <RuleRow key={event} event={event} rule={byEvent.get(event) ?? null} />
            ))}
          </Card>
        </View>
      )}
    </Page>
  );
}

function SettingsForm({ settings }: { settings: PointSettings | null }) {
  const toast = useToast();
  const save = useSavePointSettings();
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [unitLabel, setUnitLabel] = useState(settings?.unit_label ?? "نقطة");
  const [unitSymbol, setUnitSymbol] = useState(settings?.unit_symbol ?? "ن");
  const [requireApproval, setRequireApproval] = useState(settings?.require_approval ?? true);
  const [periodKind, setPeriodKind] = useState<PointPeriodKind>(settings?.period_kind ?? "month");
  const [cap, setCap] = useState(String(settings?.per_member_period_cap ?? ""));
  const [expiry, setExpiry] = useState(String(settings?.expiry_days ?? ""));
  const [minRedeem, setMinRedeem] = useState(String(settings?.min_redeem_points ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setUnitLabel(settings.unit_label);
    setUnitSymbol(settings.unit_symbol);
    setRequireApproval(settings.require_approval);
    setPeriodKind(settings.period_kind);
    setCap(settings.per_member_period_cap === null ? "" : String(settings.per_member_period_cap));
    setExpiry(settings.expiry_days === null ? "" : String(settings.expiry_days));
    setMinRedeem(settings.min_redeem_points === null ? "" : String(settings.min_redeem_points));
    setError(null);
  }, [settings]);

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const parsed = useMemo(() => ({ cap: num(cap), expiry: num(expiry), minRedeem: num(minRedeem) }), [cap, expiry, minRedeem]);

  const submit = () => {
    setError(null);
    if (!unitLabel.trim()) return setError("اكتب اسم الوحدة، مثل: نقطة أو نجمة");
    if (Object.values(parsed).some((v) => v !== null && (!Number.isFinite(v) || v <= 0)) && parsed.minRedeem !== 0) {
      return setError("الأرقام يجب أن تكون صحيحة أكبر من صفر، أو اتركها فارغة");
    }
    save.mutate(
      {
        enabled,
        unitLabel: unitLabel.trim(),
        unitSymbol: unitSymbol.trim() || "ن",
        requireApproval,
        periodKind,
        cap: parsed.cap,
        expiryDays: parsed.expiry,
        minRedeem: parsed.minRedeem,
      },
      {
        onSuccess: () => toast.show("حُفظت إعدادات النقاط"),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Card style={{ gap: 14 }}>
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
          <T weight="semibold">{enabled ? "النظام يعمل" : "النظام موقوف"}</T>
          <T className="text-[12px] text-muted">
            {enabled ? "كل الشاشات متاحة للأعضاء وفق صلاحياتهم." : "لن يكتسب أحد نقاطًا ولا تظهر الشاشات للأعضاء."}
          </T>
        </View>
        <Segmented
          value={enabled ? "on" : "off"}
          onChange={(v) => setEnabled(v === "on")}
          options={[
            { value: "on", label: "تفعيل", icon: "check-circle" },
            { value: "off", label: "إيقاف", icon: "x-circle" },
          ]}
        />
      </Row>

      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field label="اسم الوحدة" hint="يظهر في كل الشاشات، مثل: نقطة">
            <Input value={unitLabel} onChangeText={setUnitLabel} maxLength={24} placeholder="نقطة" />
          </Field>
        </View>
        <View style={{ width: Platform.OS === "web" ? 130 : "100%" }}>
          <Field label="رمزها" hint="حرف أو حرفان">
            <Input value={unitSymbol} onChangeText={setUnitSymbol} maxLength={4} placeholder="ن" />
          </Field>
        </View>
      </View>

      <Field label="الموافقة على الحركات" hint="عند الطلب، كل منح أو طلب عضو يبقى معلّقًا حتى مراجعته. الخصم من مسؤول يُنفَّذ فورًا.">
        <Segmented
          value={requireApproval ? "ask" : "auto"}
          onChange={(v) => setRequireApproval(v === "ask")}
          options={[
            { value: "ask", label: "تحتاج موافقة", icon: "clock" },
            { value: "auto", label: "اعتماد فوري", icon: "zap" },
          ]}
        />
      </Field>

      <Field label="فترة حد النقاط" hint="النطاق الذي يُقاس عليه حد العضو.">
        <Segmented
          value={periodKind}
          onChange={setPeriodKind}
          options={POINT_PERIOD_ORDER.map((p) => ({ value: p, label: POINT_PERIOD_LABELS[p] }))}
        />
      </Field>

      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Field label={`حد العضو في ${periodKind === "day" ? "اليوم" : periodKind === "month" ? "الشهر" : "الفترة"}`} hint="اتركها فارغة بلا حد.">
            <Input value={cap} onChangeText={(v) => setCap(digits(v))} placeholder="بلا حد" {...NUMERIC} />
          </Field>
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Field label="صلاحية النقاط (أيام)" hint="تُسقط تلقائيًا بعد هذا العدد من الاعتماد.">
            <Input value={expiry} onChangeText={(v) => setExpiry(digits(v))} placeholder="بلا انتهاء" {...NUMERIC} />
          </Field>
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <Field label="أقل رصيد للاستبدال" hint="لا يستبدل أحد قبل بلوغه.">
            <Input value={minRedeem} onChangeText={(v) => setMinRedeem(digits(v))} placeholder="بلا حد" {...NUMERIC} />
          </Field>
        </View>
      </View>

      {periodKind === "none" && cap.trim() !== "" ? (
        <InfoBox tone="warning" icon="alert-triangle">
          بلا فترة تعني حدًا واحدًا لا يتجدد؛ الحد الحالي يُطبَّق على كل ما كسبه العضو منذ تشغيل النظام.
        </InfoBox>
      ) : null}

      <ErrorBox message={error} />
      <Button title="حفظ الإعدادات" icon="check" loading={save.isPending} onPress={submit} />
    </Card>
  );
}

function RuleRow({ event, rule }: { event: PointEventKey; rule: PointRule | null }) {
  const [open, setOpen] = useState(false);
  const today = fmtDay(new Date().toISOString().slice(0, 10));
  const window = rule ? ruleWindow(rule, today) : null;

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, marginTop: 2 }}>
      <Row style={{ gap: 10, flexWrap: "wrap" }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.sand, alignItems: "center", justifyContent: "center" }}>
          <Icon name={event === "task_approved" ? "check-circle" : event === "month_closed" ? "calendar" : "plus"} size={17} color={C.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <T weight="semibold">{rule ? rule.name : POINT_EVENT_LABELS[event]}</T>
          <T className="text-[12px] text-muted">{rule?.description ?? POINT_EVENT_HINTS[event]}</T>
        </View>
        {rule ? (
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Pill label={`${rule.points} لكل حدث`} tone={rule.enabled ? "primary" : "neutral"} />
            {!rule.enabled ? <Pill label="موقوفة" tone="neutral" /> : null}
            {window === "scheduled" ? <Pill label={`تبدأ ${fmtDay(rule.starts_on!)}`} tone="info" /> : null}
            {window === "ended" ? <Pill label="انتهت" tone="warning" /> : null}
            {rule.require_approval !== null ? (
              <Pill label={rule.require_approval ? "بموافقة" : "فورية"} tone={rule.require_approval ? "warning" : "success"} />
            ) : null}
          </View>
        ) : (
          <Pill label="لم تُضبط" tone="neutral" />
        )}
        <Button title={rule ? "تعديل" : "إضافة"} icon="edit-2" variant="secondary" size="sm" onPress={() => setOpen(true)} />
      </Row>
      <RuleSheet visible={open} onClose={() => setOpen(false)} event={event} rule={rule} />
    </View>
  );
}

function RuleSheet({ visible, onClose, event, rule }: { visible: boolean; onClose: () => void; event: PointEventKey; rule: PointRule | null }) {
  const toast = useToast();
  const save = useSavePointRule();
  const [name, setName] = useState(rule?.name ?? POINT_EVENT_LABELS[event]);
  const [description, setDescription] = useState(rule?.description ?? "");
  const [points, setPoints] = useState(rule ? String(rule.points) : "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [approval, setApproval] = useState<"follow" | "ask" | "auto">(rule?.require_approval === null || rule === null ? "follow" : rule.require_approval ? "ask" : "auto");
  const [maxPerMember, setMaxPerMember] = useState(rule?.max_per_member === null || !rule ? "" : String(rule.max_per_member));
  const [startsOn, setStartsOn] = useState<string | null>(rule?.starts_on ?? null);
  const [endsOn, setEndsOn] = useState<string | null>(rule?.ends_on ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(rule?.name ?? POINT_EVENT_LABELS[event]);
    setDescription(rule?.description ?? "");
    setPoints(rule ? String(rule.points) : "");
    setEnabled(rule?.enabled ?? true);
    setApproval(rule?.require_approval === null || !rule ? "follow" : rule.require_approval ? "ask" : "auto");
    setMaxPerMember(rule?.max_per_member === null || !rule ? "" : String(rule.max_per_member));
    setStartsOn(rule?.starts_on ?? null);
    setEndsOn(rule?.ends_on ?? null);
    setError(null);
  }, [visible, rule, event]);

  const submit = () => {
    setError(null);
    const value = Number(points || 0);
    if (!name.trim()) return setError("اسم القاعدة مطلوب");
    if (!points || !Number.isFinite(value) || value <= 0) return setError("قيمة النقاط عدد صحيح أكبر من صفر");
    const max = maxPerMember.trim() === "" ? null : Number(maxPerMember);
    if (max !== null && (!Number.isFinite(max) || max <= 0)) return setError("حد العضو أكبر من صفر، أو اتركه فارغًا");
    if (startsOn && endsOn && endsOn < startsOn) return setError("تاريخ النهاية بعد البداية");
    save.mutate(
      {
        id: rule?.id ?? null,
        eventKey: event,
        name: name.trim(),
        description: description.trim() || null,
        points: Math.round(value),
        enabled,
        requireApproval: approval === "follow" ? null : approval === "ask",
        maxPerMember: max === null ? null : Math.round(max),
        startsOn,
        endsOn,
      },
      {
        onSuccess: () => {
          toast.show(rule ? "حُدِّثت القاعدة" : "أُضيفت القاعدة");
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
      title={rule ? `تعديل: ${rule.name}` : `قاعدة ${POINT_EVENT_LABELS[event]}`}
      subtitle={POINT_EVENT_HINTS[event]}
      footer={
        <>
          <Button title={rule ? "حفظ التعديل" : "إضافة القاعدة"} icon="check" loading={save.isPending} onPress={submit} />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Field label="الاسم" required hint="كما يظهر في سجل القواعد.">
        <Input value={name} onChangeText={setName} maxLength={60} />
      </Field>
      <Field label="وصف مختصر">
        <Input
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={200}
          placeholder="متى تُمنح هذه النقاط بالظبط…"
          style={{ minHeight: 76, textAlignVertical: "top" }}
        />
      </Field>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field label="النقاط لكل حدث" required>
            <Input value={points} onChangeText={(v) => setPoints(digits(v))} placeholder="10" {...NUMERIC} />
          </Field>
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field label="حد العضو من هذه القاعدة" hint="فارغ = بلا حد.">
            <Input value={maxPerMember} onChangeText={(v) => setMaxPerMember(digits(v))} placeholder="بلا حد" {...NUMERIC} />
          </Field>
        </View>
      </View>

      <Field label="الحالة">
        <Segmented
          value={enabled ? "on" : "off"}
          onChange={(v) => setEnabled(v === "on")}
          options={[
            { value: "on", label: "مفعّلة", icon: "check-circle" },
            { value: "off", label: "موقوفة", icon: "x-circle" },
          ]}
        />
      </Field>

      <Field label="الموافقة لهذه القاعدة" hint="تتجاوز إعداد الشركة لحدث واحد فقط.">
        <Segmented
          value={approval}
          onChange={setApproval}
          options={[
            { value: "follow", label: "مثل الإعداد العام" },
            { value: "ask", label: "تحتاج موافقة" },
            { value: "auto", label: "فورية" },
          ]}
        />
      </Field>

      <Field label="نافذة سريان القاعدة" hint="اتركهما فارغين لتعمل دائمًا.">
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 150 }}>
            <DateField value={startsOn} onChange={setStartsOn} placeholder="تبدأ من…" />
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <DateField value={endsOn} onChange={setEndsOn} placeholder="تنتهي في…" />
          </View>
        </View>
      </Field>

      {startsOn || endsOn ? (
        <T className="text-[11.5px]" style={{ color: toneColor("info") }}>
          {`التوقيت محسوب على يوم الشركة: ${startsOn ? `من ${fmtDay(startsOn)}` : "بلا بداية"}${endsOn ? ` — إلى ${fmtDay(endsOn)}` : ""}`}
        </T>
      ) : null}

      <ErrorBox message={error} />
    </Sheet>
  );
}
