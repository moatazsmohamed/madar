import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LogoMark, OrbitDecor, Wordmark } from "@/components/madar/logo";
import { Button, C, Card, ErrorBox, Field, InfoBox, Input, Loading, T, useIsWide } from "@/components/madar/ui";
import { useCompanyJoinInfo } from "@/lib/madar/queries";
import { useSession } from "@/lib/madar/session";
import { callAccounts, errorMessage, supabase } from "@/lib/supabase";

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = (Array.isArray(params.code) ? params.code[0] : params.code ?? "").trim().toLowerCase();
  const router = useRouter();
  const wide = useIsWide(860);
  const insets = useSafeAreaInsets();
  const { ready, session, profile } = useSession();
  const info = useCompanyJoinInfo(code || undefined);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 20,
            paddingTop: insets.top + 28,
            paddingBottom: insets.bottom + 28,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: "100%", maxWidth: wide ? 760 : 460, alignSelf: "center", gap: 16 }}>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Wordmark size={26} />
            </View>

            {info.isLoading || !ready ? (
              <Card>
                <Loading label="جارِ فتح رابط الدعوة…" />
              </Card>
            ) : !code || (!info.data && info.isSuccess) ? (
              <Card style={{ gap: 14 }}>
                <T weight="bold" style={{ fontSize: 20, lineHeight: 32 }}>
                  رابط الدعوة غير صحيح
                </T>
                <T className="text-[13px] text-muted">
                  تأكد من الرابط الذي أرسله لك مدير الشركة، أو اطلب منه إعادة إرساله.
                </T>
                <Button title="تسجيل الدخول" icon="log-in" onPress={() => router.replace("/login")} full />
              </Card>
            ) : (
              <>
                <JoinHero name={info.data!.name} />
                {session && profile ? (
                  <Card style={{ gap: 12 }}>
                    <T weight="bold" style={{ fontSize: 17, lineHeight: 28 }}>
                      أنت مسجّل الدخول بالفعل
                    </T>
                    <T className="text-[13px] text-muted">
                      الحساب الحالي: {profile.full_name} · {profile.email}
                    </T>
                    <Button title="افتح مساحتي" icon="arrow-left" onPress={() => router.replace("/dashboard")} full />
                  </Card>
                ) : info.data!.status !== "active" ? (
                  <Card style={{ gap: 12 }}>
                    <T weight="bold" style={{ fontSize: 18, lineHeight: 30 }}>
                      التسجيل مغلق حاليًا
                    </T>
                    <T className="text-[13px] text-muted">
                      «{info.data!.name}» لا تستقبل طلبات انضمام جديدة الآن. تواصل مع مدير الشركة.
                    </T>
                    <Button title="تسجيل الدخول بحساب موجود" variant="secondary" onPress={() => router.replace("/login")} full />
                  </Card>
                ) : (
                  <JoinForm companyName={info.data!.name} code={code} onDone={() => router.replace("/dashboard")} onLogin={() => router.replace("/login")} />
                )}
              </>
            )}

            {info.error ? <ErrorBox message={errorMessage(info.error)} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function JoinHero({ name }: { name: string }) {
  return (
    <View style={{ backgroundColor: C.forest, borderRadius: 24, padding: 26, overflow: "hidden", gap: 10 }}>
      <OrbitDecor size={360} opacity={0.14} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <LogoMark size={30} color="#8FD3B6" />
        <T weight="bold" style={{ color: "#F4F1EA", fontSize: 22, lineHeight: 34 }}>
          انضم إلى {name}
        </T>
      </View>
      <T style={{ color: "#C9D6CF", fontSize: 13.5, lineHeight: 24 }}>
        أنشئ حسابك في مدار، وسيصل طلبك إلى مدير الشركة لتفعيله. بعد التفعيل تظهر لك مهامك الشهرية فقط.
      </T>
    </View>
  );
}

function JoinForm({ companyName, code, onDone, onLogin }: { companyName: string; code: string; onDone: () => void; onLogin: () => void }) {
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("أدخل اسمك الكامل");
    if (!email.trim()) return setError("أدخل بريدك الإلكتروني");
    if (password.length < 8) return setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      await callAccounts({
        action: "register",
        join_code: code,
        email: normalized,
        password,
        full_name: name.trim(),
        job_title: jobTitle.trim(),
      });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (signInError) throw signInError;
      setNotice("تم إرسال طلبك، وسيُفعّله مدير الشركة.");
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <View style={{ gap: 3 }}>
        <T weight="bold" style={{ fontSize: 18, lineHeight: 30 }}>
          إنشاء حساب في {companyName}
        </T>
        <T className="text-[12.5px] text-muted">بعد إرسال البيانات سيُفعّل مدير الشركة حسابك.</T>
      </View>
      <InfoBox>استخدم بريدك الوظيفي. لو أضافك المدير مسبقًا بنفس البريد سيُفعّل حسابك فورًا.</InfoBox>
      <Field label="الاسم الكامل" required>
        <Input value={name} onChangeText={setName} placeholder="مثال: سارة أحمد" />
      </Field>
      <Field label="المسمى الوظيفي" hint="اختياري — يساعد مدير الشركة على تحديد القسم المناسب.">
        <Input value={jobTitle} onChangeText={setJobTitle} placeholder="مثال: محاسب" />
      </Field>
      <Field label="البريد الإلكتروني" required>
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="name@company.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          style={{ textAlign: "left", writingDirection: "ltr" }}
        />
      </Field>
      <Field label="كلمة المرور" hint="8 أحرف على الأقل" required>
        <Input value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" onSubmitEditing={submit} />
      </Field>
      <ErrorBox message={error} />
      {notice ? <InfoBox tone="success" icon="check-circle">{notice}</InfoBox> : null}
      <Button title="إرسال طلب الانضمام" size="lg" icon="user-plus" onPress={submit} loading={busy} full />
      <Pressable onPress={onLogin} style={{ alignSelf: "center" }}>
        <T weight="bold" style={{ color: C.primary, fontSize: 13 }}>
          لديّ حساب بالفعل
        </T>
      </Pressable>
    </Card>
  );
}
