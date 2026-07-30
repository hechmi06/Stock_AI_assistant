import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <AuthGate>
    {({ user, logout, updateUser }) => (
      <App user={user} onLogout={logout} onUserUpdated={updateUser} />
    )}
  </AuthGate>,
);
