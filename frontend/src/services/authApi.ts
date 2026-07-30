export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
  riskProfile: "conservative" | "moderate" | "dynamic";
  investmentHorizon: "short_term" | "medium_term" | "long_term";
  investmentObjective:
    | "capital_preservation"
    | "income"
    | "balanced"
    | "growth";
  baseCurrency: "USD" | "EUR" | "TND";
};

type AuthResponse = { user: AuthUser };

async function authRequest(
  path: string,
  options?: RequestInit,
): Promise<AuthResponse> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const body = await response.json() as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? body.message.join(" ")
        : body.message || message;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json() as AuthResponse;
}

export async function getCurrentUser() {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
  return (await response.json() as AuthResponse).user;
}

export async function loginUser(email: string, password: string) {
  return (
    await authRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })
  ).user;
}

export async function registerUser(
  displayName: string,
  email: string,
  password: string,
) {
  return (
    await authRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ displayName, email, password }),
    })
  ).user;
}

export async function logoutUser() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(`Gateway returned ${response.status}`);
  }
}

export async function updateUserProfile(input: {
  displayName: string;
  riskProfile: AuthUser["riskProfile"];
  investmentHorizon: AuthUser["investmentHorizon"];
  investmentObjective: AuthUser["investmentObjective"];
  baseCurrency: AuthUser["baseCurrency"];
}) {
  return (
    await authRequest("/api/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  ).user;
}

export async function changeUserPassword(
  currentPassword: string,
  newPassword: string,
) {
  const response = await fetch("/api/auth/password", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const body = await response.json() as { message?: string | string[] };
      message = Array.isArray(body.message)
        ? body.message.join(" ")
        : body.message || message;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(message);
  }
}
