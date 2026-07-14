import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../utils/supabase';
import { hashPassword } from '../utils/auth';
import type { AppUser } from '../types';

interface LoginResult {
  ok: boolean;
  needsNewPassword?: boolean;
}

interface AuthContextType {
  user: AppUser | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  completeBootstrap: (username: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  changeCredentials: (currentPassword: string, newUsername: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  enableRecoveryEmail: () => Promise<{ ok: boolean; error?: string; email?: string }>;
  sendPasswordResetEmail: (username: string) => Promise<{ ok: boolean; error?: string }>;
  completePasswordReset: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Supabase Auth identifies accounts by email, so each username maps to a
// synthetic, non-deliverable address - nobody needs to receive mail at it,
// it's just a stable identifier. This is the ORIGINAL identity every account
// still has; recoveryEmail() below is a second, real address layered on top
// once someone opts in, so "Forgot Password" has somewhere real to send to.
function authEmail(username: string): string {
  return `${username.trim().toLowerCase()}@goharledger.internal`;
}

// A real, working inbox both partners can check. Gmail ignores anything
// after "+" in the local part, so every username's recovery address lands
// in the exact same inbox while still being a distinct, valid address per
// account (Supabase requires each account's email to be unique).
function recoveryEmail(username: string): string {
  return `ramlabdulqadir+${username.trim().toLowerCase()}@gmail.com`;
}

// Escape ILIKE wildcard characters so a username containing "%" or "_"
// can't accidentally (or deliberately) match more than the exact name.
function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (c) => `\\${c}`);
}

// Recover the username from whichever email format the session is
// currently under - the original internal placeholder, or the real
// recovery address (Gmail "+alias") once that's been enabled.
function usernameFromEmail(email: string): string {
  const local = email.split('@')[0];
  const plusIndex = local.indexOf('+');
  return plusIndex >= 0 ? local.slice(plusIndex + 1) : local;
}

async function loadAppUser(username: string): Promise<AppUser | null> {
  const { data: row } = await supabase
    .from('users')
    .select('*')
    .ilike('username', escapeLike(username))
    .eq('is_active', true)
    .maybeSingle();
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    full_name: row.full_name,
    phone: row.phone,
    is_active: row.is_active,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.email) {
        const username = usernameFromEmail(session.user.email);
        const appUser = await loadAppUser(username);
        if (mounted) setUser(appUser);
      }
      if (mounted) setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setUser(null);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    const trimmed = username.trim();

    // Try the real recovery email first (used once "Enable Forgot Password"
    // has been confirmed), then fall back to the original internal
    // placeholder - whichever one this account actually signed up under.
    let { data: signInData } = await supabase.auth.signInWithPassword({ email: recoveryEmail(trimmed), password });
    if (!signInData.session) {
      ({ data: signInData } = await supabase.auth.signInWithPassword({ email: authEmail(trimmed), password }));
    }
    if (signInData.session) {
      const appUser = await loadAppUser(trimmed);
      if (!appUser) { await supabase.auth.signOut(); return { ok: false }; }
      setUser(appUser);
      return { ok: true };
    }

    // No real Auth account yet for this username - check the legacy password
    // hash used before this app had real login sessions, and if it matches,
    // transparently create the real Auth account so this is a one-time,
    // invisible migration for the two partners instead of a manual step.
    const { data: row } = await supabase
      .from('users')
      .select('*')
      .ilike('username', escapeLike(trimmed))
      .eq('is_active', true)
      .maybeSingle();
    if (!row) return { ok: false };

    const hash = await hashPassword(row.username, password);
    if (hash !== row.password_hash) return { ok: false };

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email: authEmail(trimmed), password });
    if (signUpError) {
      // Supabase enforces its own minimum password length (currently 6) that
      // the old system never checked, so a short legacy password can verify
      // correctly here but still be rejected when creating the real account.
      if (signUpError.message?.toLowerCase().includes('password')) {
        return { ok: false, needsNewPassword: true };
      }
      console.error('Could not create Auth account on login:', signUpError);
      return { ok: false };
    }
    if (!signUpData.session) {
      console.error('Could not create Auth account on login: no session returned');
      return { ok: false };
    }

    setUser({
      id: row.id,
      username: row.username,
      role: row.role,
      full_name: row.full_name,
      phone: row.phone,
      is_active: row.is_active,
    });
    return { ok: true };
  };

  const completeBootstrap = async (username: string, newPassword: string): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = username.trim();
    const email = authEmail(trimmed);

    const { data: row } = await supabase
      .from('users')
      .select('*')
      .ilike('username', escapeLike(trimmed))
      .eq('is_active', true)
      .maybeSingle();
    if (!row) return { ok: false, error: 'Account not found' };

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password: newPassword });
    if (signUpError || !signUpData.session) {
      return { ok: false, error: signUpError?.message || 'Could not create account' };
    }

    const newHash = await hashPassword(row.username, newPassword);
    await supabase.from('users').update({ password_hash: newHash }).eq('id', row.id);

    setUser({
      id: row.id,
      username: row.username,
      role: row.role,
      full_name: row.full_name,
      phone: row.phone,
      is_active: row.is_active,
    });
    return { ok: true };
  };

  const logout = () => {
    supabase.auth.signOut();
    setUser(null);
  };

  const changeCredentials = async (
    currentPassword: string,
    newUsername: string,
    newPassword: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!user) return { ok: false, error: 'Not logged in' };

    const { data: row } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
    if (!row) return { ok: false, error: 'Account not found' };

    let { error: verifyError } = await supabase.auth.signInWithPassword({
      email: recoveryEmail(row.username),
      password: currentPassword,
    });
    if (verifyError) {
      ({ error: verifyError } = await supabase.auth.signInWithPassword({
        email: authEmail(row.username),
        password: currentPassword,
      }));
    }
    if (verifyError) return { ok: false, error: 'Current password is incorrect' };

    const trimmedUsername = newUsername.trim() || row.username;
    if (trimmedUsername.toLowerCase() !== row.username.toLowerCase()) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .ilike('username', escapeLike(trimmedUsername))
        .neq('id', user.id)
        .maybeSingle();
      if (existing) return { ok: false, error: 'That username is already taken' };
    }

    const authUpdates: { password?: string } = {};
    if (newPassword) authUpdates.password = newPassword;

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabase.auth.updateUser(authUpdates);
      if (authError) return { ok: false, error: 'Could not save changes' };
    }

    const newHash = newPassword ? await hashPassword(trimmedUsername, newPassword) : row.password_hash;
    const { error } = await supabase
      .from('users')
      .update({ username: trimmedUsername.toLowerCase(), password_hash: newHash })
      .eq('id', user.id);

    if (error) return { ok: false, error: 'Could not save changes' };

    const updatedUser: AppUser = { ...user, username: trimmedUsername.toLowerCase() };
    setUser(updatedUser);
    return { ok: true };
  };

  // Points this account's real login email at the shared recovery inbox.
  // Supabase requires confirming the new address (link sent to it) before
  // the change takes effect, so login keeps working under the old address
  // until that confirmation happens.
  const enableRecoveryEmail = async (): Promise<{ ok: boolean; error?: string; email?: string }> => {
    if (!user) return { ok: false, error: 'Not logged in' };
    const email = recoveryEmail(user.username);
    const emailRedirectTo = `${window.location.origin}${import.meta.env.BASE_URL}login`;
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo });
    if (error) return { ok: false, error: error.message };
    return { ok: true, email };
  };

  const sendPasswordResetEmail = async (username: string): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = username.trim();
    if (!trimmed) return { ok: false, error: 'Enter a username' };
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail(trimmed), { redirectTo });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  };

  const completePasswordReset = async (newPassword: string): Promise<{ ok: boolean; error?: string }> => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { ok: false, error: 'This reset link has expired - request a new one' };

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };

    const username = usernameFromEmail(sessionData.session.user.email || '');
    if (username) {
      const newHash = await hashPassword(username, newPassword);
      await supabase.from('users').update({ password_hash: newHash }).ilike('username', escapeLike(username));
    }
    return { ok: true };
  };

  return (
    <AuthContext.Provider value={{ user, login, completeBootstrap, logout, changeCredentials, enableRecoveryEmail, sendPasswordResetEmail, completePasswordReset, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
