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
};

export type SessionUser = PublicUser;
