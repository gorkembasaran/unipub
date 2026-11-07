export type AuthPayload = {
  sub: string;
  email: string;
  fullName: string;
};

export type AuthSessionUser = {
  _id: string;
  fullName: string;
  email: string;
  isAdmin: boolean;
};

export type AuthenticatedUser = AuthPayload | AuthSessionUser;
