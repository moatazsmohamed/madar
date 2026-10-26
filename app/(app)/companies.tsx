import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { Page } from "@/components/madar/shell";
import {
  Button,
  C,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  InfoBox,
  Input,
  Pill,
  SectionLabel,
  Select,
  Sheet,
  T,
  confirmAction,
  useIsWide,
  useToast,
} from "@/components/madar/ui";
import { fmtMinutes, fmtRelative } from "@/lib/madar/format";
import { TIMEZONES } from "@/lib/madar/labels";
import { copyText, joinUrl } from "@/lib/madar/links";
import {
  useCompanies,
  useCreateCompany,
  useDeveloperStats,
  useProfiles,
  useRegenerateJoinCode,
  useResetPassword,
  useReviewCompany,
  useSetCompanyStatus,
} from "@/lib/madar/queries";
import { useSession } from "@/lib/madar/session";
import type { DeveloperCompanyStats } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";

type CompanyAdmin = { id: string; full_name: string; email: string };

export default function CompaniesScreen() {
  const { isDeveloper } = useSession();
  const router = useRouter();
  const wide = useIsWide();
  const companies = useCompanies(isDeveloper);
  const stats = useDeveloperStats(isDeveloper);
  const profiles = useProfiles();
  const create = useCreateCompany();
  const review = useReviewCompany();
  const setStatus = useSetCompanyStatus();
  const regenerate = useRegenerateJoinCode();
  const toast = useToast();

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<{ companyId: string; admins: CompanyAdmin[] } | null>(null);

  const adminsByCompany = useMemo(() => {
    const map = new Map<string, CompanyAdmin[]>();
    (profiles.data ?? [])
      .filter((p) => p.role === "admin" && p.company_id)
      .forEach((p) => {
        const list = map.get(p.company_id!) ?? [];
        list.push({ id: p.id, full_name: p.full_name || p.email, email: p.email });
        map.set(p.company_id!, list);
      });
    return map;
  }, [profiles.data]);

  const statsById = useMemo(() => {
    const map = new Map<string, DeveloperCompanyStats>();
    (stats.data ?? []).forEach((row) => map.set(row.company_id, row));
    return map;
  }, [stats.data]);

  if (!isDeveloper) return <Redirect href="/dashboard" />;

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("أدخل اسم الشركة");
    if (!adminName.trim()) return setError("أدخل اسم مدير الشركة");
    if (!adminEmail.trim()) return setError("أدخل بريد مدير الشركة");
    if (adminPassword.length < 8) return setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    create.mutate(
      {
        name: name.trim(),
        timezone,
        admin_name: adminName.trim(),
        admin_email: adminEmail.trim().toLowerCase(),
        admin_password: adminPassword,
      },
      {
        onSuccess: () => {
          toast.show("أُنشئت الشركة وحساب مديرها");
          setName("");
          setAdminName("");
          setAdminEmail("");
          setAdminPassword("");
          setTimezone("Africa/Cairo");
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  const list = companies.data ?? [];
  const pending = list.filter((c) => c.status === "pending");
  const approved = list.filter((c) => c.status !== "pending");

  const decide = (companyId: string, decision: "approve" | "reject") => {
    review.mutate(
      { company_id: companyId, decision },
      {
        onSuccess: () => {
          setConfirmReject(null);
          toast.show(decision === "approve" ? "تمت الموافقة على الشركة وتفعيل حساب مديرها" : "تم رفض الطلب وحذفه");
        },
        onError: (e) => toast.show(errorMessage(e), "error"),
      },
    );
  };

  const copyJoin = async (code: string) => {
    try {
      await copyText(joinUrl(code));
      toast.show("تم نسخ رابط دعوة الموظفين");
    } catch {
      toast.show("تعذّر نسخ الرابط", "error");
    }
  };

  const toggleStatus = async (companyId: string, status: "active" | "suspended") => {
    const next = status === "active" ? "suspended" : "active";
    const ok = await confirmAction(
      next === "suspended"
        ? "إيقاف هذه الشركة؟ لن يستطيع أعضاؤها الدخول أو التسجيل من رابط الدعوة حتى تعيد تفعيلها."
        : "إعادة تفعيل هذه الشركة؟",
      next === "suspended" ? "إيقاف الشركة" : "تفعيل الشركة",
    );
    if (!ok) return;
    setStatus.mutate(
      { company_id: companyId, status: next },
      {
        onSuccess: () => toast.show(next === "suspended" ? "تم إيقاف الشركة" : "تم تفعيل الشركة"),
        onError: (e) => toast.show(errorMessage(e), "error"),
      },
    );
  };

  const reissue = async (company: { id: string; join_code: string }) => {
    const ok = await confirmAction("إعادة توليد كود الدعوة؟ سيتوقف الرابط القديم فورًا.", "كود جديد");
    if (!ok) return;
    regenerate.mutate(company.id, {
      onSuccess: (code) => toast.show(`كود الدعوة الجديد: ${code}`),
      onError: (e) => toast.show(errorMessage(e), "error"),
    });
  };

  return (
    <Page title="الشركات" subtitle="حساب المطور: كل الشركات في مكان واحد — روابط الدعوة، التقارير، وحالة كل شركة.">
      <View style={{ flexDirection: wide ? "row" : "column", gap: 16, alignItems: wide ? "flex-start" : "stretch" }}>
        <View style={{ flex: wide ? 1.25 : undefined, gap: 12 }}>
          {pending.length ? (
            <>
              <SectionLabel>طلبات فتح شركات ({pending.length})</SectionLabel>
              {pending.map((company) => {
                const admins = adminsByCompany.get(company.id) ?? [];
                return (
                  <Card key={company.id} style={{ gap: 10, borderColor: C.warning }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <T weight="bold" style={{ fontSize: 16.5, lineHeight: 26, flex: 1 }}>
                        {company.name}
                      </T>
                      <Pill label="بانتظار الموافقة" tone="warning" dot />
                    </View>
                    <T className="text-[12.5px] text-muted">
                      {admins.length ? `صاحب الطلب: ${admins.map((a) => a.full_name).join("، ")}` : "صاحب الطلب غير محدد"}
                      {" · "}
                      {TIMEZONES.find((t) => t.value === company.timezone)?.label ?? company.timezone}
                    </T>
                    <T className="text-[12px] text-muted">أُرسل {fmtRelative(company.created_at)}</T>
                    {confirmReject === company.id ? (
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                        <Button
                          title="تأكيد الرفض"
                          icon="trash-2"
                          variant="danger"
                          size="sm"
                          loading={review.isPending}
                          onPress={() => decide(company.id, "reject")}
                        />
                        <Button title="إلغاء" variant="ghost" size="sm" onPress={() => setConfirmReject(null)} />
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                        <Button
                          title="موافقة وتفعيل"
                          icon="check"
                          size="sm"
                          loading={review.isPending}
                          onPress={() => decide(company.id, "approve")}
                        />
                        <Button title="رفض" variant="danger" size="sm" onPress={() => setConfirmReject(company.id)} />
                      </View>
                    )}
                  </Card>
                );
              })}
              <View style={{ height: 6 }} />
            </>
          ) : null}
          <SectionLabel>الشركات المسجّلة {approved.length ? `(${approved.length})` : ""}</SectionLabel>
          {companies.isLoading ? (
            <Card>
              <T className="text-muted">جارِ التحميل…</T>
            </Card>
          ) : approved.length === 0 ? (
            <EmptyState icon="layers" title="لا توجد شركات بعد" hint="ستظهر طلبات العملاء هنا للموافقة، أو أضف شركة مباشرة من النموذج المجاور." />
          ) : (
            approved.map((company) => {
              const admins = adminsByCompany.get(company.id) ?? [];
              const stat = statsById.get(company.id);
              return (
                <Card key={company.id} style={{ gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <T weight="bold" style={{ fontSize: 17, lineHeight: 27, flex: 1 }}>
                      {company.name}
                    </T>
                    <Pill
                      label={company.status === "active" ? "نشطة" : "موقوفة"}
                      tone={company.status === "active" ? "primary" : "error"}
                      dot
                    />
                  </View>
                  <T className="text-[12.5px] text-muted">
                    {TIMEZONES.find((t) => t.value === company.timezone)?.label ?? company.timezone}
                    {" · "}
                    {admins.length ? `مدير الشركة: ${admins.map((a) => a.full_name).join("، ")}` : "لا يوجد مدير شركة بعد"}
                    {" · "}
                    أُنشئت {fmtRelative(company.created_at)}
                  </T>

                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <MiniStat label="أعضاء نشطون" value={stat ? `${stat.active_members}/${stat.members}` : "—"} />
                    <MiniStat label="أقسام" value={stat ? String(stat.departments) : "—"} />
                    <MiniStat label="مهام مفتوحة" value={stat ? String(stat.open_tasks) : "—"} />
                    <MiniStat label="بانتظار المراجعة" value={stat ? String(stat.review_tasks) : "—"} />
                    <MiniStat label="متأخرة" value={stat ? String(stat.overdue_tasks) : "—"} color={stat && stat.overdue_tasks ? C.error : undefined} />
                    <MiniStat label="وقت مسجّل" value={stat ? fmtMinutes(stat.minutes) : "—"} />
                  </View>

                  <View style={{ gap: 6 }}>
                    <T weight="semibold" className="text-[12px] text-muted">
                      رابط دعوة الموظفين
                    </T>
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <View style={{ flex: 1, minWidth: 200 }}>
                        <Input
                          value={joinUrl(company.join_code)}
                          editable={false}
                          style={{ textAlign: "left", writingDirection: "ltr", fontSize: 12.5 }}
                        />
                      </View>
                      <Button title="نسخ" icon="copy" size="sm" variant="secondary" onPress={() => copyJoin(company.join_code)} />
                      {Platform.OS === "web" ? (
                        <Button
                          title="فتح"
                          icon="external-link"
                          size="sm"
                          variant="ghost"
                          onPress={() => window.open(joinUrl(company.join_code), "_blank", "noopener,noreferrer")}
                        />
                      ) : null}
                      <Button title="كود جديد" icon="refresh-cw" size="sm" variant="ghost" loading={regenerate.isPending} onPress={() => reissue(company)} />
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Button
                      title="تقرير الشركة"
                      icon="bar-chart-2"
                      size="sm"
                      variant="secondary"
                      onPress={() => router.push(`/company-reports?company=${company.id}`)}
                    />
                    <Button
                      title="كلمة مرور المدير"
                      icon="key"
                      size="sm"
                      variant="ghost"
                      disabled={!admins.length}
                      onPress={() => setPasswordFor({ companyId: company.id, admins })}
                    />
                    <Button
                      title={company.status === "active" ? "إيقاف الشركة" : "تفعيل الشركة"}
                      icon={company.status === "active" ? "pause-circle" : "play-circle"}
                      size="sm"
                      variant={company.status === "active" ? "danger" : "secondary"}
                      loading={setStatus.isPending}
                      onPress={() => toggleStatus(company.id, company.status === "active" ? "active" : "suspended")}
                    />
                  </View>
                  {stat?.last_activity ? <T className="text-[11.5px] text-muted">آخر نشاط على المنصة {fmtRelative(stat.last_activity)}</T> : null}
                </Card>
              );
            })
          )}
        </View>

        <Card style={{ flex: wide ? 1 : undefined, gap: 12 }}>
          <SectionLabel>إضافة شركة مباشرة</SectionLabel>
          <InfoBox>تتجاوز هذه الطريقة انتظار الموافقة: عند الإنشاء يتكوّن حساب مدير الشركة، ويسجّل الدخول به ليضيف الأقسام والموظفين ويشارك رابط الدعوة.</InfoBox>
          <Field label="اسم الشركة" required>
            <Input value={name} onChangeText={setName} placeholder="مثال: شركة النور للتجارة" />
          </Field>
          <Field label="المنطقة الزمنية">
            <Select
              value={timezone}
              onChange={(v) => setTimezone(v ?? "Africa/Cairo")}
              options={TIMEZONES.map((t) => ({ value: t.value, label: t.label, hint: t.value }))}
              title="المنطقة الزمنية"
            />
          </Field>
          <View style={{ height: 1, backgroundColor: C.border, marginVertical: 2 }} />
          <Field label="اسم مدير الشركة" required>
            <Input value={adminName} onChangeText={setAdminName} placeholder="الاسم الكامل" />
          </Field>
          <Field label="بريد مدير الشركة" required>
            <Input
              value={adminEmail}
              onChangeText={setAdminEmail}
              placeholder="admin@company.com"
              autoCapitalize="none"
              keyboardType="email-address"
              style={{ textAlign: "left", writingDirection: "ltr" }}
            />
          </Field>
          <Field label="كلمة مرور المدير" hint="8 أحرف على الأقل — سلّمها للمدير ليغيّرها بعد الدخول" required>
            <Input value={adminPassword} onChangeText={setAdminPassword} secureTextEntry placeholder="••••••••" />
          </Field>
          <ErrorBox message={error} />
          <Button title="إنشاء الشركة" icon="plus" onPress={submit} loading={create.isPending} full />
        </Card>
      </View>

      <AdminPasswordSheet target={passwordFor} onClose={() => setPasswordFor(null)} />
    </Page>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View
      style={{
        flexGrow: 1,
        minWidth: 86,
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

function AdminPasswordSheet({ target, onClose }: { target: { companyId: string; admins: CompanyAdmin[] } | null; onClose: () => void }) {
  const reset = useResetPassword();
  const toast = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    setUserId(null);
    setPassword("");
    onClose();
  };

  const submit = () => {
    setError(null);
    const id = userId ?? target?.admins[0]?.id ?? null;
    if (!id) return setError("اختر مدير الشركة");
    if (password.length < 8) return setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    reset.mutate(
      { user_id: id, password },
      {
        onSuccess: () => {
          toast.show("تم تحديث كلمة مرور المدير");
          close();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Sheet
      visible={!!target}
      onClose={close}
      title="كلمة مرور مدير الشركة"
      subtitle="استخدمها إذا فقد المدير الوصول لحسابه، وسلّمها له بطريقة آمنة."
      footer={
        <>
          <Button title="تحديث كلمة المرور" icon="key" onPress={submit} loading={reset.isPending} />
          <Button title="إلغاء" variant="ghost" onPress={close} />
        </>
      }
    >
      {target && target.admins.length > 1 ? (
        <Field label="مدير الشركة" required>
          <Select
            value={userId ?? target.admins[0].id}
            onChange={(v) => setUserId(v)}
            options={target.admins.map((a) => ({ value: a.id, label: a.full_name, hint: a.email }))}
            title="مدير الشركة"
          />
        </Field>
      ) : target?.admins[0] ? (
        <InfoBox>{target.admins[0].full_name} · {target.admins[0].email}</InfoBox>
      ) : null}
      <Field label="كلمة المرور الجديدة" hint="8 أحرف على الأقل" required>
        <Input value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" onSubmitEditing={submit} />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
}
