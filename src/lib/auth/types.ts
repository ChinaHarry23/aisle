export type UserRole = "dev" | "beta";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type AuthUser = PublicUser & {
  passwordHash: string;
  createdAt: string;
  /** False when the account was created by Google or Apple and has no password. */
  passwordLogin: boolean;
  googleSub: string | null;
  appleSub: string | null;
  /** Sessions signed with an older version are no longer accepted. */
  sessionVersion: number;
};

export type SessionUser = PublicUser & { sessionVersion?: number };
