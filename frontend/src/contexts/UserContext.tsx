import { createContext, useContext, useState, type ReactNode } from 'react';
import { authService } from '../services/authService';
import type { StoredUser } from '../services/authService';

// ── Permission key constants (mirrors backend) ────────────────────────────────

export const PERM = {
  LR_CREATE:   'lr.create',
  LR_READ:     'lr.read',
  LR_UPDATE:   'lr.update',
  LR_DELETE:   'lr.delete',

  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_READ:   'document.read',
  DOCUMENT_DELETE: 'document.delete',

  COMMUNICATION_SEND: 'communication.send',
  COMMUNICATION_READ: 'communication.read',

  USER_MANAGE: 'user.manage',

  MASTER_MANAGE: 'master.manage',
  MASTER_READ:   'master.read',
} as const;

// ── Context value type ────────────────────────────────────────────────────────

export interface UserContextValue {
  user: StoredUser | null;
  setUser: (user: StoredUser | null) => void;
  /** Returns true if the current user has the given permission key.
   *  Super admins always return true. */
  hasPermission: (key: string) => boolean;
  /** Returns true if the current user has the given role key. */
  hasRole: (key: string) => boolean;
}

// ── Context ───────────────────────────────────────────────────────────────────

const UserCtx = createContext<UserContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<StoredUser | null>(() => authService.getUser());

  const setUser = (u: StoredUser | null) => {
    if (u) {
      authService.setUser(u);
    } else {
      authService.clearUser();
    }
    setUserState(u);
  };

  const hasPermission = (key: string): boolean => {
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    return user.permissionKeys.includes(key);
  };

  const hasRole = (key: string): boolean => {
    if (!user) return false;
    return user.roleKeys.includes(key);
  };

  return (
    <UserCtx.Provider value={{ user, setUser, hasPermission, hasRole }}>
      {children}
    </UserCtx.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCurrentUser(): UserContextValue {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error('useCurrentUser must be used inside <UserProvider>');
  return ctx;
}
