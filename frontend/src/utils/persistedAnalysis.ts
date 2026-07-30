const SNAPSHOT_VERSION = 1;

export const ANALYSIS_TTL_MS = 15 * 60 * 1000;
export const PORTFOLIO_TTL_MS = 15 * 60 * 1000;
export const RECOMMENDATION_TTL_MS = 30 * 60 * 1000;
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type StoredSnapshot<T> = {
  version: number;
  savedAt: number;
  expiresAt: number;
  value: T;
};

export type PersistedSnapshot<T> = StoredSnapshot<T> & {
  isExpired: boolean;
};

type RemoteSnapshot = {
  scope: string;
  key: string;
  payload: unknown;
  savedAt: string;
  expiresAt: string;
};

type RemoteIdentity = {
  scope: string;
  key: string;
  storageKey: string;
};

function remoteIdentity(storageKey: string): RemoteIdentity | null {
  if (storageKey.startsWith("stock-ai-analysis-v1:")) {
    const ticker = storageKey.slice("stock-ai-analysis-v1:".length);
    return ticker ? { scope: "analysis", key: ticker, storageKey } : null;
  }
  if (storageKey === "stock-ai-portfolio-analysis-v2") {
    return { scope: "portfolio", key: "default", storageKey };
  }
  if (storageKey === "stock-ai-portfolio-v1") {
    return { scope: "portfolio", key: "settings", storageKey };
  }
  if (storageKey === "stock-ai-recommendation-analysis-v2") {
    return { scope: "recommendation", key: "default", storageKey };
  }
  if (storageKey === "stock-ai-recommendation-draft-v2") {
    return { scope: "recommendation_draft", key: "default", storageKey };
  }
  return null;
}

function storageKeyForRemote(scope: string, key: string) {
  if (scope === "analysis") return `stock-ai-analysis-v1:${key}`;
  if (scope === "portfolio" && key === "default") return "stock-ai-portfolio-analysis-v2";
  if (scope === "portfolio" && key === "settings") return "stock-ai-portfolio-v1";
  if (scope === "recommendation" && key === "default") return "stock-ai-recommendation-analysis-v2";
  if (scope === "recommendation_draft" && key === "default") return "stock-ai-recommendation-draft-v2";
  return null;
}

async function persistRemoteSnapshot(
  identity: RemoteIdentity,
  snapshot: StoredSnapshot<unknown>,
) {
  try {
    await fetch(
      `/api/user-data/snapshots/${encodeURIComponent(identity.scope)}/${encodeURIComponent(identity.key)}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: snapshot.value,
          savedAt: new Date(snapshot.savedAt).toISOString(),
          expiresAt: new Date(snapshot.expiresAt).toISOString(),
        }),
      },
    );
  } catch {
    // Local persistence remains available during a temporary network outage.
  }
}

export function readSnapshot<T>(key: string): PersistedSnapshot<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSnapshot<T>;
    if (
      parsed.version !== SNAPSHOT_VERSION
      || !Number.isFinite(parsed.savedAt)
      || !Number.isFinite(parsed.expiresAt)
      || parsed.value == null
    ) {
      localStorage.removeItem(key);
      return null;
    }
    return { ...parsed, isExpired: Date.now() >= parsed.expiresAt };
  } catch {
    return null;
  }
}

export function writeSnapshot<T>(
  key: string,
  value: T,
  ttlMs: number,
): PersistedSnapshot<T> | null {
  const savedAt = Date.now();
  const snapshot: StoredSnapshot<T> = {
    version: SNAPSHOT_VERSION,
    savedAt,
    expiresAt: savedAt + ttlMs,
    value,
  };
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
    const identity = remoteIdentity(key);
    if (identity) {
      void persistRemoteSnapshot(identity, snapshot);
    }
    return { ...snapshot, isExpired: false };
  } catch {
    return null;
  }
}

export function removeSnapshot(key: string) {
  try {
    localStorage.removeItem(key);
    const identity = remoteIdentity(key);
    if (identity) {
      void fetch(
        `/api/user-data/snapshots/${encodeURIComponent(identity.scope)}/${encodeURIComponent(identity.key)}`,
        { method: "DELETE", credentials: "include" },
      ).catch(() => undefined);
    }
  } catch {
    // Storage can be unavailable in private browsing or constrained webviews.
  }
}

export async function synchronizeUserSnapshots() {
  const response = await fetch("/api/user-data/snapshots", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Synchronisation impossible (${response.status}).`);
  }
  const remoteSnapshots = await response.json() as RemoteSnapshot[];
  const remoteByStorageKey = new Map<string, RemoteSnapshot>();
  for (const remote of remoteSnapshots) {
    const storageKey = storageKeyForRemote(remote.scope, remote.key);
    if (storageKey) remoteByStorageKey.set(storageKey, remote);
  }

  const localStorageKeys = Array.from(
    { length: localStorage.length },
    (_, index) => localStorage.key(index),
  ).filter((key): key is string => Boolean(key && remoteIdentity(key)));

  for (const storageKey of localStorageKeys) {
    const identity = remoteIdentity(storageKey);
    const local = readSnapshot<unknown>(storageKey);
    if (!identity || !local) continue;
    const remote = remoteByStorageKey.get(storageKey);
    const remoteSavedAt = remote ? new Date(remote.savedAt).getTime() : 0;
    if (remote && remoteSavedAt > local.savedAt) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: SNAPSHOT_VERSION,
          savedAt: remoteSavedAt,
          expiresAt: new Date(remote.expiresAt).getTime(),
          value: remote.payload,
        }),
      );
    } else if (!remote || local.savedAt > remoteSavedAt) {
      await persistRemoteSnapshot(identity, local);
    }
    remoteByStorageKey.delete(storageKey);
  }

  for (const [storageKey, remote] of remoteByStorageKey) {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        savedAt: new Date(remote.savedAt).getTime(),
        expiresAt: new Date(remote.expiresAt).getTime(),
        value: remote.payload,
      }),
    );
  }
}

export function snapshotAgeLabel(savedAt: number | null) {
  if (!savedAt) return "Aucune sauvegarde";
  const ageMinutes = Math.max(0, Math.floor((Date.now() - savedAt) / 60_000));
  if (ageMinutes < 1) return "Mis a jour a l'instant";
  if (ageMinutes === 1) return "Mis a jour il y a 1 min";
  if (ageMinutes < 60) return `Mis a jour il y a ${ageMinutes} min`;
  const ageHours = Math.floor(ageMinutes / 60);
  return `Mis a jour il y a ${ageHours} h`;
}
