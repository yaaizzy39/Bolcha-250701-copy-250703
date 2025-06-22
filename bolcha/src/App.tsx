import { useEffect, useState } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import Login from "./pages/Login";
import Rooms from "./pages/Rooms";
import ChatRoom from "./pages/ChatRoom";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";

// Minimal abstract icons
const IconGrid = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/>
    <rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/>
  </svg>
);
const IconSliders = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/>
    <line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/>
    <line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/>
    <line x1="9" y1="8" x2="15" y2="8"/>
    <line x1="17" y1="16" x2="23" y2="16"/>
  </svg>
);
const IconCog = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import useIsAdmin from "./hooks/useIsAdmin";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const isAdmin = useIsAdmin(user);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return unsub;
  }, []);

  if (!user) {
    return <Login />;
  }

  const location = useLocation();
  const hideNav = location.pathname.startsWith("/profile");

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "1rem 1rem 0 1rem" }}>
        <h2 style={{ margin: 0, lineHeight: 1 }}><Link to="/" style={{ textDecoration: "none", color: "inherit" }}>Bolcha</Link></h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {!hideNav && (
            <>
              <Link to="/" title="Rooms"><IconGrid /></Link>
              {isAdmin && <Link to="/admin" title="Admin"><IconSliders /></Link>}
              <Link to="/profile" title="Settings"><IconCog /></Link>
            </>
          )}
          {user && (
            <>
              <span style={{ fontSize: "0.98rem", color: "#333" }}>{user.displayName || "Me"}</span>
              <img
                src={user.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23ddd'/%3E%3Ccircle cx='16' cy='13' r='6' fill='%23bbb'/%3E%3Cellipse cx='16' cy='24' rx='9' ry='6' fill='%23bbb'/%3E%3C/svg%3E"}
                alt="my avatar"
                width={28}
                height={28}
                style={{ borderRadius: "50%", background: "#eee", marginLeft: 4, marginRight: 4 }}
              />
            </>
          )}
        </div>
      </header>
      <main style={{ padding: "0 1rem 1rem 1rem" }}>
        <Routes>
          <Route path="/" element={<Rooms user={user!} />} />
          <Route path="/rooms/:roomId" element={<ChatRoom user={user!} />} />
          <Route path="/profile" element={<Profile user={user!} />} />
          {isAdmin && <Route path="/admin" element={<Admin user={user!} />} />}
            <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
