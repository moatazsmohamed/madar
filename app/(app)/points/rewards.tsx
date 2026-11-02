import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Page } from "@/components/madar/shell";
import { RedemptionRow } from "@/components/madar/points-views";
import {
  Button,
  C,
  Card,
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
  confirmAction,
  useToast,
} from "@/components/madar/ui";
import { fmtRelative } from "@/lib/madar/format";
import { canManagePointsSettings, canSeePoints } from "@/lib/madar/permissions";
import { pointsLabel } from "@/lib/madar/points";
import {
  useDecideRedemption,
  useFulfilRedemption,
  useLookups,
  usePointSettings,
  useRedemptions,
  useRefundRedemption,
  useRewards,
  useSaveReward,
} from "@/lib/madar/queries";
import { useMe } from "@/lib/madar/session";
import type { PointSettings, Redemption, Reward } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

const digits = (v: string) => v.replace(/[^0-9]/g, "");

export default function RewardsScreen() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const settings = usePointSettings();
  const rewards = useRewards();
  const companyRedemptions = useRedemptions("company", canManagePointsSettings(me));
  const { profileMap } = useLookups();
  const decide = useDecideRedemption();
  const fulfil = useFulfilRedemption();
  const refund = useRefundRedemption();

  const [editing, setEditing] = useState<Reward | "new" | null>(null);
  const [refunding, setRefunding] = useState<Redemption | null>(null);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const live = settings.data ?? null;
  const admin = canManagePointsSettings(me);
  const rows = rewards.data ?? [];
  const queue = useMemo(() => (companyRedemptions.data ?? []).filter((r) => r.status === "requested"), [companyRedemptions.data]);
  const approved = useMemo(() => (companyRedemptions.data ?? []).filter((r) => r.status === "approved"), [companyRedemptions.data]);
  const rewardName = (id: string) => rows.find((r) => r.id === id)?.name ?? "مكافأة أُزيلت";

  const decideOne = (r: Redemption, approve: boolean) =>
    decide.mutate(
      { id: r.id, approve, note: approve ? null : "لا يمكن توفيرها حاليًا" },
      {
        onSuccess: (row) => toast.show(row.status === "approved" ? "تم اعتماد الطلب وخصم النقاط" : "رُفض الطلب ونقاطه محفوظة"),
        onError: (e) => toast.show(errorMessage(e), "error"),
      },
    );

  const deliver = (r: Redemption) =>
    fulfil.mutate(
      { id: r.id },
      {
        onSuccess: () => toast.show("تم التسليم وأُغلقت المكافأة"),
        onError: (e) => toast.show(errorMessage(e), "error"),
      },
    );

  const submitRefund = () => {
    setFormError(null);
    if (!refunding) return;
    if (!note.trim()) return setFormError("اكتب سبب الاسترجاع — يُسجَّل في الحركة المعاكسة");
    refund.mutate(
      { id: refunding.id, note: note.trim() },
      {
        onSuccess: () => {
          toast.show("أُرجعت النقاط بحركة تصحيح واضحة");
          setRefunding(null);
          setNote("");
        },
        onError: (e) => setFormError(errorMessage(e)),
      },
    );
  };

  if (!settings.isLoading && !canSeePoints(me, live)) {
    return (
      <Page title="المكافآت" maxWidth={900}>
        <EmptyState icon="gift" title="النقاط غير مفعّلة" hint="شغّل النظام من إعدادات النقاط لتحديد مكافآت." />
      </Page>
    );
  }

  if (!admin) {
    return (
      <Page title="المكافآت" maxWidth={900} back={() => router.push("/points" as any)}>
        <EmptyState icon="lock" title="للمدير فقط" hint="إدارة المكافآت وطلبات الاستبدال من صلاحيات مدير الشركة." />
      </Page>
    );
  }

  const loading = settings.isLoading || rewards.isLoading || companyRedemptions.isLoading;

  return (
    <Page
      title="المكافآت والاستبدال"
      subtitle="لا مدفوعات: المكافأة شيء داخلي تسلّمه بيدك، والنقاط تُخصم من السجل."
      back={() => router.push("/points/manage" as any)}
      actions={<Button title="مكافأة جديدة" icon="plus" size="sm" onPress={() => setEditing("new")} />}
    >
      {loading ? (
        <Loading />
      ) : (
        <View style={{ gap: 16 }}>
          <Card style={{ gap: 10 }}>
            <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <SectionLabel>{`طلبات الاستبدال (${queue.length})`}</SectionLabel>
              {live?.require_approval ? null : <T className="text-[11.5px] text-muted">الإعدادات تعتمد الطلبات فورًا، فلا طابور.</T>}
            </Row>
            {queue.length === 0 ? (
              <EmptyState icon="check-circle" title="لا طلبات" hint="يعتمد الاعتماد النقاط عند الموافقة، ويرفضها مع بقاء الرصيد." />
            ) : (
              queue.map((r, i) => (
                <View key={r.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                  <RedemptionRow
                    redemption={r}
                    rewardName={rewardName(r.reward_id)}
                    who={profileMap.get(r.member_id) ?? null}
                    right={
                      <Row style={{ gap: 6 }}>
                        <Button title="اعتماد" icon="check" size="sm" loading={decide.isPending} onPress={() => decideOne(r, true)} />
                        <Button
                          title="رفض"
                          icon="x-circle"
                          variant="danger"
                          size="sm"
                          onPress={async () => {
                            if (!(await confirmAction(`رفض طلب ${profileMap.get(r.member_id)?.full_name ?? "العضو"}؟ النقاط تبقى كما هي.`, "رفض"))) return;
                            decideOne(r, false);
                          }}
                        />
                      </Row>
                    }
                  />
                </View>
              ))
            )}
          </Card>

          <Card style={{ gap: 10 }}>
            <SectionLabel>{`معتمدة، بانتظار التسليم (${approved.length})`}</SectionLabel>
            {approved.length === 0 ? (
              <EmptyState icon="package" title="لا شيء مسلَّج" hint="بعد الاعتماد تظهر هنا لتأكيد التسليم أو الاسترجاع." />
            ) : (
              approved.map((r, i) => (
                <View key={r.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                  <RedemptionRow
                    redemption={r}
                    rewardName={rewardName(r.reward_id)}
                    who={profileMap.get(r.member_id) ?? null}
                    right={
                      <Row style={{ gap: 6 }}>
                        <Button title="تم التسليم" icon="check-circle" size="sm" loading={fulfil.isPending} onPress={() => deliver(r)} />
                        <Button title="استرجاع" icon="corner-up-left" variant="ghost" size="sm" onPress={() => setRefunding(r)} />
                      </Row>
                    }
                  />
                </View>
              ))
            )}
          </Card>

          <Card style={{ gap: 12 }}>
            <SectionLabel>قائمة المكافآت</SectionLabel>
            {rows.length === 0 ? (
              <EmptyState icon="gift" title="لا مكافآت بعد" hint="أضف أول مكافأة لتظهر للأعضاء في صفحتهم." />
            ) : (
              rows.map((r, i) => (
                <View key={r.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border, paddingTop: 12, marginTop: i === 0 ? 0 : 2, gap: 8 }}>
                  <Row style={{ gap: 10, flexWrap: "wrap" }}>
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: r.enabled ? C["primary-soft"] : C.sand, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="gift" size={17} color={r.enabled ? C.primary : C.muted} />
                    </View>
                    <View style={{ flex: 1, minWidth: 190, gap: 2 }}>
                      <T weight="semibold">{r.name}</T>
                      {r.description ? (
                        <T className="text-[12px] text-muted" numberOfLines={2}>
                          {r.description}
                        </T>
                      ) : null}
                    </View>
                    <T weight="bold" style={{ fontVariant: ["tabular-nums"] }} className="text-[13px]">
                      {pointsLabel(r.cost_points, live)}
                    </T>
                    <Button title="تعديل" icon="edit-2" variant="secondary" size="sm" onPress={() => setEditing(r)} />
                  </Row>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {r.enabled ? <Pill label="معروضة" tone="success" /> : <Pill label="موقوفة" tone="neutral" />}
                    {r.stock === null ? <Pill label="مخزون مفتوح" tone="neutral" /> : <Pill label={`متبقٍ ${r.stock}`} tone={r.stock > 0 ? "info" : "error"} />}
                    {r.per_member_max ? <Pill label={`أقصته ${r.per_member_max}`} tone="neutral" /> : null}
                  </View>
                </View>
              ))
            )}
            <InfoBox tone="info" icon="info">
              كل استبدال يعتمد على الرصيد الفعلي وقتها، والمخزون يخصم وحدة واحدة عند الخصم، والإلغاء يكتب حركة معاكسة بدل حذف القديمة.
            </InfoBox>
          </Card>
        </View>
      )}

      <RewardSheet visible={!!editing} onClose={() => setEditing(null)} reward={editing === "new" ? null : editing ?? null} settings={live} />

      <Sheet
        visible={!!refunding}
        onClose={() => {
          setRefunding(null);
          setNote("");
        }}
        title="استرجاع مكافأة"
        subtitle={refunding ? `${rewardName(refunding.reward_id)} · ${profileMap.get(refunding.member_id)?.full_name ?? ""} · ${fmtRelative(refunding.created_at)}` : ""}
        footer={
          <>
            <Button title="أرجع النقاط" icon="corner-up-left" variant="danger" loading={refund.isPending} onPress={submitRefund} />
            <Button title="إلغاء" variant="secondary" onPress={() => { setRefunding(null); setNote(""); }} />
          </>
        }
      >
        <InfoBox tone="warning" icon="alert-triangle">
          الاسترجاع يُلغي المكافأة ويعيد نقاطها بحركة تصحيح، مع رجوع وحدة للمخزون إن كان محدودًا.
        </InfoBox>
        <Field label="سبب الاسترجاع" required>
          <Input
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={300}
            placeholder="مثال: تعذّر توفير المكافأة هذا الشهر"
            style={{ minHeight: 90, textAlignVertical: "top" }}
          />
        </Field>
        <ErrorBox message={formError} />
      </Sheet>
    </Page>
  );
}

function RewardSheet({
  visible,
  onClose,
  reward,
  settings,
}: {
  visible: boolean;
  onClose: () => void;
  reward: Reward | null;
  settings: PointSettings | null;
}) {
  const toast = useToast();
  const save = useSaveReward();
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [cost, setCost] = useState(reward ? String(reward.cost_points) : "");
  const [stock, setStock] = useState(reward?.stock === null || !reward ? "" : String(reward.stock));
  const [perMember, setPerMember] = useState(reward?.per_member_max === null || !reward ? "" : String(reward.per_member_max));
  const [enabled, setEnabled] = useState(reward?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(reward?.name ?? "");
    setDescription(reward?.description ?? "");
    setCost(reward ? String(reward.cost_points) : "");
    setStock(reward?.stock === null || !reward ? "" : String(reward.stock));
    setPerMember(reward?.per_member_max === null || !reward ? "" : String(reward.per_member_max));
    setEnabled(reward?.enabled ?? true);
    setError(null);
  }, [visible, reward]);

  const submit = () => {
    setError(null);
    const value = Number(cost || 0);
    const stockNum = stock.trim() === "" ? null : Number(stock);
    const perNum = perMember.trim() === "" ? null : Number(perMember);
    if (!name.trim()) return setError("اسم المكافأة مطلوب");
    if (!cost || !Number.isFinite(value) || value <= 0) return setError("تكلفة المكافأة عدد صحيح أكبر من صفر");
    if (stockNum !== null && (!Number.isFinite(stockNum) || stockNum < 0)) return setError("المخزون صفر أو أكثر، أو اتركه فارغًا");
    if (perNum !== null && (!Number.isFinite(perNum) || perNum <= 0)) return setError("حد العضو أكبر من صفر، أو اتركه فارغًا");
    save.mutate(
      {
        id: reward?.id ?? null,
        name: name.trim(),
        description: description.trim() || null,
        cost: Math.round(value),
        stock: stockNum === null ? null : Math.round(stockNum),
        perMemberMax: perNum === null ? null : Math.round(perNum),
        enabled,
      },
      {
        onSuccess: () => {
          toast.show(reward ? "حُدِّثت المكافأة" : "أُضيفت المكافأة");
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
      title={reward ? `تعديل: ${reward.name}` : "مكافأة جديدة"}
      subtitle="اسمها وتكلفتها فقط ما يراه العضو."
      footer={
        <>
          <Button title={reward ? "حفظ التعديل" : "إضافة"} icon="check" loading={save.isPending} onPress={submit} />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Field label="الاسم" required>
        <Input value={name} onChangeText={setName} maxLength={60} placeholder="مثال: يوم راحة إضافي" />
      </Field>
      <Field label="وصف">
        <Input
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={200}
          placeholder="لمن هي، وكيف تُسلَّم…"
          style={{ minHeight: 76, textAlignVertical: "top" }}
        />
      </Field>
      <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field label="التكلفة" required hint={settings?.unit_label}>
            <Input value={cost} onChangeText={(v) => setCost(digits(v))} placeholder="100" keyboardType="number-pad" />
          </Field>
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field label="المخزون" hint="فارغ = مفتوح.">
            <Input value={stock} onChangeText={(v) => setStock(digits(v))} placeholder="مفتوح" keyboardType="number-pad" />
          </Field>
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Field label="الحد لكل عضو" hint="فارغ = بلا حد.">
            <Input value={perMember} onChangeText={(v) => setPerMember(digits(v))} placeholder="بلا حد" keyboardType="number-pad" />
          </Field>
        </View>
      </View>
      <Field label="العرض">
        <Segmented
          value={enabled ? "on" : "off"}
          onChange={(v) => setEnabled(v === "on")}
          options={[
            { value: "on", label: "معروضة", icon: "check-circle" },
            { value: "off", label: "موقوفة", icon: "x-circle" },
          ]}
        />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
}
