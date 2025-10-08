import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

export default function ConfigPage() {
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

  if (loading) return <div style={{ padding: 16 }}>Lade…</div>;

  return (
    <div style={{ padding: "1rem", maxWidth: 600 }}>
      <h2>Konfiguration – Personen</h2>

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

      <div style={{ marginTop: "1rem" }}>
        <Link to="/"><button>Zurück</button></Link>
      </div>
    </div>
  );
}


