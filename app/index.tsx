import { Redirect } from "expo-router";
import { Loading } from "@/components/madar/ui";
import { useSession } from "@/lib/madar/session";

export default function Index() {
  const { ready, session, profile } = useSession();
  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  return <Redirect href={profile?.role === "developer" ? "/companies" : "/dashboard"} />;
}
