import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { Page } from "@/components/madar/shell";
import { Button, C, Card, Chip, EmptyState, ErrorBox, Loading, Pill, SearchInput, SectionLabel, T, useIsWide, useToast } from "@/components/madar/ui";
import { exportCSV, toCSV } from "@/lib/madar/csv";
import { fmtMinutes, fmtRelative } from "@/lib/madar/format";
import { TIMEZONES } from "@/lib/madar/labels";
import { copyText, joinUrl } from "@/lib/madar/links";
import { useDeveloperStats } from "@/lib/madar/queries";
import { useSession } from "@/lib/madar/session";
import type { DeveloperCompanyStats } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

type StatusFilter = "all" | "active" | "suspended";

const STATUS_LABEL: Record<DeveloperCompanyStats["status"], string> = {
  active: "نشطة",
  suspended: "موقوفة",
  pending: "بانتظار الموافقة",
};

function tzLabel(tz: string) {
  return TIMEZONES.find((t) => t.value === tz)?.label ?? tz;
}

export default function CompanyReportsScreen() {
  const { isDeveloper } = useSession();
  const { company: focusId } = useLocalSearchParams<{ company?: string }>();
  const router = useRouter();
  const wide = useIsWide();
  const toast = useToast();
  const stats = useDeveloperStats(isDeveloper);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const all = useMemo(() => stats.data ?? [], [stats.data]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((c) => status === "all" || c.status === status)
      .filter((c) => !term || c.name.toLowerCase().includes(term))
      .sort((a, b) => {
        if (a.company_id === focusId) return -1;
        if (b.company_id === focusId) return 1;
        return b.active_members - a.active_members || a.name.localeCompare(b.name, "ar");
      });
  }, [all, q, status, focusId]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, c) => ({
          companies: acc.companies + 1,
          activeMembers: acc.activeMembers + c.active_members,
          members: acc.members + c.members,
          open: acc.open + c.open_tasks,
          review: acc.review + c.review_tasks,
          done: acc.done + c.done_tasks,
          overdue: acc.overdue + c.overdue_tasks,
          minutes: acc.minutes + c.minutes,
        }),
        { companies: 0, activeMembers: 0, members: 0, open: 0, review: 0, done: 0, overdue: 0, minutes: 0 },
      ),
    [rows],
  );

  if (!isDeveloper) return <Redirect href="/dashboard" />;

  const focused = focusId ? all.find((c) => c.company_id === focusId) : null;

  const exportReport = () => {
    const body = rows.map((c) => [
      c.name,
      STATUS_LABEL[c.status],
      tzLabel(c.timezone),
      c.members,
      c.active_members,
      c.departments,
      c.open_tasks,
      c.review_tasks,
      c.done_tasks,
      c.overdue_tasks,
      Math.round((c.minutes / 60) * 10) / 10,
      c.last_activity ? c.last_activity.slice(0, 10) : "",
      joinUrl(c.join_code),
    ]);
    exportCSV(
      `madar-companies-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(
        ["الشركة", "الحالة", "المنطقة الزمنية", "الأعضاء", "النشطون", "الأقسام", "مهام مفتوحة", "بانتظار المراجعة", "مكتملة", "متأخرة", "ساعات مسجّلة", "آخر نشاط", "رابط الدعوة"],
        body,
      ),
    );
    toast.show("صُدّر تقرير الشركات");
  };

  const copyJoin = async (code: string) => {
    try {
      await copyText(joinUrl(code));
      toast.show("تم نسخ رابط دعوة الموظفين");
    } catch {
      toast.show("تعذّر نسخ الرابط", "error");
    }
  };

  return (
    <Page
      title="تقارير الشركات"
      subtitle="حساب المطور: نظرة موحّدة على كل شركة على حدة — الفريق، المهام، الوقت، وحالة الحساب."
      actions={<Button title="تصدير CSV" icon="download" variant="secondary" onPress={exportReport} disabled={!rows.length} />}
    >
      {focused ? (
        <Card style={{ gap: 8, marginBottom: 16, borderColor: C.primary, backgroundColor: C["primary-soft"] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <T weight="bold" className="flex-1 text-[15px]">
              تعرض الآن تقرير: {focused.name}
            </T>
            <Pill label={STATUS_LABEL[focused.status]} tone={focused.status === "active" ? "primary" : focused.status === "suspended" ? "error" : "warning"} dot />
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button title="إدارة الشركة" icon="settings" size="sm" onPress={() => router.push("/companies")} />
            <Button title="عرض كل الشركات" icon="x" size="sm" variant="ghost" onPress={() => router.replace("/company-reports")} />
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: wide ? "row" : "column", gap: 10, marginBottom: 16 }}>
        <SearchInput value={q} onChangeText={setQ} placeholder="ابحث باسم الشركة…" />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label="الكل" active={status === "all"} onPress={() => setStatus("all")} />
          <Chip label="النشطة" active={status === "active"} onPress={() => setStatus("active")} />
          <Chip label="الموقوفة" active={status === "suspended"} onPress={() => setStatus("suspended")} />
        </View>
      </View>

      {stats.isLoading ? (
        <Loading />
      ) : stats.error ? (
        <ErrorBox message={errorMessage(stats.error)} />
      ) : all.length === 0 ? (
        <EmptyState icon="bar-chart-2" title="لا توجد شركات بعد" hint="أنشئ شركة من صفحة الشركات، وستظهر بياناتها وتقاريرها هنا." />
      ) : (
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <Kpi label="الشركات" value={String(totals.companies)} hint={status === "all" ? `${all.filter((c) => c.status === "active").length} نشطة` : `تصفية: ${status === "active" ? "النشطة" : "الموقوفة"}`} />
            <Kpi label="أعضاء نشطون" value={String(totals.activeMembers)} hint={`من ${totals.members} حساب`} />
            <Kpi label="مهام مفتوحة" value={String(totals.open)} hint={`${totals.review} بانتظار المراجعة`} />
            <Kpi label="مهام متأخرة" value={String(totals.overdue)} hint={`${totals.done} مكتملة`} color={totals.overdue ? C.error : undefined} />
            <Kpi label="وقت مسجّل" value={fmtMinutes(totals.minutes)} hint="كل الفترات" />
          </View>

          {rows.length === 0 ? (
            <EmptyState icon="search" title="لا توجد شركات مطابقة" hint="جرّب تغيير البحث أو التصفية." />
          ) : (
            <View style={{ gap: 12 }}>
              <SectionLabel>تفصيل الشركات · {rows.length}</SectionLabel>
              {rows.map((company) => (
                <CompanyRow
                  key={company.company_id}
                  company={company}
                  focused={company.company_id === focusId}
                  onCopy={() => copyJoin(company.join_code)}
                  onManage={() => router.push(`/company-reports?company=${company.company_id}`)}
                />
              ))}
            </View>
          )}
        </View>
      )}
    </Page>
  );
}

function CompanyRow({
  company,
  focused,
  onCopy,
  onManage,
}: {
  company: DeveloperCompanyStats;
  focused: boolean;
  onCopy: () => void;
  onManage: () => void;
}) {
  return (
    <Card style={{ gap: 12, borderColor: focused ? C.primary : undefined }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <T weight="bold" style={{ fontSize: 16.5, lineHeight: 26, flex: 1, minWidth: 160 }}>
          {company.name}
        </T>
        <Pill
          label={STATUS_LABEL[company.status]}
          tone={company.status === "active" ? "primary" : company.status === "suspended" ? "error" : "warning"}
          dot
        />
      </View>
      <T className="text-[12.5px] text-muted">
        {tzLabel(company.timezone)} · {company.active_members} من {company.members} عضو نشط · {company.departments} قسم
        {company.last_activity ? ` · آخر نشاط ${fmtRelative(company.last_activity)}` : ""}
      </T>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Metric label="مفتوحة" value={String(company.open_tasks)} />
        <Metric label="بانتظار المراجعة" value={String(company.review_tasks)} />
        <Metric label="مكتملة" value={String(company.done_tasks)} />
        <Metric label="متأخرة" value={String(company.overdue_tasks)} color={company.overdue_tasks ? C.error : undefined} />
        <Metric label="وقت مسجّل" value={fmtMinutes(company.minutes)} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button title="تفاصيل الشركة" icon="maximize-2" size="sm" variant={focused ? "soft" : "secondary"} onPress={onManage} />
        <Button title="نسخ رابط الدعوة" icon="link" size="sm" variant="ghost" onPress={onCopy} />
        <T className="text-[11.5px] text-muted" style={{ writingDirection: "ltr" }}>
          {company.join_code}
        </T>
      </View>
    </Card>
  );
}

function Kpi({ label, value, hint, color }: { label: string; value: string; hint: string; color?: string }) {
  return (
    <View style={{ flexBasis: 190, flexGrow: 1, backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 4 }}>
      <T weight="semibold" className="text-[12.5px] text-muted">
        {label}
      </T>
      <T weight="bold" style={{ fontSize: 28, lineHeight: 40, color: color ?? C.foreground, fontVariant: ["tabular-nums"] }}>
        {value}
      </T>
      <T className="text-[11.5px] text-muted">{hint}</T>
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View
      style={{
        flexGrow: 1,
        minWidth: 96,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 10,
        gap: 2,
      }}
    >
      <T weight="bold" style={{ fontSize: 17, lineHeight: 26, color: color ?? C.foreground, fontVariant: ["tabular-nums"] }}>
        {value}
      </T>
      <T className="text-[11px] text-muted">{label}</T>
    </View>
  );
}
