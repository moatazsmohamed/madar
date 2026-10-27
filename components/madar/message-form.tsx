import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSendMemberMessage } from "@/lib/madar/queries";
import type { MessageKind, Profile } from "@/lib/madar/types";
import { errorMessage } from "@/lib/supabase";
import { Button, C, ErrorBox, Field, InfoBox, Input, Segmented, Sheet, T, useToast } from "./ui";

export function SendMessageSheet({
  visible,
  onClose,
  member,
  initialKind = "message",
}: {
  visible: boolean;
  onClose: () => void;
  member: Profile | null;
  initialKind?: MessageKind;
}) {
  const send = useSendMemberMessage();
  const toast = useToast();
  const [kind, setKind] = useState<MessageKind>(initialKind);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setKind(initialKind);
      setBody("");
      setError(null);
    }
  }, [visible, initialKind]);

  if (!member) return null;

  const submit = () => {
    setError(null);
    const text = body.trim();
    if (!text) return setError("اكتب نص الرسالة");
    if (text.length > 2000) return setError("الرسالة أطول من 2000 حرف");
    send.mutate(
      { userId: member.id, kind, body: text },
      {
        onSuccess: () => {
          toast.show(kind === "warning" ? `أُرسل التحذير إلى ${member.full_name}` : `أُرسلت الرسالة إلى ${member.full_name}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={kind === "warning" ? "إرسال تحذير" : "إرسال رسالة"}
      subtitle={member.full_name}
      footer={
        <>
          <Button
            title={kind === "warning" ? "إرسال التحذير" : "إرسال الرسالة"}
            icon="send"
            onPress={submit}
            loading={send.isPending}
          />
          <Button title="إلغاء" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "message", label: "رسالة", icon: "message-circle" },
          { value: "warning", label: "تحذير", icon: "alert-triangle" },
        ]}
      />
      <Field label="نص الرسالة" required hint="تظهر للعضو في صفحة الإشعارات، وتصل داخل التطبيق مباشرة.">
        <Input
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={2000}
          placeholder={kind === "warning" ? "اكتب سبب التحذير والمطلوب تصحيحه…" : "اكتب رسالتك للعضو…"}
          style={{ minHeight: 150, textAlignVertical: "top" }}
        />
      </Field>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <T className="text-[11.5px] text-muted">{body.trim().length} / 2000</T>
        {kind === "warning" ? (
          <T weight="semibold" className="text-[11.5px]" style={{ color: C.error }}>
            التحذير يظهر بعلامة حمراء في إشعارات العضو
          </T>
        ) : null}
      </View>
      {kind === "warning" ? (
        <InfoBox tone="warning" icon="alert-triangle">
          استخدم التحذير للمخالفات أو التأخير المتكرر. الرسائل العادية أفضل للتنبيهات اليومية والتوضيحات.
        </InfoBox>
      ) : null}
      <ErrorBox message={error} />
    </Sheet>
  );
}
