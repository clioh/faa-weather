/**
 * Calendar Module
 * Displays upcoming calendar events
 */

import { useEffect, useState } from 'react';
import { ModuleProps } from './index';

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
}

interface CalendarConfig {
  calendarUrl?: string;
  maxEvents?: number;
  daysAhead?: number;
}

export function CalendarModule({ config }: ModuleProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);

  const calendarConfig = config as CalendarConfig;
  const maxEvents = calendarConfig.maxEvents || 10;

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('/api/schedule/events');
        if (!response.ok) throw new Error('Failed to fetch events');
        const data = await response.json();
        setEvents(data.events?.slice(0, maxEvents) || []);
        setError(null);
      } catch (err) {
        // Use demo data if API fails
        setEvents([
          {
            id: '1',
            title: 'Configure calendar',
            start: new Date(),
            end: new Date(),
            allDay: true,
          },
        ]);
        setError(null);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [maxEvents]);

  if (loading) {
    return <div className="module-loading">Loading events...</div>;
  }

  const formatEventTime = (event: CalendarEvent) => {
    if (event.allDay) return 'All day';
    return new Date(event.start).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatEventDate = (event: CalendarEvent) => {
    const eventDate = new Date(event.start);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (eventDate.toDateString() === today.toDateString()) return 'Today';
    if (eventDate.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="calendar-module">
      <div className="calendar-header">
        <span className="calendar-title">Upcoming</span>
      </div>

      <div className="events-list">
        {events.length === 0 ? (
          <div className="no-events">No upcoming events</div>
        ) : (
          events.map(event => (
            <div key={event.id} className="event-item">
              <div className="event-date">{formatEventDate(event)}</div>
              <div className="event-details">
                <span className="event-title">{event.title}</span>
                <span className="event-time">{formatEventTime(event)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .calendar-module {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .calendar-header {
          margin-bottom: 0.75rem;
          flex-shrink: 0;
        }

        .calendar-title {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .events-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .no-events {
          color: var(--color-text-dim);
          font-style: italic;
          text-align: center;
          padding: 1rem;
        }

        .event-item {
          display: flex;
          gap: 0.75rem;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          border-left: 3px solid var(--color-accent);
        }

        .event-date {
          font-size: 0.7rem;
          color: var(--color-accent);
          text-transform: uppercase;
          min-width: 60px;
        }

        .event-details {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .event-title {
          font-size: 0.9rem;
          font-weight: 500;
        }

        .event-time {
          font-size: 0.75rem;
          color: var(--color-text-dim);
        }
      `}</style>
    </div>
  );
}
