import { useMemo } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { WidgetStatus } from '../WidgetStatus';

interface ScheduleEvent {
  id: string;
  source: 'google' | 'xlsx';
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location?: string;
  isFlightDuty?: boolean;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  reportTime?: string;
}

interface ScheduleResponse {
  events?: ScheduleEvent[];
  flights?: ScheduleEvent[];
}

interface ScheduleWidgetProps {
  position: string;
  daysAhead?: number;
  showFlightsOnly?: boolean;
  eveningHour?: number; // Hour (24h) after which to show tomorrow if today is done
}

export function ScheduleWidget({
  position,
  daysAhead = 7,
  showFlightsOnly = false,
  eveningHour = 20, // 8 PM default
}: ScheduleWidgetProps) {
  const endpoint = showFlightsOnly
    ? `/api/schedule/flights?days=${daysAhead}`
    : `/api/schedule?days=${daysAhead}`;

  const {
    data,
    loading,
    refreshing,
    error,
    isStale,
    lastUpdated,
    retryCount,
    retry,
  } = useFetch<ScheduleResponse>(endpoint, {
    refreshInterval: 30 * 60 * 1000, // 30 minutes
    maxRetries: 3,
    keepStaleData: true,
  });

  const events = data?.events || data?.flights || [];

  // Contextual awareness: determine what to show based on time of day
  const { contextualEvents, contextHeader, nextEvent } = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toDateString();

    // Filter to upcoming events only
    const upcomingEvents = events.filter(e => new Date(e.endTime) > now);

    // Separate today's and tomorrow's events
    const todayEvents = upcomingEvents.filter(
      e => new Date(e.startTime).toDateString() === today
    );
    const tomorrowEvents = upcomingEvents.filter(
      e => new Date(e.startTime).toDateString() === tomorrowStr
    );

    // Find next event
    const sortedUpcoming = [...upcomingEvents].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    const next = sortedUpcoming[0] || null;

    // Contextual logic:
    // If it's evening (after eveningHour) and no more events today, focus on tomorrow
    const isEvening = currentHour >= eveningHour;
    const todayIsDone = todayEvents.length === 0;

    let header = showFlightsOnly ? 'Upcoming Flights' : 'Schedule';
    let contextEvents = upcomingEvents;

    if (isEvening && todayIsDone && tomorrowEvents.length > 0) {
      header = "Tomorrow's Schedule";
      // Still show all upcoming, but the header indicates context
    } else if (todayEvents.length > 0) {
      header = showFlightsOnly ? 'Upcoming Flights' : 'Today';
    } else if (next) {
      // No events today, show when next event is
      const nextDate = new Date(next.startTime);
      if (nextDate.toDateString() === tomorrowStr) {
        header = "Tomorrow";
      } else {
        header = nextDate.toLocaleDateString('en-US', { weekday: 'long' });
      }
    }

    return {
      contextualEvents: contextEvents,
      contextHeader: header,
      nextEvent: next,
    };
  }, [events, eveningHour, showFlightsOnly]);

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  };

  const formatTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTimeRange = (start: string, end: string, allDay: boolean): string => {
    if (allDay) return 'All Day';
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  const formatTimeUntil = (dateStr: string): string => {
    const now = new Date();
    const target = new Date(dateStr);
    const diffMs = target.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) {
      return `in ${diffMins} min`;
    } else if (diffHours < 24) {
      return `in ${diffHours}h ${diffMins % 60}m`;
    } else if (diffDays === 1) {
      return 'tomorrow';
    } else {
      return `in ${diffDays} days`;
    }
  };

  // Group events by date
  const groupedEvents = contextualEvents.reduce<Record<string, ScheduleEvent[]>>((acc, event) => {
    const date = new Date(event.startTime).toDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {});

  return (
    <div className="widget schedule-widget" data-position={position}>
      <div className="widget-content">
        <h3>{contextHeader}</h3>

        <WidgetStatus
          loading={loading}
          refreshing={refreshing}
          error={error}
          isStale={isStale}
          lastUpdated={lastUpdated}
          retryCount={retryCount}
          onRetry={retry}
          loadingText="Loading schedule..."
        >
          {contextualEvents.length === 0 ? (
            <p className="no-events">No upcoming events</p>
          ) : (
            <>
              {/* Highlight next event */}
              {nextEvent && (
                <div className="next-event-highlight">
                  <div className="next-label">Up Next {formatTimeUntil(nextEvent.startTime)}</div>
                  <div className={`next-event ${nextEvent.isFlightDuty ? 'flight' : ''}`}>
                    <div className="next-event-time">{formatTime(nextEvent.startTime)}</div>
                    <div className="next-event-title">
                      {nextEvent.isFlightDuty && nextEvent.flightNumber && (
                        <span className="flight-badge">{nextEvent.flightNumber}</span>
                      )}
                      {nextEvent.title}
                    </div>
                    {nextEvent.departure && nextEvent.arrival && (
                      <div className="next-event-route">
                        {nextEvent.departure} → {nextEvent.arrival}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="schedule-list">
                {Object.entries(groupedEvents).map(([date, dayEvents]) => (
                  <div key={date} className="schedule-day">
                    <div className="day-header">{formatDate(dayEvents[0].startTime)}</div>
                    <div className="day-events">
                      {dayEvents.map((event) => (
                        <div
                          key={event.id}
                          className={`schedule-event ${event.isFlightDuty ? 'flight' : ''} ${
                            event.source === 'xlsx' ? 'xlsx' : 'google'
                          } ${event.id === nextEvent?.id ? 'is-next' : ''}`}
                        >
                          <div className="event-time">
                            {formatTimeRange(event.startTime, event.endTime, event.allDay)}
                          </div>
                          <div className="event-details">
                            <div className="event-title">
                              {event.isFlightDuty && event.flightNumber && (
                                <span className="flight-badge">{event.flightNumber}</span>
                              )}
                              {event.title}
                            </div>
                            {event.departure && event.arrival && (
                              <div className="flight-route">
                                {event.departure} → {event.arrival}
                              </div>
                            )}
                            {event.location && !event.departure && (
                              <div className="event-location">{event.location}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </WidgetStatus>
      </div>

      <style>{`
        .schedule-widget h3 {
          font-size: 1rem;
          font-weight: 400;
          color: var(--color-text-dim);
          margin-bottom: 0.75rem;
        }

        .schedule-widget .no-events {
          color: var(--color-text-dim);
          font-style: italic;
        }

        /* Up Next highlight section */
        .schedule-widget .next-event-highlight {
          background: linear-gradient(135deg, rgba(78, 204, 163, 0.15), rgba(78, 204, 163, 0.05));
          border: 1px solid rgba(78, 204, 163, 0.3);
          border-radius: 8px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .schedule-widget .next-label {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-accent, #4ecca3);
          margin-bottom: 0.5rem;
          font-weight: 500;
        }

        .schedule-widget .next-event {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .schedule-widget .next-event-time {
          font-size: 1.5rem;
          font-weight: 300;
          color: var(--color-text);
        }

        .schedule-widget .next-event-title {
          font-size: 1.1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .schedule-widget .next-event-route {
          font-size: 0.875rem;
          color: var(--color-text-dim);
        }

        .schedule-widget .next-event.flight .next-event-time {
          color: var(--color-accent, #4ecca3);
        }

        /* Dim the next event in the list since it's highlighted above */
        .schedule-widget .schedule-event.is-next {
          opacity: 0.5;
        }

        .schedule-widget .schedule-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-height: 400px;
          overflow-y: auto;
        }

        .schedule-widget .schedule-day {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .schedule-widget .day-header {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-accent);
          padding-bottom: 0.25rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .schedule-widget .day-events {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .schedule-widget .schedule-event {
          display: flex;
          gap: 0.75rem;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 4px;
          border-left: 3px solid var(--color-text-dim);
        }

        .schedule-widget .schedule-event.flight {
          border-left-color: var(--color-accent);
          background: rgba(0, 170, 255, 0.05);
        }

        .schedule-widget .schedule-event.google {
          border-left-color: #4285f4;
        }

        .schedule-widget .event-time {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          min-width: 5rem;
          white-space: nowrap;
        }

        .schedule-widget .event-details {
          flex: 1;
          min-width: 0;
        }

        .schedule-widget .event-title {
          font-size: 0.875rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .schedule-widget .flight-badge {
          font-size: 0.7rem;
          font-weight: 600;
          background: var(--color-accent);
          color: #000;
          padding: 0.125rem 0.375rem;
          border-radius: 3px;
        }

        .schedule-widget .flight-route {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          margin-top: 0.25rem;
        }

        .schedule-widget .event-location {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          margin-top: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
