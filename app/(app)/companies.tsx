import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
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
  T,
  useIsWide,
  useToast,
} from "@/components/madar/ui";
import { fmtRelative } from "@/lib/madar/format";
import { TIMEZONES } from "@/lib/madar/labels";
import { useCompanies, useCreateCompany, useProfiles, useReviewCompany } from "@/lib/madar/queries";
import { useSession } from "@/lib/madar/session";
import { errorMessage } from "@/lib/supabase";

export default function CompaniesScreen() {
  const { isDeveloper } = useSession();
  const wide = useIsWide();
  const companies = useCompanies(isDeveloper);
  const profiles = useProfiles();
  const create = useCreateCompany();
  const review = useReviewCompany();
  const toast = useToast();

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);

  const adminsByCompany = useMemo(() => {
    const map = new Map<string, string[]>();
    (profiles.data ?? [])
      .filter((p) => p.role === "admin" && p.company_id)
      .forEach((p) => {
        const list = map.get(p.company_id!) ?? [];
        list.push(p.full_name || p.email);
        map.set(p.company_id!, list);
      });
    return map;
  }, [profiles.data]);

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

  return (
    <Page title="الشركات" subtitle="حساب المطور: راجع طلبات فتح الشركات، وأضف الشركات وافتح لكل شركة نظامها الكامل بمدير خاص بها.">
      <View style={{ flexDirection: wide ? "row" : "column", gap: 16, alignItems: wide ? "flex-start" : "stretch" }}>
        <View style={{ flex: wide ? 1.1 : undefined, gap: 12 }}>
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
                      {admins.length ? `صاحب الطلب: ${admins.join("، ")}` : "صاحب الطلب غير محدد"}
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
              return (
                <Card key={company.id} style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <T weight="bold" style={{ fontSize: 16.5, lineHeight: 26, flex: 1 }}>
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
                    {admins.length ? `مدير النظام: ${admins.join("، ")}` : "لا يوجد مدير نظام بعد"}
                  </T>
                  <T className="text-[12px] text-muted">أُنشئت {fmtRelative(company.created_at)}</T>
                </Card>
              );
            })
          )}
        </View>

        <Card style={{ flex: wide ? 1 : undefined, gap: 12 }}>
          <SectionLabel>إضافة شركة مباشرة</SectionLabel>
          <InfoBox>تتجاوز هذه الطريقة انتظار الموافقة: عند الإنشاء يتكوّن حساب مدير نظام للشركة، ويسجّل الدخول به ليضيف الأقسام والموظفين.</InfoBox>
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
    </Page>
  );
}
