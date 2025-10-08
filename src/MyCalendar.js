import { useEffect, useMemo, useState } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import './MyCalendar.css';

const terminOptionen = ["Out of Office", "On Vacation", "Available", "Meeting"];

function MyCalendar({ isLoggedIn }) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState({});
  const [selectedTermin, setSelectedTermin] = useState(terminOptionen[0]);
  const [error, setError] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);

  const formattedDate = useMemo(
    () => selectedDate.toISOString().split('T')[0],
    [selectedDate]
  );

  // Events nur laden, wenn eingeloggt
  useEffect(() => {
    if (!isLoggedIn) {
      setEvents({});
      return;
    }
    (async () => {
      setLoadingEvents(true);
      setError('');
      try {
        const res = await fetch('http://localhost:3001/events', {
          credentials: 'include'
        });
        if (!res.ok) {
          if (res.status === 401) {
            setError('Nicht eingeloggt. Bitte zuerst anmelden.');
          } else {
            setError('Fehler beim Laden der Events.');
          }
          return;
        }
        const data = await res.json();
        setEvents(data || {});
      } catch (e) {
        console.error(e);
        setError('Netzwerkfehler beim Laden der Events.');
      } finally {
        setLoadingEvents(false);
      }
    })();
  }, [isLoggedIn]);

  const handleAddEvent = async () => {
    if (!isLoggedIn) {
      setError('Bitte zuerst einloggen, um Events zu speichern.');
      return;
    }
    setError('');
    try {
      const res = await fetch('http://localhost:3001/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date: formattedDate, status: selectedTermin })
      });
      if (!res.ok) {
        if (res.status === 401) setError('Session abgelaufen. Bitte erneut einloggen.');
        else setError('Fehler beim Speichern des Events.');
        return;
      }
      const data = await res.json();
      setEvents(data || {});
    } catch (e) {
      console.error(e);
      setError('Netzwerkfehler beim Speichern.');
    }
  };

  const handleDeleteEvent = async (eventToDelete) => {
    if (!isLoggedIn) {
      setError('Bitte zuerst einloggen, um Events zu löschen.');
      return;
    }
    setError('');
    try {
      const res = await fetch('http://localhost:3001/events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date: formattedDate, status: eventToDelete })
      });
      if (!res.ok) {
        if (res.status === 401) setError('Session abgelaufen. Bitte erneut einloggen.');
        else setError('Fehler beim Löschen des Events.');
        return;
      }
      const data = await res.json();
      setEvents(data || {});
    } catch (e) {
      console.error(e);
      setError('Netzwerkfehler beim Löschen.');
    }
  };

  return (
    <div className="calendar-container">
      <h2>Kalender</h2>

      {!isLoggedIn && (
        <div style={{ marginBottom: '0.5rem', color: '#b45309' }}>
          Du bist nicht eingeloggt. Melde dich an, um Termine zu speichern.
        </div>
      )}

      {error && (
        <div style={{ marginBottom: '0.5rem', color: '#dc2626' }}>
          {error}
        </div>
      )}

      <Calendar
        onChange={setSelectedDate}
        value={selectedDate}
        tileClassName={({ date, view }) => {
          if (view === 'month') {
            const dateStr = date.toISOString().split('T')[0];
            if (events[dateStr] && events[dateStr].length > 0) {
              return 'highlight';
            }
          }
          return null;
        }}
      />

      <div className="event-box">
        <h3>Termine für {formattedDate}</h3>

        {loadingEvents ? (
          <div>Lade Events…</div>
        ) : (
          <>
            <ul>
              {(events[formattedDate] || []).map((e, idx) => (
                <li key={idx}>
                  📌 {e}
                  <button
                    onClick={() => handleDeleteEvent(e)}
                    style={{
                      marginLeft: '10px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '0.2rem 0.5rem',
                      cursor: 'pointer',
                    }}
                    disabled={!isLoggedIn}
                    title={!isLoggedIn ? 'Bitte zuerst einloggen' : undefined}
                  >
                    Löschen
                  </button>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <select
                className="status-select"
                value={selectedTermin}
                onChange={(e) => setSelectedTermin(e.target.value)}
              >
                {terminOptionen.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <div> 
                <button
                  className="btn-add"
                  onClick={handleAddEvent}
                  disabled={!isLoggedIn}
                  title={!isLoggedIn ? 'Bitte zuerst einloggen' : undefined}
                >
                  Hinzufügen
                </button>
              </div>   
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MyCalendar;



