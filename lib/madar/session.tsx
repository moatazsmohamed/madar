import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setCompanyTimezone } from "./format";
import type { Company, Profile } from "./types";

type SessionValue = {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  profileLoading: boolean;
  company: Company | null;
  isDeveloper: boolean;
  refreshProfile: () => Promise<unknown>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setReady(true);
      if (event === "SIGNED_OUT") queryClient.clear();
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id ?? null;

  const profileQuery = useQuery({
    queryKey: ["me", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 15000 : false),
  });

  const profile = profileQuery.data ?? null;
  const companyId = profile?.company_id ?? null;

  // General supervision is a department flag; the client mirrors it onto the profile
  // so the permission helpers can stay pure functions of (me, task).
  const departmentFlagQuery = useQuery({
    queryKey: ["departments", "mine", profile?.department_id],
    enabled: !!profile?.department_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("supervises_all")
        .eq("id", profile!.department_id!)
        .maybeSingle();
      if (error) throw error;
      return !!(data as { supervises_all: boolean } | null)?.supervises_all;
    },
    staleTime: 60_000,
  });

  const effectiveProfile = useMemo<Profile | null>(
    () => (profile ? { ...profile, department_supervises_all: !!departmentFlagQuery.data } : null),
    [profile, departmentFlagQuery.data],
  );

  const companyQuery = useQuery({
    queryKey: ["company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").eq("id", companyId!).maybeSingle();
      if (error) throw error;
      return (data as Company | null) ?? null;
    },
  });

  const company = companyQuery.data ?? null;
  // Keep formatters in sync with the company timezone before children render.
  if (company?.timezone) setCompanyTimezone(company.timezone);

  const isDeveloper = profile?.role === "developer";

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      session,
      userId,
      profile: effectiveProfile,
      profileLoading: !!userId && profileQuery.isLoading,
      company,
      isDeveloper,
      refreshProfile: () => profileQuery.refetch(),
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
      },
    }),
    [ready, session, userId, effectiveProfile, profileQuery, company, isDeveloper, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** The signed-in active member. Only call inside the authenticated area. */
export function useMe(): Profile {
  const { profile } = useSession();
  return profile as Profile;
}
