import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { AppUser, UserRole } from '../types';

interface AuthContextType {
  user: AppUser | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('gohar_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem('gohar_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    const validUsers: Record<string, { role: UserRole; full_name: string }> = {
      taher: { role: 'admin', full_name: 'Taher' },
      abdulqadir: { role: 'admin', full_name: 'Abdulqadir' },
    };

    const userInfo = validUsers[username.toLowerCase()];
    if (!userInfo || password !== 'gohar') {
      return false;
    }

    const appUser: AppUser = {
      id: username.toLowerCase(),
      username: username.toLowerCase(),
      role: userInfo.role,
      full_name: userInfo.full_name,
      phone: null,
      is_active: true,
    };

    setUser(appUser);
    localStorage.setItem('gohar_user', JSON.stringify(appUser));
    return true;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('gohar_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
