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
  /** Not mapped by toAuthUser (the session_version column is read via userExtras), so getCurrentUser sees 0; nothing bumps the column, so it revokes no sessions. */
  sessionVersion?: number;
};

export type SessionUser = PublicUser & { sessionVersion?: number };
