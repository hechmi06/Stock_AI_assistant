import {
  BarChart3,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  type AuthUser,
} from "../services/authApi";
import { synchronizeUserSnapshots } from "../utils/persistedAnalysis";

export function AuthGate({
  children,
}: {
  children: (session: {
    user: AuthUser;
    logout: () => Promise<void>;
    updateUser: (user: AuthUser) => void;
  }) => ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then(async (currentUser) => {
        if (!currentUser || !active) return;
        await synchronizeUserSnapshots();
        if (active) setUser(currentUser);
      })
      .catch(() => {
        if (active) setError("Le service utilisateur est indisponible.");
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const nextUser = mode === "register"
        ? await registerUser(displayName, email, password)
        : await loginUser(email, password);
      await synchronizeUserSnapshots();
      setUser(nextUser);
      setPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Authentification indisponible.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try {
      await logoutUser();
    } finally {
      setUser(null);
      setPassword("");
    }
  }

  if (checkingSession) {
    return (
      <main className="auth-loading">
        <BarChart3 size={28} />
        <strong>Chargement de votre espace</strong>
      </main>
    );
  }

  if (user) {
    return <>{children({ user, logout, updateUser: setUser })}</>;
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <header>
          <div className="auth-brand"><BarChart3 size={22} /></div>
          <div>
            <span>Stock AI Assistant</span>
            <h1>{mode === "login" ? "Connexion" : "Creer votre compte"}</h1>
          </div>
        </header>

        <div className="auth-mode" role="tablist" aria-label="Mode d'authentification">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(null); }}>
            Connexion
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(null); }}>
            Inscription
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          {mode === "register" ? (
            <label>
              <span>Nom affiche</span>
              <div><UserRound size={16} /><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={120} required /></div>
            </label>
          ) : null}
          <label>
            <span>Email</span>
            <div><Mail size={16} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required /></div>
          </label>
          <label>
            <span>Mot de passe</span>
            <div>
              <LockKeyhole size={16} />
              <input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={200} required />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Verification..." : mode === "login" ? "Se connecter" : "Creer le compte"}
          </button>
        </form>

        <footer>
          <LockKeyhole size={13} />
          Session securisee et donnees isolees par compte
        </footer>
      </section>
    </main>
  );
}
