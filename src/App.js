// App.js
import './App.css';
import MyCalendar from './MyCalendar';
import Header from './header';
import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
//import ConfigPage from './ConfigPage';

// Widget für die aktuelle Konfiguration
function CurrentConfig({ isLoggedIn }) {
  const [people, setPeople] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    if (!isLoggedIn) { setPeople(null); setLoading(false); return; }
    setLoading(true);
    setErr("");
    try {
      const res = await fetch('http://localhost:3001/people', { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setPeople(data.people || []);
    } catch (e) {
      setErr("Konnte Konfiguration nicht laden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isLoggedIn]);
  // mögliche Anzeige für aktuelle Konfiguration
  /*return (
    <div className="config-widget">
      <div className="config-widget-header">
        <strong>Aktuelle Konfiguration</strong>
        <button className="refresh-btn" onClick={load}>Aktualisieren</button>
      </div>

      {loading ? (
        <div>Lade…</div>
      ) : !isLoggedIn ? (
        <div>Keine Daten – bitte einloggen.</div>
      ) : err ? (
        <div>{err}</div>
      ) : (
        <ul className="config-widget-list">
          {[0,1,2].map(i => {
            const p = people?.[i] || { name: "", role: "" };
            const filled = (p.name?.trim() || p.role?.trim());
            return (
              <li key={i}>
                {filled ? (
                  <span>
                    <strong>{p.name || "—"}</strong>
                    {p.role ? <> — <em>{p.role}</em></> : null}
                  </span>
                ) : <span>Slot {i+1}: leer</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
  */
}

function Home({ user, loadingUser, login, logout }) {
  return (
    <div style={{ padding: '1rem' }}>
      <Header />

      {/* Kalender */}
      <MyCalendar isLoggedIn={!!user} />

      {/* Button zur Unterseite */}
      <div>
        <a className="btn-config" href="/konfiguration.html">
          Konfiguration
        </a>
      </div>

      {/* NEU: Anzeige der aktuellen Konfiguration direkt darunter */}
      <CurrentConfig isLoggedIn={!!user} />

      {/* Login/Logout-Bereich */}
      <div style={{ marginTop: '1rem' }}>
        {loadingUser ? (
          <div>Lade Benutzer…</div>
        ) : user ? (
          <div>
            <div>Angemeldet als: {user.name || user.preferred_username || user.email}</div>
            <button onClick={logout}>Logout</button>
          </div>
        ) : (
          <div>
            <button className="btn-login" onClick={login}>Login (über Shibboleth)</button>
          </div>
        )}
      </div>
    </div>
  );
}


function App() {
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    async function getUser() {
      try {
        const res = await fetch('http://localhost:3001/userinfo', {
          method: 'GET',
          credentials: 'include'
        });
        const data = await res.json();
        if (data.loggedIn) setUser(data.claims);
        else setUser(null);
      } catch (err) {
        console.error('Fehler beim Holen der Userinfo:', err);
      } finally {
        setLoadingUser(false);
      }
    }
    getUser();
  }, []);

  const login = () => {
    window.location.href = 'http://localhost:3001/login';
  };

  const logout = async () => {
    try {
      const r = await fetch('http://localhost:3001/logout', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await r.json();
      setUser(null);

      // 1) App sofort „zurück“ (bleib bei dir in der App)
      if (data.appRedirect) window.history.pushState({}, '', data.appRedirect);

      // 2) IdP-Logout in neuem Tab/Popup öffnen (beendet SSO-Kette dort)
      if (data.providerLogout) {
        window.open(data.providerLogout, '_blank', 'noopener'); // neuer Tab
      }
    } catch (err) {
      console.error('Logout error', err);
    }
  };

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={<Home user={user} loadingUser={loadingUser} login={login} logout={logout} />}
        />
       <Route path="/config" element={<Navigate to="/konfiguration.html" replace />} />
      </Routes>
    </Router>
  );
}

export default App;

