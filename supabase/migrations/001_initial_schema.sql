-- ═══════════════════════════════════════════════════════════════
-- ZebraStats — Schema inicial
-- Execute no Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── PROFILES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name             text,
  avatar_url       text,
  plan             text DEFAULT 'free' CHECK (plan IN ('free','pro')),
  plan_expires_at  timestamptz,
  stripe_customer_id text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ── USER FAVORITES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_favorites (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id    text NOT NULL,
  team_name  text,
  team_meta  jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, team_id)
);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own favorites" ON public.user_favorites
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── USER ALERTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_alerts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id       text,
  min_zi          numeric DEFAULT 40,
  active          boolean DEFAULT true,
  push_enabled    boolean DEFAULT false,
  email_enabled   boolean DEFAULT false,
  push_token      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own alerts" ON public.user_alerts
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── USER SETTINGS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  theme            text DEFAULT 'dark',
  onboarded        boolean DEFAULT false,
  favorite_leagues text[] DEFAULT '{}',
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own settings" ON public.user_settings
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── ZEBRA HISTORY ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zebra_history (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  match_home  text,
  match_away  text,
  zi          numeric,
  league      text,
  match_date  date,
  viewed_at   timestamptz DEFAULT now()
);

ALTER TABLE public.zebra_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own history" ON public.zebra_history
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text DEFAULT 'zebra_alert',
  title      text NOT NULL,
  body       text,
  data       jsonb DEFAULT '{}',
  read       boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own notifications" ON public.notifications
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── TRIGGER: auto-create profile on signup ────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, plan)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'plan', 'free')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
