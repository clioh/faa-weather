import { useState, useEffect } from 'react';

interface ClockWidgetProps {
  position: string;
  showZulu?: boolean;
  timezone?: string;
}

export function ClockWidget({ position, showZulu = true, timezone }: ClockWidgetProps) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatLocalTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: timezone,
    });
  };

  const formatZulu = (date: Date): string => {
    return (
      date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      }) + 'Z'
    );
  };

  return (
    <div className="widget clock-widget" data-position={position}>
      <div className="widget-content">
        <div className="time">{formatLocalTime(time)}</div>
        <div className="date">{formatDate(time)}</div>
        {showZulu && <div className="zulu">{formatZulu(time)}</div>}
      </div>
    </div>
  );
}
