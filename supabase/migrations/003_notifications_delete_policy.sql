-- Migration 003: Adiciona policy DELETE para notificações e melhora índices
-- Usuários devem poder deletar as próprias notificações

-- Policy de DELETE para notificações
CREATE POLICY "Users can delete own notifications"
  ON public.notifications
  FOR DELETE
  USING (auth.uid() = user_id);

-- Policy de UPDATE para marcar como lida
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Índice adicional para busca por lidas/não-lidas (melhora performance do badge)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications (user_id, read)
  WHERE read = false;
