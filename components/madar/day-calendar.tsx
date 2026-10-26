import { useMemo } from "react";
import { View } from "react-native";
import { addDays, addMonths, daysBetween, fmtMonth, parseISODate, startOfMonth, startOfWeek, todayISO } from "@/lib/madar/format";
import type { CompanyDay, Task } from "@/lib/madar/types";
import { Chip, C, Icon, T, Tap, useIsWide } from "./ui";

const WEEKDAYS = ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];

export function DayCalendar({
  month,
  tasks,
  days,
  selected,
  onSelect,
}: {
  /** First day of the month (YYYY-MM-01). */
  month: string;
  tasks: Task[];
  days: CompanyDay[];
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const today = todayISO();
  const wide = useIsWide(760);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      const list = map.get(t.day) ?? [];
      list.push(t);
      map.set(t.day, list);
    });
    return map;
  }, [tasks]);

  const dayRows = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

  const gridStart = startOfWeek(startOfMonth(month));
  const span = Math.ceil((daysBetween(gridStart, addMonths(month, 1)) + 1) / 7) * 7;
  const cells = Array.from({ length: Math.min(42, span) }, (_, i) => addDays(gridStart, i));

  return (
    <View style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, flexWrap: "wrap" }}>
        <T weight="bold" style={{ flex: 1, minWidth: 120 }}>
          {fmtMonth(month)}
        </T>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Chip label="كل الشهر" active={selected === null} onPress={() => onSelect(null)} />
          <Chip label="اليوم" active={selected === today} onPress={() => onSelect(today)} />
        </View>
      </View>
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.sand }}>
        {WEEKDAYS.map((d) => (
          <View key={d} style={{ flex: 1, paddingVertical: 8, alignItems: "center" }}>
            <T weight="semibold" className="text-[11.5px] text-muted">
              {d}
            </T>
          </View>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7)).map((week) => (
        <View key={week[0]} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border }}>
          {week.map((day, i) => {
            const inMonth = day.slice(0, 7) === month.slice(0, 7);
            const items = byDay.get(day) ?? [];
            const row = dayRows.get(day);
            const closed = row?.status === "closed" || day < today;
            const isToday = day === today;
            const isSel = day === selected;
            const done = items.filter((t) => t.status === "done").length;
            const late = closed && items.some((t) => t.status !== "done");
            return (
              <Tap
                key={day}
                onPress={() => onSelect(day)}
                style={{
                  flex: 1,
                  minHeight: wide ? 88 : 56,
                  padding: wide ? 6 : 4,
                  gap: 3,
                  borderLeftWidth: i === 6 ? 0 : 1,
                  borderLeftColor: C.border,
                  backgroundColor: isSel ? C["primary-soft"] : inMonth && closed ? C.sand : inMonth ? C.surface : C.background,
                  borderWidth: isSel ? 1.5 : 0,
                  borderColor: isSel ? C.primary : "transparent",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View
                    style={{
                      minWidth: 22,
                      height: 22,
                      borderRadius: 11,
                      paddingHorizontal: 4,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isToday ? C.primary : "transparent",
                    }}
                  >
                    <T weight={isToday ? "bold" : "medium"} style={{ fontSize: 12, color: isToday ? "#fff" : inMonth ? C.foreground : C.muted + "88" }}>
                      {parseISODate(day).getUTCDate()}
                    </T>
                  </View>
                  {closed && items.length ? <Icon name="lock" size={10} color={late ? C.error : C.muted} /> : null}
                  <View style={{ flex: 1 }} />
                  {items.length ? (
                    <View style={{ backgroundColor: late ? C["error-soft"] : C["primary-soft"], borderRadius: 999, paddingHorizontal: 5, paddingVertical: 0.5 }}>
                      <T weight="semibold" style={{ fontSize: 10.5, color: late ? C.error : C.primary, fontVariant: ["tabular-nums"] }}>
                        {done}/{items.length}
                      </T>
                    </View>
                  ) : null}
                </View>
                {wide ? (
                  <>
                    {items.slice(0, 2).map((t) => (
                      <View
                        key={t.id}
                        style={{
                          backgroundColor: t.status === "done" ? C.sand : closed ? C["error-soft"] : C["primary-soft"],
                          borderRadius: 6,
                          paddingHorizontal: 5,
                          paddingVertical: 1,
                        }}
                      >
                        <T numberOfLines={1} style={{ fontSize: 10.5, color: t.status === "done" ? C.muted : closed ? C.error : C.primary }}>
                          {t.title}
                        </T>
                      </View>
                    ))}
                    {items.length > 2 ? <T className="text-[10.5px] text-muted">+{items.length - 2} أخرى</T> : null}
                  </>
                ) : items.length ? (
                  <View style={{ flexDirection: "row", gap: 2, flexWrap: "wrap" }}>
                    {items.slice(0, 4).map((t) => (
                      <View key={t.id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.status === "done" ? C.muted : closed ? C.error : C.primary }} />
                    ))}
                  </View>
                ) : null}
              </Tap>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap", padding: 10, borderTopWidth: 1, borderTopColor: C.border }}>
        <Legend color={C.primary} label="يوم مفتوح" />
        <Legend color={C.muted} label="مغلق/مؤرشف" />
        <Legend color={C.error} label="مهام متأخرة" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <T className="text-[11.5px] text-muted">{label}</T>
    </View>
  );
}
