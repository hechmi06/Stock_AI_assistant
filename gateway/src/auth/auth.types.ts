import type { Request } from "express";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
  riskProfile: string;
  investmentHorizon: string;
  investmentObjective: string;
  baseCurrency: string;
};

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
  sessionToken: string;
};
