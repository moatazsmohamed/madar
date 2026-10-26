// Madar account management: developer setup, company provisioning, access requests and passwords.
// Runs with the service role; every privileged action re-checks the caller's active profile.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = ["admin", "manager", "supervisor", "employee", "viewer"] as const;
type Role = (typeof ROLES)[number];

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400) {
  return reply(status, { error: message });
}

const emailOk = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 254;

const passwordOk = (v: unknown): v is string => typeof v === "string" && v.length >= 8 && v.length <= 72;

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function friendlyAuthError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("already") && (m.includes("registered") || m.includes("exists"))) {
    return "هذا البريد مسجّل بالفعل";
  }
  if (m.includes("password")) return "كلمة المرور غير مقبولة، استخدم 8 أحرف على الأقل";
  return "تعذّر إنشاء الحساب، حاول مرة أخرى";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("طلب غير صالح");
  }
  const action = body.action;

  const hasDeveloper = async () => {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "developer")
      .eq("status", "active");
    return (count ?? 0) > 0;
  };

  // ---------- public actions ----------
  if (action === "setup") {
    if (!emailOk(body.email)) return fail("أدخل بريدًا إلكترونيًا صحيحًا");
    if (!passwordOk(body.password)) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    const fullName = text(body.full_name, 120);
    if (!fullName) return fail("أدخل اسمك");
    if (await hasDeveloper()) return fail("حساب المطور موجود بالفعل، سجّل الدخول", 409);

    const { data, error } = await admin.auth.admin.createUser({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) return fail(friendlyAuthError(error?.message ?? ""));
    return reply(200, { ok: true });
  }

  if (action === "register") {
    if (!emailOk(body.email)) return fail("أدخل بريدًا إلكترونيًا صحيحًا");
    if (!passwordOk(body.password)) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    const fullName = text(body.full_name, 120);
    if (!fullName) return fail("أدخل اسمك");
    const companyName = text(body.company_name, 120);
    if (!companyName) return fail("أدخل اسم الشركة التي تريد الانضمام إليها");
    if (!(await hasDeveloper())) return fail("لم يتم إعداد حساب المطور بعد", 409);

    const { data: company } = await admin
      .from("companies")
      .select("id, status")
      .ilike("name", companyName)
      .maybeSingle();
    if (!company) return fail("لا توجد شركة بهذا الاسم، تأكد من الاسم أو اطلب من مدير الشركة إضافتك");
    if (company.status !== "active") return fail("هذه الشركة موقوفة حاليًا", 403);

    const { data, error } = await admin.auth.admin.createUser({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: fullName, company_id: company.id },
    });
    if (error || !data.user) return fail(friendlyAuthError(error?.message ?? ""));
    const { data: profile } = await admin
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .single();
    return reply(200, { ok: true, status: profile?.status ?? "pending" });
  }

  if (action === "register_company") {
    if (!emailOk(body.email)) return fail("أدخل بريدًا إلكترونيًا صحيحًا");
    if (!passwordOk(body.password)) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    const fullName = text(body.full_name, 120);
    if (!fullName) return fail("أدخل اسمك");
    const companyName = text(body.company_name, 120);
    if (!companyName) return fail("أدخل اسم الشركة");
    const timezone = text(body.timezone, 64) || "Africa/Cairo";
    if (!(await hasDeveloper())) return fail("لم يتم إعداد حساب المطور بعد", 409);

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ name: companyName, timezone, status: "pending" })
      .select("id")
      .single();
    if (companyError || !company) {
      if (companyError?.code === "23505") return fail("اسم الشركة مستخدم بالفعل أو هناك طلب سابق لها", 409);
      return fail("تعذّر إرسال الطلب", 500);
    }

    const email = body.email.trim().toLowerCase();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: fullName, company_id: company.id, role: "admin", status: "pending" },
    });
    if (error || !data.user) {
      await admin.from("companies").delete().eq("id", company.id);
      return fail(friendlyAuthError(error?.message ?? ""));
    }
    return reply(200, { ok: true, company_id: company.id });
  }

  // ---------- authenticated actions ----------
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return fail("سجّل الدخول أولًا", 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return fail("انتهت الجلسة، سجّل الدخول مجددًا", 401);

  const { data: me } = await admin
    .from("profiles")
    .select("id, role, status, department_id, company_id")
    .eq("id", authData.user.id)
    .single();
  if (!me || me.status !== "active") return fail("حسابك غير مفعّل", 403);
  const myRole = me.role as Role | "developer";

  if (action === "create_company") {
    if (myRole !== "developer") return fail("إضافة الشركات من صلاحيات حساب المطور", 403);
    const name = text(body.name, 120);
    if (!name) return fail("أدخل اسم الشركة");
    const timezone = text(body.timezone, 64) || "Africa/Cairo";
    const adminName = text(body.admin_name, 120);
    if (!adminName) return fail("أدخل اسم مدير الشركة");
    if (!emailOk(body.admin_email)) return fail("أدخل بريدًا إلكترونيًا صحيحًا لمدير الشركة");
    if (!passwordOk(body.admin_password)) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({ name, timezone })
      .select("id")
      .single();
    if (companyError || !company) {
      if (companyError?.code === "23505") return fail("اسم الشركة مستخدم بالفعل", 409);
      return fail("تعذّر إنشاء الشركة", 500);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: body.admin_email.trim().toLowerCase(),
      password: body.admin_password,
      email_confirm: true,
      user_metadata: {
        full_name: adminName,
        company_id: company.id,
        role: "admin",
        status: "active",
      },
    });
    if (error || !data.user) {
      await admin.from("companies").delete().eq("id", company.id);
      return fail(friendlyAuthError(error?.message ?? ""));
    }
    return reply(200, { ok: true, company_id: company.id, user_id: data.user.id });
  }

  if (action === "review_company") {
    if (myRole !== "developer") return fail("مراجعة الطلبات من صلاحيات حساب المطور", 403);
    const companyId = typeof body.company_id === "string" ? body.company_id : "";
    const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
    if (!companyId || !decision) return fail("حدّد الشركة والقرار");
    const { data: company } = await admin
      .from("companies")
      .select("id, name, status")
      .eq("id", companyId)
      .single();
    if (!company) return fail("الشركة غير موجودة", 404);
    if (company.status !== "pending") return fail("هذه الشركة ليست بانتظار الموافقة", 409);

    const { data: owners } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId)
      .eq("role", "admin")
      .eq("status", "pending");

    if (decision === "approve") {
      await admin.from("companies").update({ status: "active" }).eq("id", companyId);
      const ids = (owners ?? []).map((o) => o.id);
      if (ids.length) {
        await admin.from("profiles").update({ status: "active" }).in("id", ids);
        await admin.from("notifications").insert(
          ids.map((userId) => ({
            user_id: userId,
            kind: "member_approved",
            title: "تم تفعيل شركتك",
            body: `تمت الموافقة على فتح شركة ${company.name}. يمكنك الدخول وإدارة شركتك الآن.`,
          })),
        );
      }
      return reply(200, { ok: true });
    }

    for (const owner of owners ?? []) await admin.auth.admin.deleteUser(owner.id);
    const { error: deleteError } = await admin.from("companies").delete().eq("id", companyId);
    if (deleteError) return fail("تعذّر حذف الطلب", 500);
    return reply(200, { ok: true });
  }

  if (action === "create_member") {
    if (myRole === "developer") return fail("حساب المطور يضيف الشركات لا الموظفين", 403);
    if (!emailOk(body.email)) return fail("أدخل بريدًا إلكترونيًا صحيحًا");
    if (!passwordOk(body.password)) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    const role = (ROLES as readonly string[]).includes(body.role as string) ? (body.role as Role) : "employee";
    let departmentId = typeof body.department_id === "string" && body.department_id ? body.department_id : null;
    const fullName = text(body.full_name, 120);
    const jobTitle = text(body.job_title, 120) || null;
    if (!fullName) return fail("أدخل اسم الموظف");
    if (!me.company_id) return fail("حسابك غير مرتبط بشركة", 403);

    if (myRole === "manager") {
      if (!["supervisor", "employee", "viewer"].includes(role)) {
        return fail("مدير القسم يضيف مشرفين وموظفين ومشاهدين فقط", 403);
      }
      departmentId = me.department_id;
    } else if (myRole !== "admin") {
      return fail("إضافة الموظفين من صلاحيات مدير النظام ومدير القسم", 403);
    }

    const email = body.email.trim().toLowerCase();
    const { error: invError } = await admin.from("invitations").upsert(
      {
        email,
        full_name: fullName,
        role,
        company_id: me.company_id,
        department_id: departmentId,
        job_title: jobTitle,
        invited_by: me.id,
        accepted_at: null,
      },
      { onConflict: "company_id,email" },
    );
    if (invError) return fail("تعذّر تجهيز بيانات الموظف", 500);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: fullName, company_id: me.company_id },
    });
    if (error || !data.user) {
      await admin.from("invitations").delete().eq("email", email).eq("company_id", me.company_id).is("accepted_at", null);
      return fail(friendlyAuthError(error?.message ?? ""));
    }
    return reply(200, { ok: true, user_id: data.user.id });
  }

  if (action === "reset_password") {
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    if (!userId) return fail("حدّد الموظف");
    if (!passwordOk(body.password)) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    const { data: target } = await admin
      .from("profiles")
      .select("id, role, department_id, company_id")
      .eq("id", userId)
      .single();
    if (!target) return fail("الموظف غير موجود", 404);
    const allowed =
      myRole === "developer" ||
      target.id === me.id ||
      (myRole === "admin" && target.company_id === me.company_id) ||
      (myRole === "manager" &&
        !!me.department_id &&
        target.company_id === me.company_id &&
        target.department_id === me.department_id &&
        ["supervisor", "employee", "viewer"].includes(target.role));
    if (!allowed) return fail("غير مصرح لك بتغيير كلمة مرور هذا الحساب", 403);
    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password });
    if (error) return fail(friendlyAuthError(error.message));
    return reply(200, { ok: true });
  }

  return fail("إجراء غير معروف");
});
