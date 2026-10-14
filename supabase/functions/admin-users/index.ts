// Edge Function: admin-users
// 管理员前台用户管理：
//   GET  /users             -> 用户列表（合并 profiles.role）
//   POST /reset-password    -> 重置指定用户密码 { user_id, password }
//   POST /set-role          -> 设置用户角色 { user_id, role: admin|viewer }
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "未登录" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: ue } = await sb.auth.getUser(token);
    if (ue || !user) return json({ error: "登录态无效" }, 401);

    const { data: prof } = await sb
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!prof || prof.role !== "admin") {
      return json({ error: "需要管理员权限" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!
    );

    // 调试：把实际 pathname 暴露出来
    const rawPath = new URL(req.url).pathname;

    // 路径匹配：兼容 Supabase 网关可能重写 pathname 的情况
    const path = rawPath.endsWith("/users")
      ? "users"
      : rawPath.endsWith("/reset-password")
      ? "reset-password"
      : rawPath.endsWith("/set-role")
      ? "set-role"
      : "users"; // 默认 fallback

    if (req.method === "GET" && path === "users") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) return json({ error: error.message }, 500);
      const { data: profs } = await admin.from("profiles").select("user_id, role");
      const roleMap = new Map<string, string>((profs || []).map((p) => [p.user_id, p.role]));
      const users = (data?.users || [])
        .map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          role: roleMap.get(u.id) || "viewer",
        }))
        .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      return json({ users });
    }

    if (req.method === "POST" && path === "reset-password") {
      const b = await req.json().catch(() => ({}));
      const uid = String(b.user_id || "");
      const pw = String(b.password || "");
      if (!uid || pw.length < 6) {
        return json({ error: "参数错误：user_id 必填，密码至少 6 位" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(uid, { password: pw });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (req.method === "POST" && path === "set-role") {
      const b = await req.json().catch(() => ({}));
      const uid = String(b.user_id || "");
      const role = String(b.role || "");
      if (!uid || !["admin", "viewer"].includes(role)) {
        return json({ error: "参数错误：role 只能为 admin 或 viewer" }, 400);
      }
      if (uid === user.id) {
        return json({ error: "不能修改自己的角色（防止误操作锁死）" }, 400);
      }
      const { error } = await admin.from("profiles").update({ role }).eq("user_id", uid);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "未知接口", debug_path: rawPath }, 404);
  } catch (e) {
    return json({ error: String((e && (e as Error).message) || e) }, 500);
  }
});
