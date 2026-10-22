/**
 * Module Renderer
 *
 * Lays widgets out on the 12 x 8 grid from a layout. Each tile is a CSS
 * container (see styles/modules.css) so widgets scale with their tile.
 */

import { useMemo } from 'react';
import {
  MirrorLayout,
  ModuleInstance,
  ModuleProps,
  SIZE_DIMENSIONS,
  getModuleComponent,
} from './index';
import { ModuleFrame, ModuleEmpty } from './ModuleFrame';

interface ModuleRendererProps {
  layout: MirrorLayout;
  /** The phone is showing an unsaved layout; outline tiles so placement is visible. */
  preview?: boolean;
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
  const { cols, rows } = SIZE_DIMENSIONS[instance.size] || SIZE_DIMENSIONS.medium;

  const style = {
    gridColumn: `${instance.position.x + 1} / span ${cols}`,
    gridRow: `${instance.position.y + 1} / span ${rows}`,
  };

  if (!Component) {
    return (
      <div
        className="module"
        style={style}
        data-module-id={instance.moduleId}
        data-instance-id={instance.instanceId}
        data-size={instance.size}
        data-unknown="true"
      >
        <ModuleFrame title="Unavailable">
          <ModuleEmpty
            title={instance.moduleId}
            hint="This widget is no longer available. Remove it in the app."
          />
        </ModuleFrame>
      </div>
    );
  }

  const moduleProps: ModuleProps = {
    instanceId: instance.instanceId,
    moduleId: instance.moduleId,
    size: instance.size,
    config: instance.config ?? {},
    airport,
    timezone,
    latitude,
    longitude,
  };

  return (
    <div
      className="module"
      style={style}
      data-module-id={instance.moduleId}
      data-instance-id={instance.instanceId}
      data-size={instance.size}
    >
      <Component {...moduleProps} />
    </div>
  );
}

export function ModuleRenderer({
  layout,
  preview,
  airport,
  timezone,
  latitude,
  longitude,
}: ModuleRendererProps) {
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
          <p>Nothing on the mirror yet</p>
          <p className="hint">Add widgets from the SkyGlass app</p>
        </div>
      </div>
    );
  }

  return (
    <div className="module-grid" data-preview={preview ? 'true' : undefined}>
      {modules}
    </div>
  );
}

export type { MirrorLayout, ModuleInstance };
