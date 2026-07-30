import {
  BadgeCheck,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  changeUserPassword,
  updateUserProfile,
  type AuthUser,
} from "../services/authApi";

type ProfileForm = Pick<
  AuthUser,
  | "displayName"
  | "riskProfile"
  | "investmentHorizon"
  | "investmentObjective"
  | "baseCurrency"
>;

const riskOptions: Array<{
  value: AuthUser["riskProfile"];
  label: string;
  description: string;
}> = [
  {
    value: "conservative",
    label: "Prudent",
    description: "Priorité à la préservation du capital.",
  },
  {
    value: "moderate",
    label: "Équilibré",
    description: "Compromis entre stabilité et croissance.",
  },
  {
    value: "dynamic",
    label: "Dynamique",
    description: "Accepte davantage de volatilité.",
  },
];

const horizonLabels: Record<AuthUser["investmentHorizon"], string> = {
  short_term: "Moins de 2 ans",
  medium_term: "2 à 5 ans",
  long_term: "Plus de 5 ans",
};

const objectiveLabels: Record<AuthUser["investmentObjective"], string> = {
  capital_preservation: "Préserver le capital",
  income: "Générer des revenus",
  balanced: "Équilibre revenu / croissance",
  growth: "Croissance du capital",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function membershipDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function PasswordField({
  label,
  value,
  visible,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  visible: boolean;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      <div>
        <LockKeyhole size={16} />
        <input
          type={visible ? "text" : "password"}
          value={value}
          minLength={10}
          maxLength={200}
          autoComplete={autoComplete}
          required
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </label>
  );
}

export function UserProfile({
  user,
  onUserUpdated,
  onLogout,
}: {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProfileForm>({
    displayName: user.displayName,
    riskProfile: user.riskProfile,
    investmentHorizon: user.investmentHorizon,
    investmentObjective: user.investmentObjective,
    baseCurrency: user.baseCurrency,
  });
  const [saving, setSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    setForm({
      displayName: user.displayName,
      riskProfile: user.riskProfile,
      investmentHorizon: user.investmentHorizon,
      investmentObjective: user.investmentObjective,
      baseCurrency: user.baseCurrency,
    });
  }, [user]);

  const isDirty = useMemo(
    () =>
      form.displayName.trim() !== user.displayName
      || form.riskProfile !== user.riskProfile
      || form.investmentHorizon !== user.investmentHorizon
      || form.investmentObjective !== user.investmentObjective
      || form.baseCurrency !== user.baseCurrency,
    [form, user],
  );

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const updated = await updateUserProfile({
        ...form,
        displayName: form.displayName.trim(),
      });
      onUserUpdated(updated);
      setProfileMessage("Profil enregistré.");
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : "Mise à jour indisponible.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("Les nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setChangingPassword(true);
    try {
      await changeUserPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(
        "Mot de passe modifié. Les autres sessions ont été fermées.",
      );
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : "Modification indisponible.",
      );
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="profile-page">
      <header className="profile-heading">
        <div>
          <span>Compte utilisateur</span>
          <h2>Mon profil</h2>
          <p>Identité, préférences d'analyse et sécurité du compte.</p>
        </div>
        <button
          className="profile-logout"
          type="button"
          onClick={() => void onLogout()}
        >
          <LogOut size={16} /> Se déconnecter
        </button>
      </header>

      <section className="profile-identity" aria-label="Identité du compte">
        <div className="profile-monogram">{initials(user.displayName)}</div>
        <div className="profile-person">
          <strong>{user.displayName}</strong>
          <span><Mail size={14} /> {user.email}</span>
        </div>
        <div className="profile-fact">
          <BadgeCheck size={17} />
          <span>Rôle</span>
          <strong>{user.role === "user" ? "Investisseur" : user.role}</strong>
        </div>
        <div className="profile-fact">
          <CalendarDays size={17} />
          <span>Membre depuis</span>
          <strong>{membershipDate(user.createdAt)}</strong>
        </div>
        <div className="profile-fact">
          <ShieldCheck size={17} />
          <span>Session</span>
          <strong>Sécurisée</strong>
        </div>
      </section>

      <div className="profile-columns">
        <form
          className="profile-section"
          onSubmit={(event) => void saveProfile(event)}
        >
          <div className="profile-section-title">
            <UserRound size={19} />
            <div>
              <h3>Préférences du profil</h3>
              <p>
                Ces paramètres serviront aux recommandations personnalisées.
              </p>
            </div>
          </div>

          <label className="profile-field">
            <span>Nom affiché</span>
            <div>
              <UserRound size={16} />
              <input
                value={form.displayName}
                minLength={2}
                maxLength={120}
                required
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </div>
          </label>

          <fieldset className="profile-risk-field">
            <legend>Profil de risque</legend>
            <div className="profile-risk-options">
              {riskOptions.map((option) => (
                <label
                  className={form.riskProfile === option.value ? "selected" : ""}
                  key={option.value}
                >
                  <input
                    type="radio"
                    name="riskProfile"
                    value={option.value}
                    checked={form.riskProfile === option.value}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        riskProfile: option.value,
                      }))
                    }
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {form.riskProfile === option.value ? <Check size={16} /> : null}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="profile-form-grid">
            <label className="profile-field">
              <span>Horizon</span>
              <select
                value={form.investmentHorizon}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    investmentHorizon:
                      event.target.value as AuthUser["investmentHorizon"],
                  }))
                }
              >
                {Object.entries(horizonLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span>Objectif principal</span>
              <select
                value={form.investmentObjective}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    investmentObjective:
                      event.target.value as AuthUser["investmentObjective"],
                  }))
                }
              >
                {Object.entries(objectiveLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span>Devise de référence</span>
              <select
                value={form.baseCurrency}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseCurrency:
                      event.target.value as AuthUser["baseCurrency"],
                  }))
                }
              >
                <option value="USD">USD · Dollar américain</option>
                <option value="EUR">EUR · Euro</option>
                <option value="TND">TND · Dinar tunisien</option>
              </select>
            </label>
          </div>

          <div className="profile-form-footer">
            <span
              className={profileError ? "form-status error" : "form-status success"}
            >
              {profileError || profileMessage}
            </span>
            <button
              className="profile-primary-action"
              type="submit"
              disabled={!isDirty || saving}
            >
              <Save size={16} />
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>

        <aside className="profile-side">
          <form
            className="profile-section security-section"
            onSubmit={(event) => void savePassword(event)}
          >
            <div className="profile-section-title">
              <KeyRound size={19} />
              <div>
                <h3>Sécurité</h3>
                <p>Modifiez le mot de passe de votre compte.</p>
              </div>
            </div>

            <PasswordField
              label="Mot de passe actuel"
              value={currentPassword}
              visible={showPasswords}
              autoComplete="current-password"
              onChange={setCurrentPassword}
            />
            <PasswordField
              label="Nouveau mot de passe"
              value={newPassword}
              visible={showPasswords}
              autoComplete="new-password"
              onChange={setNewPassword}
            />
            <PasswordField
              label="Confirmer le nouveau mot de passe"
              value={confirmPassword}
              visible={showPasswords}
              autoComplete="new-password"
              onChange={setConfirmPassword}
            />

            <button
              className="profile-password-toggle"
              type="button"
              onClick={() => setShowPasswords((current) => !current)}
            >
              {showPasswords ? <EyeOff size={15} /> : <Eye size={15} />}
              {showPasswords
                ? "Masquer les mots de passe"
                : "Afficher les mots de passe"}
            </button>

            <span
              className={passwordError ? "form-status error" : "form-status success"}
            >
              {passwordError || passwordMessage}
            </span>
            <button
              className="profile-secondary-action"
              type="submit"
              disabled={changingPassword}
            >
              <KeyRound size={16} />
              {changingPassword
                ? "Modification..."
                : "Modifier le mot de passe"}
            </button>
          </form>

          <section className="profile-guidance">
            <WalletCards size={19} />
            <div>
              <strong>Personnalisation progressive</strong>
              <p>
                Le profil investisseur est stocké avec le compte. Il sera
                utilisé comme contrainte explicite par le moteur de
                recommandation, sans modifier vos analyses mono-action.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
