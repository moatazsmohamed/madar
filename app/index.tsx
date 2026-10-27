import { Redirect } from "expo-router";
import { Loading } from "@/components/madar/ui";
import { useSession } from "@/lib/madar/session";

export default function Index() {
  const { ready, session, profileLoading, isDeveloper, inCompany, contextLoading } = useSession();
  if (!ready || profileLoading || contextLoading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  if (isDeveloper) return <Redirect href={inCompany ? "/dashboard" : "/companies"} />;
  return <Redirect href="/dashboard" />;
}
