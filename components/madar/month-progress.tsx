import { useState } from "react";
import { View } from "react-native";
import { fmtMonth } from "@/lib/madar/format";
import { isLead } from "@/lib/madar/permissions";
import { memberTallies, tallyTasks } from "@/lib/madar/progress";
import { useLookups } from "@/lib/madar/queries";
import { useMe } from "@/lib/madar/session";
import type { CompanyMonth, Task } from "@/lib/madar/types";
import { Avatar, C, Card, Icon, Pill, ProgressBar, SectionLabel, T, Tap } from "./ui";

function percentTone(percent: number) {
  return percent >= 80 ? C.success : percent >= 50 ? C.warning : C.error;
}

/**
 * Completion for one month: done ÷ every task assigned in it. Managers see the
 * whole visible scope, employees see their own tasks only.
 */
export function MonthProgressCard({ month, tasks }: { month: CompanyMonth; tasks: Task[] }) {
  const me = useMe();
  const { profiles } = useLookups();
  const [expanded, setExpanded] = useState(false);
  const showTeam = isLead(me) || me.role === "viewer";
  const scoped = showTeam ? tasks : tasks.filter((t) => t.task_assignees?.some((a) => a.user_id === me.id));
  const tally = tallyTasks(scoped);
  const members = showTeam ? memberTallies(scoped, profiles) : [];
  const shown = expanded ? members : members.slice(0, 6);
  const tone = percentTone(tally.percent);

  if (tally.total === 0) return null;

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <SectionLabel>{`إنجاز ${fmtMonth(month.period)}`}</SectionLabel>
          <T className="text-[12.5px] text-muted">
            {`${tally.done} من ${tally.total} مهمة مكتملة${showTeam ? "" : " (المسندة إليك)"}`}
          </T>
        </View>
        <View style={{ alignItems: "flex-end", gap: 1 }}>
          <T weight="bold" style={{ fontSize: 30, lineHeight: 38, color: tone, fontVariant: ["tabular-nums"] }}>
            {`${tally.percent}%`}
          </T>
          <T className="text-[10.5px] text-muted">نسبة الإنجاز</T>
        </View>
      </View>
      <ProgressBar value={tally.percent / 100} color={tone} height={10} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Pill label={`${tally.done} مكتملة`} tone="success" icon="check-circle" />
        <Pill label={`${tally.review} للمراجعة`} tone="warning" icon="inbox" />
        <Pill label={`${tally.open} مفتوحة`} tone="neutral" icon="circle" />
        <Pill label={`${tally.overdue} متأخرة`} tone={tally.overdue ? "error" : "neutral"} icon="alert-triangle" />
      </View>

      {showTeam && members.length ? (
        <View style={{ gap: 9, marginTop: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <SectionLabel className="flex-1">نسبة إنجاز الفريق</SectionLabel>
            <T className="text-[10.5px] text-muted">مكتمل / المسند</T>
          </View>
          {shown.map((m) => {
            const memberTone = percentTone(m.percent);
            return (
              <View key={m.user_id} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Avatar id={m.user_id} name={m.name} size={24} />
                  <T weight="semibold" className="flex-1 text-[12.5px]" numberOfLines={1}>
                    {m.name}
                  </T>
                  <T className="text-[11px] text-muted" style={{ fontVariant: ["tabular-nums"] }}>
                    {`${m.done}/${m.total}`}
                  </T>
                  <T weight="bold" style={{ fontSize: 12, width: 38, textAlign: "left", color: memberTone, fontVariant: ["tabular-nums"] }}>
                    {`${m.percent}%`}
                  </T>
                </View>
                <ProgressBar value={m.percent / 100} color={memberTone} height={5} />
              </View>
            );
          })}
          {members.length > 6 ? (
            <Tap onPress={() => setExpanded(!expanded)} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
              <Icon name={expanded ? "chevron-up" : "chevron-down"} size={13} color={C.primary} />
              <T weight="semibold" style={{ fontSize: 12, color: C.primary }}>
                {expanded ? "أقل" : `عرض ${members.length - 6} آخرين`}
              </T>
            </Tap>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
