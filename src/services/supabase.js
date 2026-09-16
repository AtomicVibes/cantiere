// src/services/supabase.js
// Previously created its own GoTrue client, causing:
//   "Multiple GoTrueClient instances detected in the same browser context"
// This file now re-exports the canonical singleton so any existing
// imports of '@/services/supabase' continue to work with the same client.
export { supabase } from '@/api/supabaseClient';
