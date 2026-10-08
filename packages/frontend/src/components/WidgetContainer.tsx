import { ReactNode } from 'react';

interface WidgetContainerProps {
  children: ReactNode;
}

export function WidgetContainer({ children }: WidgetContainerProps) {
  return <div className="widget-container">{children}</div>;
}
