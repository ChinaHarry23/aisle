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
  /** The users.session_version column. A cookie signed with an older version no longer signs in. */
  sessionVersion?: number;
};

export type SessionUser = PublicUser & { sessionVersion?: number };
