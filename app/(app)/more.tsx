import { useRouter } from "expo-router";
import { View } from "react-native";
import { Page } from "@/components/madar/shell";
import { Avatar, C, Icon, T, Tap, useToast, type IconName } from "@/components/madar/ui";
import { ROLE_LABELS } from "@/lib/madar/labels";
import { useNotifications } from "@/lib/madar/queries";
import { useMe, useSession } from "@/lib/madar/session";
import { errorMessage } from "@/lib/supabase";

export default function MoreScreen() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const { signOut, company, isDeveloper, inCompany, exitCompany } = useSession();
  const unread = (useNotifications().data ?? []).filter((n) => !n.read_at).length;
  const seesCompany = me.role === "admin" || me.role === "manager" || me.role === "supervisor" || me.role === "viewer";
  const items: { href: string; label: string; hint: string; icon: IconName; badge?: number }[] = [
    { href: "/notifications", label: "الإشعارات", hint: "الإسنادات والمراجعات والتعليقات", icon: "bell", badge: unread },
    { href: "/reports", label: "التقارير", hint: "الساعات الفعلية والإنجاز والتصدير", icon: "bar-chart-2" },
    ...(seesCompany
      ? [{ href: "/departments", label: "الأقسام", hint: "هيكل الشركة وحمل العمل", icon: "layers" as IconName }]
      : []),
    { href: "/settings", label: "الإعدادات", hint: "حسابي وإعدادات الشركة", icon: "settings" },
  ];

  const leaveCompany = async () => {
    try {
      await exitCompany();
      router.replace("/companies" as any);
    } catch (e) {
      toast.show(errorMessage(e), "error");
    }
  };

  return (
    <Page title="المزيد">
      <Tap
        onPress={() => router.push(`/team/${me.id}` as any)}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.forest, borderRadius: 18, padding: 16, marginBottom: 16 }}
      >
        <Avatar id={me.id} name={me.full_name} size={48} />
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ color: "#F4F1EA", fontSize: 16 }}>
            {me.full_name}
          </T>
          <T style={{ color: "#C9D6CF", fontSize: 12.5 }}>
            {isDeveloper ? `حساب المطور${company ? ` · ${company.name}` : ""}` : `${ROLE_LABELS[me.role]} · ${company?.name ?? ""}`}
          </T>
        </View>
        <Icon name="chevron-left" color="#C9D6CF" />
      </Tap>
      <View style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: "hidden" }}>
        {items.map((it, i) => (
          <Tap
            key={it.href}
            onPress={() => router.push(it.href as any)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C["primary-soft"], alignItems: "center", justifyContent: "center" }}>
              <Icon name={it.icon} size={17} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <T weight="semibold">{it.label}</T>
              <T className="text-[12px] text-muted">{it.hint}</T>
            </View>
            {it.badge ? (
              <View style={{ minWidth: 22, height: 20, borderRadius: 10, backgroundColor: C.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }}>
                <T weight="bold" style={{ color: "#fff", fontSize: 11, lineHeight: 16 }}>
                  {it.badge}
                </T>
              </View>
            ) : null}
            <Icon name="chevron-left" size={16} color={C.muted} />
          </Tap>
        ))}
      </View>
      {isDeveloper && inCompany ? (
        <View style={{ backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: "hidden", marginTop: 12 }}>
          <Tap
            onPress={leaveCompany}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C["primary-soft"], alignItems: "center", justifyContent: "center" }}>
              <Icon name="log-out" size={17} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <T weight="semibold">الخروج إلى حساب المطور</T>
              <T className="text-[12px] text-muted">إنهاء العمل داخل {company?.name ?? "الشركة"} والعودة لقائمة الشركات</T>
            </View>
            <Icon name="chevron-left" size={16} color={C.muted} />
          </Tap>
        </View>
      ) : null}
      <Tap onPress={signOut} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16, marginTop: 12 }}>
        <Icon name="log-out" size={17} color={C.error} />
        <T weight="semibold" style={{ color: C.error }}>
          تسجيل الخروج
        </T>
      </Tap>
    </Page>
  );
}
