import { useState, useEffect, useRef, useCallback } from 'react';
import { useFetch } from '../../hooks/useFetch';

interface RadarWidgetProps {
  position?: string;
  latitude?: number;
  longitude?: number;
  zoom?: number;
  animationSpeed?: number; // ms between frames
  showTimestamp?: boolean;
}

interface RainViewerData {
  version: string;
  generated: number;
  host: string;
  radar: {
    past: Array<{ time: number; path: string }>;
    nowcast: Array<{ time: number; path: string }>;
  };
}

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const TILE_SIZE = 256;
const DEFAULT_ZOOM = 6;
const DEFAULT_ANIMATION_SPEED = 500;

// Convert lat/lon to tile coordinates
function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

// Format timestamp for display
function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function RadarWidget({
  position = 'center-left',
  latitude,
  longitude,
  zoom = DEFAULT_ZOOM,
  animationSpeed = DEFAULT_ANIMATION_SPEED,
  showTimestamp = true,
}: RadarWidgetProps) {
  const [frames, setFrames] = useState<Array<{ time: number; url: string }>>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [location, setLocation] = useState({ lat: latitude || 40.6413, lon: longitude || -73.7781 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const animationRef = useRef<number | null>(null);

  // Fetch config to get location if not provided
  const { data: config } = useFetch<{ location: { latitude: number; longitude: number } }>(
    '/api/config',
    { refreshInterval: 0 }
  );

  useEffect(() => {
    if (config?.location && !latitude && !longitude) {
      setLocation({ lat: config.location.latitude, lon: config.location.longitude });
    }
  }, [config, latitude, longitude]);

  // Fetch radar data from RainViewer
  const { data: radarData, loading } = useFetch<RainViewerData>(RAINVIEWER_API, {
    refreshInterval: 300000, // Refresh every 5 minutes
  });

  // Process radar data into frame URLs
  useEffect(() => {
    if (!radarData?.radar?.past) return;

    const { x, y } = latLonToTile(location.lat, location.lon, zoom);
    const host = radarData.host;

    // Combine past and nowcast frames
    const allFrames = [
      ...radarData.radar.past,
      ...(radarData.radar.nowcast || []),
    ];

    const frameUrls = allFrames.map((frame) => ({
      time: frame.time,
      url: `${host}${frame.path}/${TILE_SIZE}/${zoom}/${x}/${y}/2/1_1.png`,
    }));

    setFrames(frameUrls);

    // Preload images
    frameUrls.forEach((frame) => {
      if (!imageCache.current.has(frame.url)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = frame.url;
        imageCache.current.set(frame.url, img);
      }
    });
  }, [radarData, location, zoom]);

  // Draw current frame to canvas
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frame = frames[currentFrame];
    const img = imageCache.current.get(frame.url);

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (img?.complete) {
      // Draw radar tile centered
      const scale = Math.min(canvas.width, canvas.height) / TILE_SIZE;
      const drawSize = TILE_SIZE * scale;
      const offsetX = (canvas.width - drawSize) / 2;
      const offsetY = (canvas.height - drawSize) / 2;

      ctx.drawImage(img, offsetX, offsetY, drawSize, drawSize);

      // Draw crosshair at center (your location)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 10, canvas.height / 2);
      ctx.lineTo(canvas.width / 2 + 10, canvas.height / 2);
      ctx.moveTo(canvas.width / 2, canvas.height / 2 - 10);
      ctx.lineTo(canvas.width / 2, canvas.height / 2 + 10);
      ctx.stroke();
    }
  }, [frames, currentFrame]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || frames.length === 0) return;

    const animate = () => {
      setCurrentFrame((prev) => (prev + 1) % frames.length);
    };

    animationRef.current = window.setInterval(animate, animationSpeed);

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [isPlaying, frames.length, animationSpeed]);

  // Redraw when frame changes
  useEffect(() => {
    drawFrame();
  }, [drawFrame, currentFrame]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        drawFrame();
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [drawFrame]);

  const currentTime = frames[currentFrame]?.time;
  const isNowcast = radarData?.radar?.past &&
    currentFrame >= radarData.radar.past.length;

  return (
    <div className="widget" data-position={position}>
      <div className="widget-content">
        <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🌧️</span>
          Radar
          {isNowcast && (
            <span style={{
              fontSize: '0.7rem',
              background: 'var(--color-accent)',
              color: '#000',
              padding: '2px 6px',
              borderRadius: '4px',
              marginLeft: '0.5rem'
            }}>
              FORECAST
            </span>
          )}
        </h3>

        <div style={{
          position: 'relative',
          width: '100%',
          height: '200px',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#1a1a2e'
        }}>
          {loading ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--color-text-dim)'
            }}>
              Loading radar...
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '100%' }}
              onClick={() => setIsPlaying(!isPlaying)}
            />
          )}

          {/* Timeline bar */}
          {frames.length > 0 && (
            <div style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              right: '8px',
              height: '4px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '2px',
            }}>
              <div style={{
                width: `${((currentFrame + 1) / frames.length) * 100}%`,
                height: '100%',
                background: isNowcast ? 'var(--color-accent)' : 'var(--color-vfr)',
                borderRadius: '2px',
                transition: 'width 0.1s',
              }} />
            </div>
          )}

          {/* Play/Pause indicator */}
          {!isPlaying && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: '2rem',
              opacity: 0.7,
            }}>
              ▶️
            </div>
          )}
        </div>

        {/* Timestamp */}
        {showTimestamp && currentTime && (
          <div style={{
            marginTop: '0.5rem',
            fontSize: '0.9rem',
            color: 'var(--color-text-dim)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>{formatTime(currentTime)}</span>
            <span style={{ fontSize: '0.75rem' }}>
              {isPlaying ? '⏵ Playing' : '⏸ Paused'} • Tap to toggle
            </span>
          </div>
        )}

        {/* Legend */}
        <div style={{
          marginTop: '0.5rem',
          display: 'flex',
          justifyContent: 'center',
          gap: '0.5rem',
          fontSize: '0.7rem',
          color: 'var(--color-text-dim)'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', background: '#00ff00', borderRadius: '2px' }} />
            Light
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', background: '#ffff00', borderRadius: '2px' }} />
            Moderate
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', background: '#ff0000', borderRadius: '2px' }} />
            Heavy
          </span>
        </div>
      </div>
    </div>
  );
}
