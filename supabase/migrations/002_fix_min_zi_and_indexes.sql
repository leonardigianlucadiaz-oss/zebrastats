-- Fix min_zi scale: change default from 40 to 4 (scale is 0-10, not 0-100)
ALTER TABLE public.user_alerts
  ALTER COLUMN min_zi SET DEFAULT 4;

-- Fix existing rows that have the wrong default of 40
UPDATE public.user_alerts
  SET min_zi = 4
  WHERE min_zi = 40;

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id
  ON public.user_alerts (user_id);

CREATE INDEX IF NOT EXISTS idx_user_alerts_active
  ON public.user_alerts (active) WHERE active = true;
