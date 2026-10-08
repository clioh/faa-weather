/**
 * Module Renderer
 *
 * Renders modules on a 12-column grid based on layout configuration.
 * Each module is positioned using CSS grid based on its x/y position and size.
 */

import { useMemo } from 'react';
import {
  MirrorLayout,
  ModuleInstance,
  ModuleProps,
  SIZE_DIMENSIONS,
  getModuleComponent,
} from './index';

interface ModuleRendererProps {
  layout: MirrorLayout;
  // Global config passed to all modules
  airport?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

interface SingleModuleProps {
  instance: ModuleInstance;
  airport?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

function SingleModule({ instance, airport, timezone, latitude, longitude }: SingleModuleProps) {
  const Component = getModuleComponent(instance.moduleId);

  if (!Component) {
    console.warn(`Unknown module type: ${instance.moduleId}`);
    return null;
  }

  const { cols, rows } = SIZE_DIMENSIONS[instance.size] || SIZE_DIMENSIONS.medium;

  // Calculate grid position (1-indexed for CSS grid)
  const gridColumn = `${instance.position.x + 1} / span ${cols}`;
  const gridRow = `${instance.position.y + 1} / span ${rows}`;

  const moduleProps: ModuleProps = {
    instanceId: instance.instanceId,
    moduleId: instance.moduleId,
    size: instance.size,
    config: instance.config,
    airport,
    timezone,
    latitude,
    longitude,
  };

  return (
    <div
      className="module"
      style={{
        gridColumn,
        gridRow,
      }}
      data-module-id={instance.moduleId}
      data-instance-id={instance.instanceId}
    >
      <Component {...moduleProps} />
    </div>
  );
}

export function ModuleRenderer({ layout, airport, timezone, latitude, longitude }: ModuleRendererProps) {
  const modules = useMemo(() => {
    if (!layout?.modules?.length) {
      return null;
    }

    return layout.modules.map((instance) => (
      <SingleModule
        key={instance.instanceId}
        instance={instance}
        airport={airport}
        timezone={timezone}
        latitude={latitude}
        longitude={longitude}
      />
    ));
  }, [layout, airport, timezone, latitude, longitude]);

  if (!modules) {
    return (
      <div className="module-grid empty">
        <div className="empty-state">
          <p>No modules configured</p>
          <p className="hint">Use the mobile app to add modules</p>
        </div>
      </div>
    );
  }

  return (
    <div className="module-grid">
      {modules}
    </div>
  );
}

// Re-export types for convenience
export type { MirrorLayout, ModuleInstance };
