-- Ensure RLS is enabled and policies exist on messages and notifications
-- Required for real-time subscriptions to deliver events to the correct user.

-- ============================================================
-- messages table
-- ============================================================
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS "Users can view their own messages"
    ON public.messages FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS "Users can send messages"
    ON public.messages FOR INSERT
    WITH CHECK (auth.uid() = sender_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS "Users can mark messages as read"
    ON public.messages FOR UPDATE
    USING (auth.uid() = receiver_id)
    WITH CHECK (auth.uid() = receiver_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- notifications table
-- ============================================================
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS "Users can mark their own notifications as read"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
