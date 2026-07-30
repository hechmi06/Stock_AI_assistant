import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PGlite } from "@electric-sql/pglite";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Pool, type QueryResultRow } from "pg";

type DatabaseDriver = "postgresql" | "pglite" | "unavailable";

export type DatabaseQueryResult<T> = {
  rows: T[];
  rowCount: number | null;
};

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private pglite: PGlite | null = null;
  private driver: DatabaseDriver = "unavailable";
  private available = false;
  private localOwnerFile: string | null = null;

  async onModuleInit() {
    try {
      if (process.env.DATABASE_URL) {
        this.pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
        });
        await this.pool.query("SELECT 1");
        this.driver = "postgresql";
      } else {
        const dataDirectory =
          process.env.PGLITE_DATA_DIR
          ?? resolve(__dirname, "..", "..", "data", "user-db");
        mkdirSync(dataDirectory, { recursive: true });
        this.claimLocalDatabase(dataDirectory);
        this.pglite = await PGlite.create(dataDirectory);
        await this.pglite.query("SELECT 1");
        this.driver = "pglite";
      }
      await this.migrate();
      this.available = true;
      this.logger.log(
        `${this.driver === "postgresql" ? "PostgreSQL" : "PGlite local"} connected and schema ready.`,
      );
    } catch (error) {
      this.available = false;
      this.driver = "unavailable";
      this.releaseLocalDatabase();
      this.logger.error(
        `User database unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
    await this.pglite?.close();
    this.releaseLocalDatabase();
  }

  isAvailable() {
    return this.available;
  }

  getDriver() {
    return this.driver;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<DatabaseQueryResult<T>> {
    this.assertAvailable();
    if (this.pool) {
      const result = await this.pool.query<T>(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
    const result = await this.pglite!.query<T>(text, values);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? null,
    };
  }

  private assertAvailable() {
    if (!this.available) {
      throw new ServiceUnavailableException(
        "La base utilisateur est indisponible.",
      );
    }
  }

  private claimLocalDatabase(dataDirectory: string) {
    const ownerFile = join(dataDirectory, ".gateway-owner");
    try {
      const ownerPid = Number(readFileSync(ownerFile, "utf8"));
      if (Number.isInteger(ownerPid) && this.isProcessAlive(ownerPid)) {
        throw new Error(
          `La base locale est deja utilisee par le processus ${ownerPid}.`,
        );
      }
      rmSync(ownerFile, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    // PGlite can leave this PostgreSQL lock behind after a forced process stop.
    rmSync(join(dataDirectory, "postmaster.pid"), { force: true });
    writeFileSync(ownerFile, String(process.pid), { flag: "wx" });
    this.localOwnerFile = ownerFile;
  }

  private releaseLocalDatabase() {
    if (!this.localOwnerFile) return;
    try {
      if (readFileSync(this.localOwnerFile, "utf8").trim() === String(process.pid)) {
        rmSync(this.localOwnerFile, { force: true });
      }
    } catch {
      // The owner file may already be gone after an interrupted local shutdown.
    }
    this.localOwnerFile = null;
  }

  private isProcessAlive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async migrate() {
    const migration = `
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email varchar(320) NOT NULL UNIQUE,
        display_name varchar(120) NOT NULL,
        password_salt varchar(128) NOT NULL,
        password_hash varchar(256) NOT NULL,
        role varchar(32) NOT NULL DEFAULT 'user',
        is_active boolean NOT NULL DEFAULT true,
        risk_profile varchar(32) NOT NULL DEFAULT 'moderate',
        investment_horizon varchar(32) NOT NULL DEFAULT 'long_term',
        investment_objective varchar(40) NOT NULL DEFAULT 'balanced',
        base_currency char(3) NOT NULL DEFAULT 'USD',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS risk_profile varchar(32) NOT NULL DEFAULT 'moderate';
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS investment_horizon varchar(32) NOT NULL DEFAULT 'long_term';
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS investment_objective varchar(40) NOT NULL DEFAULT 'balanced';
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS base_currency char(3) NOT NULL DEFAULT 'USD';

      CREATE TABLE IF NOT EXISTS user_sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        user_agent varchar(500),
        ip_address varchar(80)
      );

      CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
        ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx
        ON user_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS user_snapshots (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope varchar(40) NOT NULL,
        snapshot_key varchar(160) NOT NULL,
        payload jsonb NOT NULL,
        saved_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, scope, snapshot_key)
      );

      CREATE INDEX IF NOT EXISTS user_snapshots_user_scope_idx
        ON user_snapshots(user_id, scope);
      CREATE INDEX IF NOT EXISTS user_snapshots_expires_at_idx
        ON user_snapshots(expires_at);
    `;
    if (this.pool) {
      await this.pool.query(migration);
    } else {
      await this.pglite!.exec(migration);
    }
  }
}
