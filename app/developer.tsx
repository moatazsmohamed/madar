import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OrbitDecor, Wordmark } from "@/components/madar/logo";
import { Button, C, ErrorBox, Field, Input, Loading, T } from "@/components/madar/ui";
import { useSession } from "@/lib/madar/session";
import { errorMessage, supabase } from "@/lib/supabase";

export default function DeveloperLoginScreen() {
  const { ready, session, profile } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return <Loading />;
  if (session && profile?.role === "developer") return <Redirect href="/companies" />;

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) return setError("أدخل البريد الإلكتروني وكلمة المرور");
    setBusy(true);
    const normalized = email.trim().toLowerCase();
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (err || !data.user) {
      setBusy(false);
      return setError(errorMessage(err));
    }
    const { data: row } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    setBusy(false);
    if (row?.role !== "developer") {
      await supabase.auth.signOut();
      return setError("هذا الحساب ليس حساب مطور");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.forest, overflow: "hidden" }}>
      <OrbitDecor size={820} opacity={0.1} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 24,
            paddingTop: insets.top + 32,
            paddingBottom: insets.bottom + 32,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ width: "100%", maxWidth: 430, gap: 22 }}>
            <View style={{ alignItems: "flex-start", gap: 14 }}>
              <Wordmark light size={26} />
              <View style={{ gap: 6 }}>
                <T weight="bold" style={{ color: "#F4F1EA", fontSize: 26, lineHeight: 40 }}>
                  دخول حساب المطور
                </T>
                <T style={{ color: "#C9D6CF", fontSize: 14, lineHeight: 24 }}>
                  الحساب الأم للمنصة: راجع طلبات الشركات وأضف شركات جديدة.
                </T>
              </View>
            </View>

            <View style={{ backgroundColor: C.surface, borderRadius: 22, padding: 20, gap: 16 }}>
              <Field label="بريد حساب المطور">
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="developer@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  style={{ textAlign: "left", writingDirection: "ltr" }}
                />
              </Field>
              <Field label="كلمة المرور">
                <View>
                  <Input
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!show}
                    placeholder="••••••••"
                    autoCapitalize="none"
                    onSubmitEditing={submit}
                    style={{ paddingStart: 64 }}
                  />
                  <Pressable
                    onPress={() => setShow(!show)}
                    style={{ position: "absolute", start: 10, top: 0, bottom: 0, justifyContent: "center" }}
                  >
                    <T weight="semibold" style={{ color: C.primary, fontSize: 12 }}>
                      {show ? "إخفاء" : "إظهار"}
                    </T>
                  </Pressable>
                </View>
              </Field>
              <ErrorBox message={error} />
              <Button title="دخول المطور" size="lg" onPress={submit} loading={busy} full />
            </View>

            <Pressable onPress={() => router.replace("/login")} style={{ alignSelf: "center" }}>
              <T weight="semibold" style={{ color: "#C9D6CF", fontSize: 13 }}>
                العودة لدخول العملاء
              </T>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
