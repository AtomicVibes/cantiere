import { supabase } from './supabase';

const handleAuthCall = async (operation) => {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    console.error('AUTH_ERROR_LOG', {
      message: error.message,
      code: error.code,
      status: error.status,
    });
    return null;
  }
};

export const signInWithGoogle = async (redirectTo = window.location.origin + '/') => {
  return handleAuthCall(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
    return true;
  });
};

export const signUpWithEmail = async (email, password) => {
  return handleAuthCall(async () => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return true;
  });
};

export const signInWithEmail = async (email, password) => {
  return handleAuthCall(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return true;
  });
};

export const signOut = async () => {
  return handleAuthCall(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
  });
};

export const resetPasswordRequest = async (email) => {
  return handleAuthCall(async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    });
    if (error) throw error;
    return true;
  });
};

export const resetPassword = async (newPassword) => {
  return handleAuthCall(async () => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return true;
  });
};
