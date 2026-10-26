import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LogoMark, OrbitDecor, Wordmark } from "@/components/madar/logo";
import { Button, C, ErrorBox, Field, InfoBox, Input, Loading, Select, T, useIsWide } from "@/components/madar/ui";
import { TIMEZONES } from "@/lib/madar/labels";
import { useSession } from "@/lib/madar/session";
import { callAccounts, errorMessage, supabase } from "@/lib/supabase";

type Mode = "login" | "register" | "setup";

export default function LoginScreen() {
  const { ready, session, profile } = useSession();
  const router = useRouter();
  const wide = useIsWide(860);
  const insets = useSafeAreaInsets();
  const status = useQuery({
    queryKey: ["workspace-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("workspace_status");
      if (error) throw error;
      return data as { has_developer: boolean; companies: number };
    },
  });
  const [mode, setMode] = useState<Mode>("login");

  useEffect(() => {
    if (status.data && !status.data.has_developer) setMode("setup");
  }, [status.data]);

  if (!ready) return <Loading />;
  if (session && profile) return <Redirect href={profile.role === "developer" ? "/companies" : "/dashboard"} />;

  const form = (
    <View style={{ width: "100%", maxWidth: 420, alignSelf: "center", gap: 18 }}>
      {!wide ? (
        <View style={{ alignItems: "flex-start", marginBottom: 6 }}>
          <Wordmark size={24} />
        </View>
      ) : null}
      {status.isLoading ? (
        <Loading label="جارِ التحقق من مساحة العمل…" />
      ) : mode === "setup" ? (
        <SetupForm onDone={() => status.refetch()} />
      ) : mode === "register" ? (
        <RegisterForm onBack={() => setMode("login")} />
      ) : (
        <LoginForm onRegister={() => setMode("register")} onDeveloper={() => router.push("/developer")} />
      )}
      {status.error ? <ErrorBox message={errorMessage(status.error)} /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: C.background }}>
      {wide ? <BrandPanel /> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingTop: insets.top + 32,
            paddingBottom: insets.bottom + 32,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {form}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function BrandPanel() {
  return (
    <View style={{ width: "44%", maxWidth: 560, backgroundColor: C.forest, padding: 48, justifyContent: "space-between", overflow: "hidden" }}>
      <OrbitDecor size={620} opacity={0.12} />
      <Wordmark light size={26} />
      <View style={{ gap: 14 }}>
        <T weight="bold" style={{ color: "#F4F1EA", fontSize: 38, lineHeight: 58 }}>
          كل التفاصيل،{"\n"}في مدار واحد.
        </T>
        <T style={{ color: "#C9D6CF", fontSize: 15, lineHeight: 26, maxWidth: 380 }}>
          الموظفون والمهام ووقت العمل الفعلي والمراجعات في مساحة واحدة واضحة، بصلاحيات تناسب كل دور في الشركة.
        </T>
      </View>
      <View style={{ flexDirection: "row", gap: 22 }}>
        {[
          ["users", "خمسة أدوار"],
          ["clock", "وقت فعلي"],
          ["check-circle", "مراجعة واعتماد"],
        ].map(([, label]) => (
          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#8FD3B6" }} />
            <T style={{ color: "#C9D6CF", fontSize: 13 }}>{label}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <T weight="bold" style={{ fontSize: 26, lineHeight: 40 }}>
        {title}
      </T>
      {subtitle ? <T className="text-[14px] text-muted">{subtitle}</T> : null}
    </View>
  );
}

function PasswordInput({ value, onChangeText, placeholder, onSubmit }: { value: string; onChangeText: (v: string) => void; placeholder?: string; onSubmit?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <View>
      <Input
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!show}
        placeholder={placeholder ?? "••••••••"}
        autoCapitalize="none"
        onSubmitEditing={onSubmit}
        style={{ paddingStart: 64 }}
      />
      <Pressable onPress={() => setShow(!show)} style={{ position: "absolute", start: 10, top: 0, bottom: 0, justifyContent: "center" }}>
        <T weight="semibold" style={{ color: C.primary, fontSize: 12 }}>
          {show ? "إخفاء" : "إظهار"}
        </T>
      </Pressable>
    </View>
  );
}

function LoginForm({ onRegister, onDeveloper }: { onRegister: () => void; onDeveloper: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("أدخل البريد الإلكتروني وكلمة المرور");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (err) setError(errorMessage(err));
  };

  return (
    <>
      <Heading title="تسجيل الدخول" subtitle="ادخل إلى حسابك في مدار" />
      <Field label="البريد الإلكتروني">
        <Input value={email} onChangeText={setEmail} placeholder="name@company.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" style={{ textAlign: "left", writingDirection: "ltr" }} />
      </Field>
      <Field label="كلمة المرور">
        <PasswordInput value={password} onChangeText={setPassword} onSubmit={submit} />
      </Field>
      <ErrorBox message={error} />
      <Button title="دخول" size="lg" onPress={submit} loading={busy} full />
      <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        <T className="text-muted">ليس لديك حساب؟</T>
        <Pressable onPress={onRegister}>
          <T weight="bold" style={{ color: C.primary }}>
            اطلب الانضمام
          </T>
        </Pressable>
      </View>
      <T className="text-center text-[12px] text-muted">نسيت كلمة المرور؟ اطلب من مدير الشركة أو مدير قسمك تعيين كلمة مرور جديدة.</T>
      <View style={{ height: 1, backgroundColor: C.border }} />
      <Pressable onPress={onDeveloper} style={{ alignSelf: "center" }}>
        <T weight="semibold" style={{ color: C.forest, fontSize: 13 }}>
          دخول حساب المطور
        </T>
      </Pressable>
    </>
  );
}

function RegisterForm({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<"company" | "join">("company");
  const [company, setCompany] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!company.trim()) return setError("أدخل اسم الشركة");
    if (!name.trim()) return setError("أدخل اسمك الكامل");
    if (!email.trim()) return setError("أدخل بريدك الإلكتروني");
    if (password.length < 8) return setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      const target = company.trim();
      const isCode = /^[a-z0-9]{6,32}$/i.test(target);
      await callAccounts(
        kind === "company"
          ? {
              action: "register_company",
              email: normalized,
              password,
              full_name: name.trim(),
              company_name: target,
              timezone,
            }
          : {
              action: "register",
              email: normalized,
              password,
              full_name: name.trim(),
              ...(isCode ? { join_code: target } : { company_name: target }),
            },
      );
      const { error: err } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (err) throw err;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Heading title={kind === "company" ? "تسجيل شركة جديدة" : "طلب الانضمام"} subtitle={kind === "company" ? "افتح مساحة شركتك في مدار" : "انضم إلى شركتك في مدار"} />
      <View style={{ flexDirection: "row", backgroundColor: C.sand, borderRadius: 12, padding: 3, gap: 3 }}>
        {(
          [
            ["company", "شركة جديدة"],
            ["join", "انضمام لشركة"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => {
              setKind(value);
              setError(null);
            }}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: 10,
              alignItems: "center",
              backgroundColor: kind === value ? C.surface : "transparent",
            }}
          >
            <T weight="semibold" style={{ color: kind === value ? C.forest : C.muted, fontSize: 12.5 }}>
              {label}
            </T>
          </Pressable>
        ))}
      </View>
      <InfoBox>
        {kind === "company"
          ? "أرسل بيانات شركتك، ويصل الطلب إلى حساب المطور للموافقة. بعد الموافقة تُنشأ الشركة وتدخلها كمدير شركة لها."
          : "إذا أضافك مدير الشركة مسبقًا بهذا البريد سيُفعّل حسابك فورًا، وإلا سيبقى بانتظار موافقة مدير الشركة."}
      </InfoBox>
      <Field label={kind === "company" ? "اسم الشركة" : "كود الدعوة أو اسم الشركة"} required>
        <Input
          value={company}
          onChangeText={setCompany}
          placeholder={kind === "company" ? "مثال: شركة النور للتجارة" : "الصق كود الدعوة من الرابط، أو اكتب اسم الشركة"}
        />
      </Field>
      {kind === "company" ? (
        <Field label="المنطقة الزمنية" hint="تُعرض كل الأوقات والتقارير وفق هذا التوقيت.">
          <Select
            value={timezone}
            onChange={(v) => setTimezone(v ?? "Africa/Cairo")}
            options={TIMEZONES.map((t) => ({ value: t.value, label: t.label, hint: t.value }))}
            title="المنطقة الزمنية"
          />
        </Field>
      ) : null}
      <Field label="الاسم الكامل" required>
        <Input value={name} onChangeText={setName} placeholder="مثال: سارة أحمد" />
      </Field>
      <Field label="البريد الإلكتروني" required>
        <Input value={email} onChangeText={setEmail} placeholder="name@company.com" autoCapitalize="none" keyboardType="email-address" style={{ textAlign: "left", writingDirection: "ltr" }} />
      </Field>
      <Field label="كلمة المرور" hint="8 أحرف على الأقل" required>
        <PasswordInput value={password} onChangeText={setPassword} onSubmit={submit} />
      </Field>
      <ErrorBox message={error} />
      <Button title={kind === "company" ? "إرسال طلب فتح الشركة" : "إرسال الطلب"} size="lg" onPress={submit} loading={busy} full />
      <Pressable onPress={onBack} style={{ alignSelf: "center" }}>
        <T weight="bold" style={{ color: C.primary }}>
          لديّ حساب، تسجيل الدخول
        </T>
      </Pressable>
    </>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("أدخل اسمك");
    if (!email.trim()) return setError("أدخل بريدك الإلكتروني");
    if (password.length < 8) return setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      await callAccounts({ action: "setup", email: normalized, password, full_name: name.trim() });
      const { error: err } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (err) throw err;
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <LogoMark size={28} />
        <T weight="semibold" className="text-primary">
          الخطوة الأولى
        </T>
      </View>
      <Heading title="إعداد حساب المطور" subtitle="الحساب الأم للنظام. منه تضيف الشركات وتفتح لكل شركة مدير نظام خاص بها." />
      <Field label="اسمك" required>
        <Input value={name} onChangeText={setName} placeholder="الاسم الكامل" />
      </Field>
      <Field label="البريد الإلكتروني" required>
        <Input value={email} onChangeText={setEmail} placeholder="developer@example.com" autoCapitalize="none" keyboardType="email-address" style={{ textAlign: "left", writingDirection: "ltr" }} />
      </Field>
      <Field label="كلمة المرور" hint="8 أحرف على الأقل" required>
        <PasswordInput value={password} onChangeText={setPassword} onSubmit={submit} />
      </Field>
      <ErrorBox message={error} />
      <Button title="إنشاء حساب المطور" size="lg" icon="arrow-left" onPress={submit} loading={busy} full />
    </>
  );
}
