import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { DatabaseService } from "../database/database.service";
import type { AuthenticatedUser } from "./auth.types";

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = "stock_ai_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  created_at: Date | string;
  risk_profile: string;
  investment_horizon: string;
  investment_objective: string;
  base_currency: string;
};

type SessionUserRow = UserRow & {
  expires_at: Date;
};

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async register(input: {
    displayName: string;
    email: string;
    password: string;
  }, metadata: { userAgent?: string; ipAddress?: string }) {
    const displayName = this.normalizeDisplayName(input.displayName);
    const email = this.normalizeEmail(input.email);
    this.validatePassword(input.password);
    const id = randomUUID();
    const salt = randomBytes(24).toString("hex");
    const passwordHash = await this.hashPassword(input.password, salt);

    try {
      await this.database.query(
        `INSERT INTO users
          (id, email, display_name, password_salt, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, email, displayName, salt, passwordHash],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException("Un compte existe deja avec cet email.");
      }
      throw error;
    }

    const user: AuthenticatedUser = {
      id,
      email,
      displayName,
      role: "user",
      createdAt: new Date().toISOString(),
      riskProfile: "moderate",
      investmentHorizon: "long_term",
      investmentObjective: "balanced",
      baseCurrency: "USD",
    };
    const token = await this.createSession(user.id, metadata);
    return { user, token };
  }

  async login(
    input: { email: string; password: string },
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const email = this.normalizeEmail(input.email);
    const result = await this.database.query<UserRow>(
      `SELECT id, email, display_name, password_salt, password_hash, role,
              is_active, created_at, risk_profile, investment_horizon,
              investment_objective, base_currency
       FROM users
       WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    if (!row || !row.is_active) {
      throw new UnauthorizedException("Email ou mot de passe incorrect.");
    }
    const candidate = await this.hashPassword(input.password, row.password_salt);
    const expectedBuffer = Buffer.from(row.password_hash, "hex");
    const candidateBuffer = Buffer.from(candidate, "hex");
    if (
      expectedBuffer.length !== candidateBuffer.length
      || !timingSafeEqual(expectedBuffer, candidateBuffer)
    ) {
      throw new UnauthorizedException("Email ou mot de passe incorrect.");
    }
    const user = this.toUser(row);
    const token = await this.createSession(user.id, metadata);
    return { user, token };
  }

  async authenticate(token: string | null): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    const tokenHash = this.hashToken(token);
    const result = await this.database.query<SessionUserRow>(
      `SELECT u.id, u.email, u.display_name, u.password_salt, u.password_hash,
              u.role, u.is_active, u.created_at, u.risk_profile,
              u.investment_horizon, u.investment_objective, u.base_currency,
              s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || !row.is_active) return null;
    await this.database.query(
      `UPDATE user_sessions SET last_seen_at = now() WHERE token_hash = $1`,
      [tokenHash],
    );
    return this.toUser(row);
  }

  async updateProfile(
    userId: string,
    input: {
      displayName: string;
      riskProfile: string;
      investmentHorizon: string;
      investmentObjective: string;
      baseCurrency: string;
    },
  ) {
    const displayName = this.normalizeDisplayName(input.displayName);
    const riskProfile = this.allowedValue(
      input.riskProfile,
      ["conservative", "moderate", "dynamic"],
      "Profil de risque invalide.",
    );
    const investmentHorizon = this.allowedValue(
      input.investmentHorizon,
      ["short_term", "medium_term", "long_term"],
      "Horizon d'investissement invalide.",
    );
    const investmentObjective = this.allowedValue(
      input.investmentObjective,
      ["capital_preservation", "income", "balanced", "growth"],
      "Objectif d'investissement invalide.",
    );
    const baseCurrency = this.allowedValue(
      input.baseCurrency?.toUpperCase(),
      ["USD", "EUR", "TND"],
      "Devise de reference invalide.",
    );

    const result = await this.database.query<UserRow>(
      `UPDATE users
       SET display_name = $2, risk_profile = $3, investment_horizon = $4,
           investment_objective = $5, base_currency = $6, updated_at = now()
       WHERE id = $1
       RETURNING id, email, display_name, password_salt, password_hash, role,
                 is_active, created_at, risk_profile, investment_horizon,
                 investment_objective, base_currency`,
      [
        userId,
        displayName,
        riskProfile,
        investmentHorizon,
        investmentObjective,
        baseCurrency,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException("Compte utilisateur introuvable.");
    return this.toUser(row);
  }

  async changePassword(
    userId: string,
    sessionToken: string,
    input: { currentPassword: string; newPassword: string },
  ) {
    this.validatePassword(input.newPassword);
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException(
        "Le nouveau mot de passe doit etre different de l'ancien.",
      );
    }
    const result = await this.database.query<UserRow>(
      `SELECT id, email, display_name, password_salt, password_hash, role,
              is_active, created_at, risk_profile, investment_horizon,
              investment_objective, base_currency
       FROM users WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row || !row.is_active) {
      throw new UnauthorizedException("Compte utilisateur introuvable.");
    }
    const candidate = await this.hashPassword(
      input.currentPassword,
      row.password_salt,
    );
    const expectedBuffer = Buffer.from(row.password_hash, "hex");
    const candidateBuffer = Buffer.from(candidate, "hex");
    if (
      expectedBuffer.length !== candidateBuffer.length
      || !timingSafeEqual(expectedBuffer, candidateBuffer)
    ) {
      throw new UnauthorizedException("Mot de passe actuel incorrect.");
    }

    const salt = randomBytes(24).toString("hex");
    const passwordHash = await this.hashPassword(input.newPassword, salt);
    await this.database.query(
      `UPDATE users
       SET password_salt = $2, password_hash = $3, updated_at = now()
       WHERE id = $1`,
      [userId, salt, passwordHash],
    );
    await this.database.query(
      `DELETE FROM user_sessions
       WHERE user_id = $1 AND token_hash <> $2`,
      [userId, this.hashToken(sessionToken)],
    );
  }

  async logout(token: string | null) {
    if (!token) return;
    await this.database.query(
      `DELETE FROM user_sessions WHERE token_hash = $1`,
      [this.hashToken(token)],
    );
  }

  extractSessionToken(cookieHeader: string | undefined) {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(";")) {
      const [name, ...valueParts] = part.trim().split("=");
      if (name === SESSION_COOKIE) {
        return decodeURIComponent(valueParts.join("="));
      }
    }
    return null;
  }

  sessionCookie(token: string) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`;
  }

  clearSessionCookie() {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0${secure}`;
  }

  private async createSession(
    userId: string,
    metadata: { userAgent?: string; ipAddress?: string },
  ) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await this.database.query(
      `INSERT INTO user_sessions
        (id, user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        userId,
        this.hashToken(token),
        expiresAt,
        metadata.userAgent?.slice(0, 500) ?? null,
        metadata.ipAddress?.slice(0, 80) ?? null,
      ],
    );
    return token;
  }

  private normalizeEmail(value: string) {
    const email = String(value ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      throw new BadRequestException("Adresse email invalide.");
    }
    return email;
  }

  private normalizeDisplayName(value: string) {
    const displayName = String(value ?? "").trim().replace(/\s+/g, " ");
    if (displayName.length < 2 || displayName.length > 120) {
      throw new BadRequestException(
        "Le nom doit contenir entre 2 et 120 caracteres.",
      );
    }
    return displayName;
  }

  private validatePassword(password: string) {
    if (typeof password !== "string" || password.length < 10 || password.length > 200) {
      throw new BadRequestException(
        "Le mot de passe doit contenir au moins 10 caracteres.",
      );
    }
  }

  private allowedValue<T extends string>(
    value: string,
    allowed: readonly T[],
    message: string,
  ): T {
    if (!allowed.includes(value as T)) {
      throw new BadRequestException(message);
    }
    return value as T;
  }

  private async hashPassword(password: string, salt: string) {
    const derived = await scryptAsync(password, salt, 64) as Buffer;
    return derived.toString("hex");
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private toUser(row: UserRow): AuthenticatedUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      createdAt: new Date(row.created_at).toISOString(),
      riskProfile: row.risk_profile,
      investmentHorizon: row.investment_horizon,
      investmentObjective: row.investment_objective,
      baseCurrency: row.base_currency,
    };
  }
}
