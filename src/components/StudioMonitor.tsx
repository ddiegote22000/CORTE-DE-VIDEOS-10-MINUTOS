import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Scissors,
  Repeat,
  Download,
  Check,
} from 'lucide-react';
import {
  VideoFragment,
  VideoSourceMeta,
  formatTimecode,
  formatDurationHuman,
} from '../utils/videoSegmenter';

interface StudioMonitorProps {
  source: VideoSourceMeta;
  fragments: VideoFragment[];
  activeFragmentId: string;
  onSelectFragment: (id: string) => void;
  currentTime: number;
  onTimeUpdate: (sec: number) => void;
  isolateFragment: boolean;
  onToggleIsolate: () => void;
  onCutSingleFragment: (fragment: VideoFragment) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const StudioMonitor: React.FC<StudioMonitorProps> = ({
  source,
  fragments,
  activeFragmentId,
  onSelectFragment,
  currentTime,
  onTimeUpdate,
  isolateFragment,
  onToggleIsolate,
  onCutSingleFragment,
  videoRef,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const activeFragment =
    fragments.find((f) => f.id === activeFragmentId) || fragments[0];

  // Stop playback when source changes
  useEffect(() => {
    setIsPlaying(false);
  }, [source.name, source.isDemo]);

  // Handle real HTML5 video element synchronization
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || source.isDemo) return;

    const handleTime = () => {
      const now = vid.currentTime;
      if (isolateFragment && activeFragment) {
        if (now >= activeFragment.endTime) {
          vid.pause();
          vid.currentTime = activeFragment.startTime;
          setIsPlaying(false);
          onTimeUpdate(activeFragment.startTime);
          return;
        }
      } else {
        // Auto-highlight corresponding fragment as video plays across 10-min boundaries
        const match = fragments.find(
          (f) => now >= f.startTime && now < f.endTime
        );
        if (match && match.id !== activeFragmentId) {
          onSelectFragment(match.id);
        }
      }
      onTimeUpdate(now);
    };

    const handleEnded = () => setIsPlaying(false);

    vid.addEventListener('timeupdate', handleTime);
    vid.addEventListener('ended', handleEnded);
    return () => {
      vid.removeEventListener('timeupdate', handleTime);
      vid.removeEventListener('ended', handleEnded);
    };
  }, [
    source.isDemo,
    isolateFragment,
    activeFragment,
    activeFragmentId,
    fragments,
    onSelectFragment,
    onTimeUpdate,
    videoRef,
  ]);

  // Handle interactive Demo Video playback loop & 60fps canvas rendering
  useEffect(() => {
    if (!source.isDemo) return;

    const renderDemoFrame = (sec: number) => {
      const canvas = demoCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const frag =
        fragments.find((f) => sec >= f.startTime && sec <= f.endTime) ||
        activeFragment ||
        fragments[0];
      const fragIdx = frag ? frag.index : 1;

      // Studio background
      const hues = [216, 202, 190, 225];
      const baseHue = hues[(fragIdx - 1) % hues.length];
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${baseHue}, 40%, 8%)`);
      grad.addColorStop(1, `hsl(${baseHue + 12}, 42%, 14%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Broadcast safe area reticle
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(48, 36, w - 96, h - 72);

      // Crosshair center
      ctx.beginPath();
      ctx.moveTo(w / 2 - 16, h / 2);
      ctx.lineTo(w / 2 + 16, h / 2);
      ctx.moveTo(w / 2, h / 2 - 16);
      ctx.lineTo(w / 2, h / 2 + 16);
      ctx.stroke();

      // Top studio header inside video frame
      ctx.fillStyle = '#94A3B8';
      ctx.font = '500 14px "JetBrains Mono", monospace';
      ctx.fillText(
        `MASTER FEED · 1920×1080 · 29.97 FPS · BLOQUE DE 10 MINUTOS #0${fragIdx}`,
        68,
        72
      );

      // Chapter title
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(
        frag?.chapterTitle || `Segmento #0${fragIdx}`,
        68,
        124
      );

      // Large SMPTE timecode readout
      const frames = Math.floor((sec % 1) * 30)
        .toString()
        .padStart(2, '0');
      ctx.fillStyle = '#F59E0B';
      ctx.font = '600 64px "JetBrains Mono", monospace';
      ctx.fillText(`${formatTimecode(sec)}:${frames}`, 68, 225);

      // Fragment relative progress bar inside monitor
      if (frag) {
        const rel = Math.min(
          1,
          Math.max(0, (sec - frag.startTime) / Math.max(1, frag.duration))
        );
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(68, 258, w - 136, 8);
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(68, 258, (w - 136) * rel, 8);

        ctx.fillStyle = '#CBD5E1';
        ctx.font = '400 15px "JetBrains Mono", monospace';
        ctx.fillText(
          `Rango de corte activo: ${formatTimecode(frag.startTime)} → ${formatTimecode(
            frag.endTime
          )} (${formatDurationHuman(frag.duration)})`,
          68,
          292
        );
      }

      // Animated audio spectrum bars at bottom
      const numBars = 64;
      const barWidth = (w - 136) / numBars;
      for (let i = 0; i < numBars; i++) {
        const wave =
          Math.sin(sec * 7 + i * 0.45) * 0.5 +
          Math.cos(sec * 3.2 - i * 0.2) * 0.5;
        const amp = isPlaying ? Math.abs(wave) * 52 + 6 : 8 + (i % 5) * 3;
        ctx.fillStyle =
          i / numBars < (sec % 600) / 600
            ? 'rgba(245, 158, 11, 0.75)'
            : 'rgba(148, 163, 184, 0.28)';
        ctx.fillRect(
          68 + i * barWidth,
          h - 60 - amp,
          Math.max(2, barWidth - 3),
          amp
        );
      }
    };

    renderDemoFrame(currentTime);

    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      let nextTime = currentTime + dt;
      if (isolateFragment && activeFragment) {
        if (nextTime >= activeFragment.endTime) {
          nextTime = activeFragment.startTime;
          setIsPlaying(false);
          onTimeUpdate(nextTime);
          return;
        }
      } else if (nextTime >= source.duration) {
        nextTime = 0;
        setIsPlaying(false);
      } else {
        const match = fragments.find(
          (f) => nextTime >= f.startTime && nextTime < f.endTime
        );
        if (match && match.id !== activeFragmentId) {
          onSelectFragment(match.id);
        }
      }

      onTimeUpdate(nextTime);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    source.isDemo,
    source.duration,
    isPlaying,
    currentTime,
    isolateFragment,
    activeFragment,
    activeFragmentId,
    fragments,
    onSelectFragment,
    onTimeUpdate,
  ]);

  const togglePlay = () => {
    if (source.isDemo) {
      if (!isPlaying && isolateFragment && activeFragment) {
        if (
          currentTime < activeFragment.startTime ||
          currentTime >= activeFragment.endTime - 0.2
        ) {
          onTimeUpdate(activeFragment.startTime);
        }
      }
      setIsPlaying((prev) => !prev);
    } else if (videoRef.current) {
      if (videoRef.current.paused) {
        if (isolateFragment && activeFragment) {
          if (
            videoRef.current.currentTime < activeFragment.startTime ||
            videoRef.current.currentTime >= activeFragment.endTime - 0.2
          ) {
            videoRef.current.currentTime = activeFragment.startTime;
          }
        }
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const seekTo = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(source.duration, targetSec));
    onTimeUpdate(clamped);
    if (!source.isDemo && videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
    }
  };

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-xl overflow-hidden flex flex-col">
      {/* Top Studio Monitor Bar */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-slate-200 truncate">
            {source.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums whitespace-nowrap">
            {source.width}×{source.height}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums whitespace-nowrap">
            Total {formatTimecode(source.duration)}
          </span>
        </div>

        {activeFragment && (
          <div className="flex items-center gap-2 font-mono tabular-nums text-amber-400">
            <span>Fragmento #{activeFragment.index.toString().padStart(2, '0')}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              {formatTimecode(activeFragment.startTime)} – {formatTimecode(activeFragment.endTime)}
            </span>
          </div>
        )}
      </div>

      {/* Video Viewport */}
      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
        {source.isDemo ? (
          <canvas
            ref={demoCanvasRef}
            width={960}
            height={540}
            onClick={togglePlay}
            className="w-full h-full object-contain cursor-pointer"
          />
        ) : (
          <video
            ref={videoRef}
            src={source.objectUrl}
            onClick={togglePlay}
            playsInline
            className="w-full h-full object-contain cursor-pointer"
          />
        )}

        {/* Measured Gradient Scrim for Bottom Timecode Overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-end justify-between px-4 pb-3">
          <div className="text-xs text-slate-300 font-mono tabular-nums">
            <span>TC ACTUAL: </span>
            <span className="text-white font-semibold text-sm">
              {formatTimecode(currentTime)}
            </span>
            {activeFragment && (
              <span className="text-slate-400 ml-3">
                (Restante en bloque:{' '}
                {formatTimecode(Math.max(0, activeFragment.endTime - currentTime), false)})
              </span>
            )}
          </div>

          {activeFragment && (
            <div className="text-xs font-mono tabular-nums text-amber-300">
              IN {formatTimecode(activeFragment.startTime)} / OUT{' '}
              {formatTimecode(activeFragment.endTime)}
            </div>
          )}
        </div>
      </div>

      {/* Interactive Multi-Segment 10-Min Timeline Scrubber */}
      <div className="px-4 pt-4 pb-3 bg-[#0E1422] border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span>
            Mapa de Segmentación ({fragments.length}{' '}
            {fragments.length === 1 ? 'fragmento' : 'fragmentos'} calculados)
          </span>
          <span className="font-mono tabular-nums">
            Haz clic en cualquier bloque de 10 min para inspeccionar su corte
          </span>
        </div>

        {/* Visual Segmented Timeline Bar */}
        <div className="relative h-10 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex select-none">
          {fragments.map((frag) => {
            const widthPct = Math.max(
              2,
              (frag.duration / Math.max(1, source.duration)) * 100
            );
            const isSelected = frag.id === activeFragment?.id;
            return (
              <button
                key={frag.id}
                type="button"
                onClick={() => {
                  onSelectFragment(frag.id);
                  seekTo(frag.startTime);
                }}
                style={{ width: `${widthPct}%` }}
                title={`Fragmento #${frag.index}: ${formatTimecode(
                  frag.startTime
                )} a ${formatTimecode(frag.endTime)}`}
                className={`relative h-full border-r border-slate-800/90 last:border-r-0 flex flex-col justify-between px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  !frag.included
                    ? 'bg-slate-950/60 opacity-40'
                    : isSelected
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-slate-900/80 hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums truncate">
                  <span className="font-semibold">
                    #{frag.index.toString().padStart(2, '0')}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate">
                    {Math.round(frag.duration / 60)}m
                  </span>
                </div>
                <div className="text-[10px] font-mono tabular-nums text-slate-400 truncate">
                  {formatTimecode(frag.startTime, false)}
                </div>
                {isSelected && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-400" />
                )}
              </button>
            );
          })}

          {/* Playhead Position Indicator */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.9)]"
            style={{
              left: `${Math.min(
                100,
                Math.max(0, (currentTime / Math.max(1, source.duration)) * 100)
              )}%`,
            }}
          />
        </div>

        {/* Fine Range Slider inside Active Fragment or Full Video */}
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[11px] font-mono tabular-nums text-slate-400 w-16">
            {formatTimecode(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, source.duration)}
            step={0.1}
            value={currentTime}
            onChange={(e) => seekTo( parseFloat(e.target.value) )}
            aria-label="Posición de reproducción en el video"
            className="flex-1 accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <span className="text-[11px] font-mono tabular-nums text-slate-400 w-16 text-right">
            {formatTimecode(source.duration)}
          </span>
        </div>
      </div>

      {/* Studio Transport & Cut Controls */}
      <div className="px-4 py-3 bg-[#111827] border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="h-10 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pausar</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Reproducir</span>
              </>
            )}
          </button>

          {activeFragment && (
            <>
              <button
                type="button"
                onClick={() => seekTo(activeFragment.startTime)}
                title="Saltar al inicio exacto de este fragmento de 10 min"
                className="h-10 px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5" />
                <span>Inicio Bloque</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  seekTo(Math.max(activeFragment.startTime, activeFragment.endTime - 3))
                }
                title="Previsualizar los últimos 3 segundos antes del corte"
                className="h-10 px-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>Fin (-3s)</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Activar audio' : 'Silenciar audio'}
            className="h-10 w-10 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleIsolate}
            className={`h-10 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isolateFragment
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Aislar Bloque Activo</span>
          </button>

          {activeFragment && (
            <button
              type="button"
              onClick={() => onCutSingleFragment(activeFragment)}
              disabled={activeFragment.status === 'processing'}
              className="h-10 px-4 rounded-lg bg-slate-100 hover:bg-white text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {activeFragment.status === 'completed' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Recortar de Nuevo #{activeFragment.index.toString().padStart(2, '0')}</span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  <span>
                    {activeFragment.status === 'processing'
                      ? 'Cortando...'
                      : `Cortar Fragmento #${activeFragment.index.toString().padStart(2, '0')}`}
                  </span>
                </>
              )}
            </button>
          )}

          {activeFragment?.downloadUrl && (
            <a
              href={activeFragment.downloadUrl}
              download={activeFragment.outputFileName}
              className="h-10 px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
