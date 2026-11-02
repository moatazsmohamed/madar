import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Page } from "@/components/madar/shell";
import { EntryRow, RedemptionRow, RequestPointsSheet, SignedPoints, StandingCard } from "@/components/madar/points-views";
import {
  Button,
  C,
  Card,
  EmptyState,
  Icon,
  InfoBox,
  Loading,
  Pill,
  Row,
  SectionLabel,
  Segmented,
  T,
  alpha,
  useIsWide,
  useToast,
} from "@/components/madar/ui";
import { fmtDay, isoDateInTz } from "@/lib/madar/format";
import { canManagePointsSettings, canRedeemPoints, canRequestPoints, canSeePoints } from "@/lib/madar/permissions";
import { checkRedeem, dedupeToken, pointsLabel } from "@/lib/madar/points";
import {
  useMyPoints,
  usePointEntries,
  usePointRules,
  usePointSettings,
  useRedeemReward,
  useRedemptions,
  useRewards,
} from "@/lib/madar/queries";
import { useMe } from "@/lib/madar/session";
import type { PointSettings, Reward } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

type Tab = "ledger" | "asks";

/** Why a reward cannot be redeemed yet, in the words the server would use. */
function redeemHint(reward: Reward, standing: { balance: number; redeemedByMember: number }, live: PointSettings | null): string | null {
  const res = checkRedeem(reward, standing, live);
  if (res.block === "enough") return null;
  if (res.block === "off") return "أُوقفت هذه المكافأة";
  if (res.block === "stock") return "نفد مخزون هذه المكافأة";
  if (res.block === "per_member") return "وصلت لحدّك الأقصى من هذه المكافأة";
  if (res.block === "minimum") return `الاستبدال يبدأ من ${pointsLabel(live?.min_redeem_points ?? 0, live)} — ينقصك ${pointsLabel(res.shortBy, live)}`;
  return `رصيدك لا يكفي؛ تحتاج ${pointsLabel(reward.cost_points, live)} وينقصك ${pointsLabel(res.shortBy, live)}`;
}

export default function MyPointsScreen() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const wide = useIsWide();
  const settings = usePointSettings();
  const rules = usePointRules();
  const points = useMyPoints();
  const rewards = useRewards();
  const entries = usePointEntries({ member: me.id });
  const mine = useRedemptions("mine");
  const redeem = useRedeemReward();
  const [requesting, setRequesting] = useState(false);
  const [tab, setTab] = useState<Tab>("ledger");

  const live = settings.data ?? null;
  const manual = (rules.data ?? []).find((r) => r.event_key === "manual" && r.enabled);
  const rewardMap = useMemo(() => new Map((rewards.data ?? []).map((r) => [r.id, r])), [rewards.data]);
  const balance = points.data?.balance ?? 0;
  const available = (rewards.data ?? []).filter((r) => r.enabled);

  const spentBy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of mine.data ?? []) {
      if (r.status === "requested" || r.status === "approved" || r.status === "fulfilled") {
        counts.set(r.reward_id, (counts.get(r.reward_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [mine.data]);

  const doRedeem = (reward: Reward) => {
    const hint = redeemHint(reward, { balance, redeemedByMember: spentBy.get(reward.id) ?? 0 }, live);
    if (hint) return toast.show(hint, "error");
    redeem.mutate(
      { reward: reward.id, requestId: dedupeToken() },
      {
        onSuccess: (row) => toast.show(row.status === "requested" ? "طلب الاستبدال بانتظار موافقة الإدارة" : `تم استبدال ${reward.name}`),
        onError: (e) => toast.show(errorMessage(e), "error"),
      },
    );
  };

  if (!settings.isLoading && !canSeePoints(me, live)) {
    return (
      <Page title="النقاط والمكافآت" maxWidth={820}>
        <EmptyState
          icon="award"
          title="نظام النقاط غير مفعّل"
          hint="يفعّله مدير الشركة من إعدادات النقاط، وبعدها تظهر رصيدك وقواعد الاكتساب والمكافآت."
        />
      </Page>
    );
  }

  const loading = settings.isLoading || points.isLoading || entries.isLoading || mine.isLoading;

  return (
    <Page
      title="نقاطي"
      subtitle={live ? `الوحدة: ${live.unit_label} · ${live.require_approval ? "الحركات تحتاج موافقة" : "الحركات تُعتمد فورًا"}` : "لم تُضبط إعدادات النقاط بعد"}
      actions={
        <>
          {canRequestPoints(me) ? <Button title="طلب نقاط" icon="send" size="sm" onPress={() => setRequesting(true)} /> : null}
          {canManagePointsSettings(me) ? (
            <Button title="إدارة النقاط" icon="settings" variant="secondary" size="sm" onPress={() => router.push("/points/manage" as any)} />
          ) : null}
        </>
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <View style={{ gap: 16 }}>
          <StandingCard points={points.data} settings={live} />

          <Card style={{ gap: 12 }}>
            <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <SectionLabel>المكافآت المتاحة</SectionLabel>
              <T className="text-[11.5px] text-muted">لا عملية شراء فعلية — الاستبدال طلب داخلي تسجّله الإدارة.</T>
            </Row>
            {available.length === 0 ? (
              <EmptyState icon="gift" title="لا توجد مكافآت بعد" hint="يضيفها مدير الشركة، ثم تستبدل نقاطك بها من هنا." />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {available.map((r) => {
                  const hint = redeemHint(r, { balance, redeemedByMember: spentBy.get(r.id) ?? 0 }, live);
                  return (
                    <Card key={r.id} style={{ flex: wide ? 1 : undefined, minWidth: 250, gap: 10, borderColor: hint ? C.border : alpha(C.primary, 45) }}>
                      <Row style={{ alignItems: "flex-start", gap: 10 }}>
                        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C["primary-soft"], alignItems: "center", justifyContent: "center" }}>
                          <Icon name="gift" size={17} color={C.primary} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <T weight="semibold">{r.name}</T>
                          {r.description ? (
                            <T className="text-[12px] text-muted" numberOfLines={2}>
                              {r.description}
                            </T>
                          ) : null}
                        </View>
                        <SignedPoints value={-r.cost_points} settings={live} size={14} />
                      </Row>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        {r.stock === null ? (
                          <Pill label="بلا حد للمخزون" tone="neutral" />
                        ) : (
                          <Pill label={`المخزون ${r.stock}`} tone={r.stock > 0 ? "info" : "error"} />
                        )}
                        {r.per_member_max ? <Pill label={`أقصته ${r.per_member_max} لكل عضو`} tone="neutral" /> : null}
                      </View>
                      {hint ? (
                        <T className="text-[12px]" style={{ color: C.warning }}>
                          {hint}
                        </T>
                      ) : null}
                      <Button title="استبدال" icon="check-circle" size="sm" disabled={!!hint} loading={redeem.isPending} onPress={() => doRedeem(r)} />
                    </Card>
                  );
                })}
              </View>
            )}
          </Card>

          <Card style={{ gap: 12 }}>
            <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <SectionLabel>سجلّي</SectionLabel>
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "ledger", label: "الحركات" },
                  { value: "asks", label: "الاستبدالات" },
                ]}
              />
            </Row>
            {tab === "ledger" ? (
              (entries.data ?? []).length === 0 ? (
                <EmptyState icon="award" title="لا حركات بعد" hint="تُضاف النقاط تلقائيًا عند اعتماد مهامك، أو بطلب منك يوافق عليه المدير." />
              ) : (
                <View>
                  {(entries.data ?? []).map((e, i) => (
                    <View key={e.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                      <EntryRow entry={e} settings={live} />
                    </View>
                  ))}
                </View>
              )
            ) : (mine.data ?? []).length === 0 ? (
              <EmptyState icon="gift" title="لم تستبدل شيئًا" hint="اختر مكافأة من القائمة أعلاه." />
            ) : (
              <View>
                {(mine.data ?? []).map((r, i) => (
                  <View key={r.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
                    <RedemptionRow redemption={r} rewardName={rewardMap.get(r.reward_id)?.name ?? "مكافأة أُزيلت"} />
                  </View>
                ))}
              </View>
            )}
          </Card>

          {live?.expiry_days ? (
            <InfoBox tone="info" icon="info">
              {`تسقط النقاط بعد ${live.expiry_days} يومًا من اعتمادها. `}
              {points.data?.expires_on
                ? `أقرب حركة لديك تنتهي ${fmtDay(isoDateInTz(new Date(points.data.expires_on)))}.`
                : "لا حركة لديك تحمل موعد انتهاء."}
            </InfoBox>
          ) : null}

          {canRedeemPoints(me) && balance < 0 ? (
            <InfoBox tone="warning" icon="alert-triangle">
              رصيدك بالسالب بعد تسوية، ولن يمكنك الاستبدال حتى يعود موجبًا.
            </InfoBox>
          ) : null}
        </View>
      )}

      <RequestPointsSheet visible={requesting} onClose={() => setRequesting(false)} settings={live} defaultPoints={manual?.points ?? null} />
    </Page>
  );
}
