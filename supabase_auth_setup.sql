-- ============================================================
-- Aliencell 看板 · 认证体系初始化脚本
-- 在 Supabase Dashboard → SQL Editor 中粘贴执行（仅需一次）
-- ============================================================

-- 1. 创建 profiles 表（存储用户角色）
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email    TEXT,
  role     TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 启用行级安全 (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. 策略：已认证用户可读全部 profiles（前端需查角色决定权限）
DROP POLICY IF EXISTS "Authenticated can read profiles" ON public.profiles;
CREATE POLICY "Authenticated can read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- 4. 自动建档：新用户注册时自动创建 viewer 行
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, role)
  VALUES (NEW.id, NEW.email, 'viewer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5. 管理员分配（每次新增管理员时执行）
--    将 email 替换为在 Auth → Users 中创建的用户邮箱
-- ============================================================
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'your-admin@email.com';

-- 6. 查看当前所有用户角色
-- SELECT email, role, created_at FROM public.profiles ORDER BY created_at;
