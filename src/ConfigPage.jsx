// ConfigPage.jsx
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

export default function ConfigPage() {
  //  Original section (edited via backend http://localhost:3001) 
  const [people, setPeople] = useState([
    { name: "", role: "" },
    { name: "", role: "" },
    { name: "", role: "" }
  ]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("http://localhost:3001/people", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Not OK");
        const data = await res.json();
        setPeople(data.people || people);
      } catch {
        setMsg("Konnte Personen nicht laden (eingeloggt?)");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLocal = (idx, field, val) => {
    setPeople(p => {
      const copy = [...p];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const saveSlot = async (slot) => {
    setMsg("");
    try {
      const res = await fetch(`http://localhost:3001/people/${slot}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(people[slot - 1]),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      setPeople(data.people || people);
      setMsg(`Person ${slot} gespeichert ✅`);
    } catch {
      setMsg(`Speichern fehlgeschlagen ❌`);
    } finally {
      setTimeout(() => setMsg(""), 2000);
    }
  };

  const clearSlot = async (slot) => {
    try {
      const res = await fetch(`http://localhost:3001/people/${slot}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      setPeople(data.people || people);
      setMsg(`Person ${slot} gelöscht 🗑️`);
      setTimeout(() => setMsg(""), 2000);
    } catch {}
  };

  //  NEW: “Aktuelle Konfiguration” reading LIVE from the ESP32 (http://<ip>/api/state) 
  const [deviceBase, setDeviceBase] = useState(
    () => window.localStorage.getItem("deviceBase") || ""
  );
  const [devicePeople, setDevicePeople] = useState([
    { name: "", role: "" },
    { name: "", role: "" },
    { name: "", role: "" }
  ]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState("");

  const normalizeBase = (u) => {
    u = (u || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "http://" + u; // http:// 
    return u.replace(/\/+$/, ""); 
  };

  const loadDeviceState = async () => {
    const base = normalizeBase(deviceBase);
    if (!base) {
      setDeviceMsg("Bitte Geräte-URL eingeben");
      return;
    }
    setDeviceLoading(true);
    setDeviceMsg("Lade Gerät…");
    try {
      const res = await fetch(`${base}/api/state`, { method: "GET" });
      if (!res.ok) throw new Error("Gerät nicht erreichbar");
      const data = await res.json();
      const arr = (data.people || []).slice(0, 3).map(p => ({
        name: p?.name || "",
        role: p?.role || ""
      }));
      while (arr.length < 3) arr.push({ name: "", role: "" });
      setDevicePeople(arr);
      setDeviceMsg("Aktualisiert ✔️");
      window.localStorage.setItem("deviceBase", deviceBase.trim());
    } catch (e) {
      setDeviceMsg("Konnte Gerät nicht laden ❌");
    } finally {
      setDeviceLoading(false);
      setTimeout(() => setDeviceMsg(""), 2000);
    }
  };

  // Auto-load if an IP/Host was already saved
  useEffect(() => {
    if (deviceBase) {
      loadDeviceState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div style={{ padding: 16 }}>Lade…</div>;

  return (
    <div style={{ padding: "1rem", maxWidth: 800 }}>
      <h2>Konfiguration – Personen (Backend)</h2>

      {[0,1,2].map(i => (
        <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto auto",
          gap: ".5rem",
          marginBottom: ".5rem",
          alignItems: "center"
        }}>
          <input
            placeholder="Name"
            value={people[i].name}
            onChange={e => updateLocal(i, "name", e.target.value)}
          />
          <input
            placeholder="Beschäftigung"
            value={people[i].role}
            onChange={e => updateLocal(i, "role", e.target.value)}
          />
          <button onClick={() => saveSlot(i+1)}>Speichern</button>
          <button onClick={() => clearSlot(i+1)}>Löschen</button>
        </div>
      ))}

      {msg && <div style={{ marginTop: ".5rem" }}>{msg}</div>}

      {/* NEW BLOCK: Current configuration of the DEVICE */}
      <div style={{ marginTop: "2rem" }}>
        <h2>Aktuelle Konfiguration (Gerät)</h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: ".5rem",
          maxWidth: 600,
          alignItems: "center"
        }}>
          <input
            placeholder="Geräte-URL (z. B. 172.22.19.238 oder door.local)"
            value={deviceBase}
            onChange={(e) => setDeviceBase(e.target.value)}
          />
          <button disabled={deviceLoading || !deviceBase.trim()} onClick={loadDeviceState}>
            {deviceLoading ? "Laden…" : "Laden"}
          </button>
        </div>

        {deviceMsg && <div style={{ marginTop: ".5rem" }}>{deviceMsg}</div>}

        <div style={{ marginTop: ".75rem" }}>
          {deviceLoading ? (
            <div>Lade Konfiguration…</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, maxWidth: 600 }}>
              {devicePeople.map((p, i) => (
                <li key={i} style={{ padding: ".5rem 0", borderBottom: "1px solid #eee" }}>
                  <strong>{p.name || "—"}</strong>
                  <span style={{ marginLeft: 8, color: "#666" }}>
                    {p.role || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <Link to="/"><button>Zurück</button></Link>
      </div>
    </div>
  );
}
