import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";

const ALLOWED_SCOPES = new Set([
  "analysis",
  "portfolio",
  "recommendation",
  "recommendation_draft",
]);
const MAX_PAYLOAD_BYTES = 2_000_000;

type SnapshotRow = {
  scope: string;
  snapshot_key: string;
  payload: unknown;
  saved_at: Date;
  expires_at: Date;
};

@Injectable()
export class UserDataService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string) {
    const result = await this.database.query<SnapshotRow>(
      `SELECT scope, snapshot_key, payload, saved_at, expires_at
       FROM user_snapshots
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      scope: row.scope,
      key: row.snapshot_key,
      payload: row.payload,
      savedAt: row.saved_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }));
  }

  async save(
    userId: string,
    scopeValue: string,
    keyValue: string,
    input: { payload: unknown; savedAt: string; expiresAt: string },
  ) {
    const { scope, key } = this.validateIdentity(scopeValue, keyValue);
    const savedAt = this.parseDate(input.savedAt, "savedAt");
    const expiresAt = this.parseDate(input.expiresAt, "expiresAt");
    if (expiresAt.getTime() <= savedAt.getTime()) {
      throw new BadRequestException("expiresAt doit etre posterieur a savedAt.");
    }
    const serialized = JSON.stringify(input.payload);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      throw new BadRequestException("Instantane trop volumineux.");
    }

    await this.database.query(
      `INSERT INTO user_snapshots
        (id, user_id, scope, snapshot_key, payload, saved_at, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (user_id, scope, snapshot_key)
       DO UPDATE SET
         payload = EXCLUDED.payload,
         saved_at = EXCLUDED.saved_at,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()
       WHERE user_snapshots.saved_at <= EXCLUDED.saved_at`,
      [randomUUID(), userId, scope, key, serialized, savedAt, expiresAt],
    );
    return { scope, key, payload: input.payload, savedAt, expiresAt };
  }

  async remove(userId: string, scopeValue: string, keyValue: string) {
    const { scope, key } = this.validateIdentity(scopeValue, keyValue);
    await this.database.query(
      `DELETE FROM user_snapshots
       WHERE user_id = $1 AND scope = $2 AND snapshot_key = $3`,
      [userId, scope, key],
    );
  }

  private validateIdentity(scopeValue: string, keyValue: string) {
    const scope = String(scopeValue ?? "").trim().toLowerCase();
    const key = String(keyValue ?? "").trim();
    if (!ALLOWED_SCOPES.has(scope)) {
      throw new BadRequestException("Type d'instantane non autorise.");
    }
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
      throw new BadRequestException("Cle d'instantane invalide.");
    }
    return { scope, key };
  }

  private parseDate(value: string, field: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} est invalide.`);
    }
    return date;
  }
}
