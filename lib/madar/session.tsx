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
  /** Company the developer is currently working inside; null for everyone else. */
  activeCompanyId: string | null;
  inCompany: boolean;
  contextLoading: boolean;
  refreshProfile: () => Promise<unknown>;
  enterCompany: (companyId: string) => Promise<void>;
  exitCompany: () => Promise<void>;
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

  const rawProfile = profileQuery.data ?? null;
  const isDeveloper = rawProfile?.role === "developer";

  // The developer account owns the platform but works inside one company at a
  // time; the database mirrors that pointer in developer_active_companies.
  const developerContextQuery = useQuery({
    queryKey: ["developer-active-company", userId],
    enabled: !!userId && isDeveloper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("developer_active_companies")
        .select("company_id")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { company_id: string } | null)?.company_id ?? null;
    },
  });

  const activeCompanyId = isDeveloper ? developerContextQuery.data ?? null : null;
  const inCompany = isDeveloper && !!activeCompanyId;
  const companyId = rawProfile?.company_id ?? activeCompanyId ?? null;

  // General supervision is a department flag; the client mirrors it onto the profile
  // so the permission helpers can stay pure functions of (me, task).
  const departmentFlagQuery = useQuery({
    queryKey: ["departments", "mine", rawProfile?.department_id],
    enabled: !!rawProfile?.department_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("supervises_all")
        .eq("id", rawProfile!.department_id!)
        .maybeSingle();
      if (error) throw error;
      return !!(data as { supervises_all: boolean } | null)?.supervises_all;
    },
    staleTime: 60_000,
  });

  // Inside a company the developer gets an admin profile scoped to it, so every
  // permission helper (and the UI built on it) behaves like the company admin.
  const effectiveProfile = useMemo<Profile | null>(() => {
    if (!rawProfile) return null;
    if (isDeveloper) {
      if (!activeCompanyId) return rawProfile;
      return {
        ...rawProfile,
        role: "admin",
        company_id: activeCompanyId,
        department_id: null,
        department_supervises_all: false,
      };
    }
    return { ...rawProfile, department_supervises_all: !!departmentFlagQuery.data };
  }, [rawProfile, isDeveloper, activeCompanyId, departmentFlagQuery.data]);

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

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      session,
      userId,
      profile: effectiveProfile,
      profileLoading: !!userId && profileQuery.isLoading,
      company,
      isDeveloper,
      activeCompanyId,
      inCompany,
      contextLoading: isDeveloper && developerContextQuery.isLoading,
      refreshProfile: () => profileQuery.refetch(),
      enterCompany: async (nextCompanyId: string) => {
        const { error } = await supabase.rpc("developer_enter_company", { p_company: nextCompanyId });
        if (error) throw error;
        queryClient.setQueryData(["developer-active-company", userId], nextCompanyId);
        await queryClient.invalidateQueries();
      },
      exitCompany: async () => {
        const { error } = await supabase.rpc("developer_exit_company");
        if (error) throw error;
        queryClient.setQueryData(["developer-active-company", userId], null);
        await queryClient.invalidateQueries();
      },
      signOut: async () => {
        await supabase.auth.signOut();
        queryClient.clear();
      },
    }),
    [ready, session, userId, effectiveProfile, profileQuery, company, isDeveloper, activeCompanyId, inCompany, developerContextQuery.isLoading, queryClient],
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
