import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Upload,
  Scissors,
  Sliders,
  Film,
  CheckCircle2,
  RefreshCw,
  FolderOpen,
  Sparkles,
} from 'lucide-react';
import {
  VideoFragment,
  VideoSourceMeta,
  CutConfig,
  computeVideoFragments,
  renderStudioThumbnailDataUrl,
  extractVideoThumbnails,
  formatTimecode,
  formatDurationHuman,
  formatBytes,
  buildOutputFileName,
} from './utils/videoSegmenter';
import { generateClientSideVideoClip } from './utils/clientClipGenerator';
import { StudioMonitor } from './components/StudioMonitor';
import { FragmentQueue } from './components/FragmentQueue';
import { ExportAutomationPanel } from './components/ExportAutomationPanel';

const DEMO_PRESETS: Array<{
  label: string;
  name: string;
  baseName: string;
  duration: number;
  sizeBytes: number;
}> = [
  {
    label: 'Demo 24m 30s (3 bloques)',
    name: 'conferencia_magistral_master.mp4',
    baseName: 'conferencia_magistral_master',
    duration: 1470, // 24m 30s -> 0-10m, 10-20m, 20-24m30s
    sizeBytes: 184_549_376,
  },
  {
    label: 'Demo 47m 12s (5 bloques)',
    name: 'entrevista_estudio_multicam.mp4',
    baseName: 'entrevista_estudio_multicam',
    duration: 2832, // 47m 12s -> 5 fragments of 10m
    sizeBytes: 356_515_840,
  },
  {
    label: 'Demo 1h 15m (8 bloques)',
    name: 'seminario_produccion_4k.mp4',
    baseName: 'seminario_produccion_4k',
    duration: 4520, // 75m 20s -> 8 fragments of 10m
    sizeBytes: 642_777_088,
  },
];

export default function App() {
  // Default configuration: strictly 10 minutes (600 seconds) per fragment as requested
  const [config, setConfig] = useState<CutConfig>({
    segmentDurationSec: 600, // 10 minutes
    overlapSec: 0,
    mergeShortTailSec: 0,
    mode: 'copy',
    namingPattern: 'standard',
  });

  const [customMinutesInput, setCustomMinutesInput] = useState<string>('10');
  const [customSecondsInput, setCustomSecondsInput] = useState<string>('00');

  const [source, setSource] = useState<VideoSourceMeta>(() => ({
    name: DEMO_PRESETS[0].name,
    baseName: DEMO_PRESETS[0].baseName,
    ext: 'mp4',
    duration: DEMO_PRESETS[0].duration,
    width: 1920,
    height: 1080,
    sizeBytes: DEMO_PRESETS[0].sizeBytes,
    mimeType: 'video/mp4',
    isDemo: true,
  }));

  const [fragments, setFragments] = useState<VideoFragment[]>([]);
  const [activeFragmentId, setActiveFragmentId] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isolateFragment, setIsolateFragment] = useState<boolean>(true);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Batch processing state
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 0, total: 0 });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rawFileRef = useRef<File | null>(null);
  const uploadedFileIdRef = useRef<string | null>(null);

  // Recompute fragments whenever source or cut parameters change
  useEffect(() => {
    const computed = computeVideoFragments(source, config);

    // Attach initial studio canvas thumbnails immediately so there is never an empty frame
    const withThumbnails = computed.map((frag) => ({
      ...frag,
      thumbnailDataUrl: renderStudioThumbnailDataUrl(
        frag.index,
        frag.startTime,
        frag.endTime,
        source.duration
      ),
    }));

    setFragments(withThumbnails);
    if (withThumbnails.length > 0) {
      setActiveFragmentId(withThumbnails[0].id);
    }

    // If it's a real local video file, asynchronously extract actual video frames for each 10-min block
    if (!source.isDemo && source.objectUrl) {
      let cancelled = false;
      extractVideoThumbnails(
        source.objectUrl,
        withThumbnails,
        source.duration,
        (fragId, dataUrl) => {
          if (cancelled) return;
          setFragments((prev) =>
            prev.map((f) =>
              f.id === fragId ? { ...f, thumbnailDataUrl: dataUrl } : f
            )
          );
        }
      );
      return () => {
        cancelled = true;
      };
    }
  }, [source, config]);

  // Handle loading a real local video file from user's device
  const handleFileSelected = useCallback((file: File) => {
    if (!file) return;
    setIsLoadingFile(true);
    setStatusBanner(null);

    // Cleanup previous ObjectURL if any
    setSource((prev) => {
      if (prev.objectUrl) {
        URL.revokeObjectURL(prev.objectUrl);
      }
      return prev;
    });

    rawFileRef.current = file;
    uploadedFileIdRef.current = null;

    const objectUrl = URL.createObjectURL(file);
    const probeVideo = document.createElement('video');
    probeVideo.preload = 'metadata';
    probeVideo.src = objectUrl;

    const dotIdx = file.name.lastIndexOf('.');
    const baseName = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
    const ext =
      dotIdx > 0 ? file.name.slice(dotIdx + 1).toLowerCase() : 'mp4';

    probeVideo.onloadedmetadata = () => {
      const dur =
        probeVideo.duration && isFinite(probeVideo.duration)
          ? probeVideo.duration
          : 600;
      const w = probeVideo.videoWidth || 1920;
      const h = probeVideo.videoHeight || 1080;

      setSource({
        name: file.name,
        baseName,
        ext,
        duration: dur,
        width: w,
        height: h,
        sizeBytes: file.size,
        mimeType: file.type || 'video/mp4',
        isDemo: false,
        objectUrl,
      });
      setCurrentTime(0);
      setIsLoadingFile(false);
      setStatusBanner(
        `Video cargado correctamente: "${file.name}" (${formatDurationHuman(
          dur
        )}). Segmentado automáticamente en bloques de ${Math.round(
          config.segmentDurationSec / 60
        )} minutos.`
      );
    };

    probeVideo.onerror = () => {
      setIsLoadingFile(false);
      setStatusBanner(
        'No se pudieron leer los metadatos del contenedor de video. Verifica que sea un archivo MP4, WebM o MOV válido.'
      );
    };
  }, [config.segmentDurationSec]);

  // Switch between built-in Demo Videos to test multi-block 10-minute cutting immediately
  const loadDemoPreset = (presetIndex: number) => {
    const preset = DEMO_PRESETS[presetIndex] || DEMO_PRESETS[0];
    rawFileRef.current = null;
    uploadedFileIdRef.current = null;

    setSource((prev) => {
      if (prev.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      return {
        name: preset.name,
        baseName: preset.baseName,
        ext: 'mp4',
        duration: preset.duration,
        width: 1920,
        height: 1080,
        sizeBytes: preset.sizeBytes,
        mimeType: 'video/mp4',
        isDemo: true,
      };
    });
    setCurrentTime(0);
    setConfig((prev) => ({ ...prev, segmentDurationSec: 600 }));
    setCustomMinutesInput('10');
    setCustomSecondsInput('00');
    setStatusBanner(
      `Master de prueba cargado (${formatDurationHuman(
        preset.duration
      )}). Dividido en fragmentos exactos de 10 minutos listos para previsualizar y cortar.`
    );
  };

  // Ensure the local file is uploaded once to the server before running native FFmpeg cuts
  const ensureServerSourceUploaded = async (): Promise<string | null> => {
    if (source.isDemo) return null;
    if (uploadedFileIdRef.current) return uploadedFileIdRef.current;
    const file = rawFileRef.current;
    if (!file) return null;

    // Upload if <= 450 MB
    if (file.size > 450 * 1024 * 1024) {
      return null;
    }

    try {
      const res = await fetch(
        `/api/upload-source?ext=${encodeURIComponent(source.ext)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body: file,
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.fileId) {
        uploadedFileIdRef.current = data.fileId;
        return data.fileId;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Cut a single 10-minute fragment (Server FFmpeg Lossless + Client-Side Fallback)
  const cutSingleFragment = async (frag: VideoFragment): Promise<void> => {
    setFragments((prev) =>
      prev.map((f) =>
        f.id === frag.id ? { ...f, status: 'processing', errorMessage: undefined } : f
      )
    );

    try {
      if (source.isDemo) {
        const res = await fetch('/api/demo-segment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fragmentIndex: frag.index,
            startTime: frag.startTime,
            endTime: frag.endTime,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setFragments((prev) =>
            prev.map((f) =>
              f.id === frag.id
                ? {
                    ...f,
                    status: 'completed',
                    downloadUrl: data.downloadUrl,
                    actualSizeBytes: data.size,
                  }
                : f
            )
          );
          return;
        }
      } else {
        const serverFileId = await ensureServerSourceUploaded();
        if (serverFileId) {
          const res = await fetch('/api/cut-segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId: serverFileId,
              ext: source.ext,
              startTime: frag.startTime,
              endTime: frag.endTime,
              fragmentIndex: frag.index,
              mode: config.mode,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            setFragments((prev) =>
              prev.map((f) =>
                f.id === frag.id
                  ? {
                      ...f,
                      status: 'completed',
                      downloadUrl: data.downloadUrl,
                      actualSizeBytes: data.size,
                    }
                  : f
              )
            );
            return;
          }
        }
      }

      // Client-side WebMedia fallback if server upload is skipped or offline
      const clip = await generateClientSideVideoClip(
        source,
        frag,
        videoRef.current
      );
      setFragments((prev) =>
        prev.map((f) =>
          f.id === frag.id
            ? {
                ...f,
                status: 'completed',
                downloadUrl: clip.blobUrl,
                actualSizeBytes: clip.sizeBytes,
              }
            : f
        )
      );
    } catch (err: any) {
      setFragments((prev) =>
        prev.map((f) =>
          f.id === frag.id
            ? {
                ...f,
                status: 'error',
                errorMessage: err?.message || 'Error al cortar el fragmento',
              }
            : f
        )
      );
    }
  };

  // Batch cut all included 10-minute fragments sequentially
  const handleCutBatch = async () => {
    const toProcess = fragments.filter((f) => f.included);
    if (toProcess.length === 0 || isBatchProcessing) return;

    setIsBatchProcessing(true);
    setBatchProgress({ current: 0, total: toProcess.length });

    for (let i = 0; i < toProcess.length; i++) {
      setBatchProgress({ current: i + 1, total: toProcess.length });
      await cutSingleFragment(toProcess[i]);
    }

    setIsBatchProcessing(false);
    setStatusBanner(
      `Corte por lotes finalizado: ${toProcess.length} ${
        toProcess.length === 1 ? 'fragmento procesado' : 'fragmentos procesados'
      } y listos para descargar.`
    );
  };

  // Trigger download for all completed fragments
  const handleDownloadAllReady = () => {
    const ready = fragments.filter(
      (f) => f.status === 'completed' && f.downloadUrl
    );
    ready.forEach((frag, idx) => {
      setTimeout(() => {
        if (!frag.downloadUrl) return;
        const a = document.createElement('a');
        a.href = frag.downloadUrl;
        a.download = frag.outputFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, idx * 350);
    });
  };

  // Select fragment and optionally jump video playhead to its start
  const handleSelectFragment = (id: string, seekMonitor = false) => {
    setActiveFragmentId(id);
    if (seekMonitor) {
      const target = fragments.find((f) => f.id === id);
      if (target) {
        setCurrentTime(target.startTime);
        if (!source.isDemo && videoRef.current) {
          videoRef.current.currentTime = target.startTime;
        }
      }
    }
  };

  // Fine-tune start/end boundary of an individual fragment
  const handleAdjustBoundary = (
    id: string,
    field: 'startTime' | 'endTime',
    deltaSec: number
  ) => {
    setFragments((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        let newStart = f.startTime;
        let newEnd = f.endTime;
        if (field === 'startTime') {
          newStart = Math.max(0, Math.min(newEnd - 1, f.startTime + deltaSec));
        } else {
          newEnd = Math.min(
            source.duration,
            Math.max(newStart + 1, f.endTime + deltaSec)
          );
        }
        const newDur = Number((newEnd - newStart).toFixed(2));
        return {
          ...f,
          startTime: Number(newStart.toFixed(2)),
          endTime: Number(newEnd.toFixed(2)),
          duration: newDur,
          outputFileName: buildOutputFileName(
            source.baseName,
            source.ext,
            f.index,
            newStart,
            newEnd,
            config.namingPattern
          ),
          status: 'pending',
          downloadUrl: undefined,
        };
      })
    );
  };

  const applyIntervalSec = (seconds: number) => {
    const clamped = Math.max(5, Math.min(7200, Math.round(seconds)));
    const mins = Math.floor(clamped / 60);
    const secs = clamped % 60;
    setCustomMinutesInput(String(mins));
    setCustomSecondsInput(secs.toString().padStart(2, '0'));
    setConfig((prev) => ({ ...prev, segmentDurationSec: clamped }));
  };

  const handleApplyCustomTime = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Math.max(0, parseInt(customMinutesInput || '0', 10) || 0);
    const secs = Math.max(0, parseInt(customSecondsInput || '0', 10) || 0);
    const total = Math.max(5, mins * 60 + secs);
    applyIntervalSec(total);
  };

  const targetMinutesDisplay = (config.segmentDurationSec / 60).toFixed(
    config.segmentDurationSec % 60 === 0 ? 0 : 1
  );

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-16 bg-[#0B0F17]/95 backdrop-blur border-b border-slate-800/90 px-6 flex items-center justify-between">
        {/* Zone 1: Single text element Brand Wordmark */}
        <a
          href="#top"
          className="text-xl font-bold tracking-tight text-white font-display whitespace-nowrap"
        >
          CorteDiez
        </a>

        {/* Zone 2: 4 Clean Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <a
            href="#parametros-corte"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
          >
            Parámetros de 10 Min
          </a>
          <a
            href="#monitor-estudio"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
          >
            Monitor y Línea de Tiempo
          </a>
          <a
            href="#cola-fragmentos"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
          >
            Cola de Fragmentos
          </a>
          <a
            href="#exportacion-avanzada"
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
          >
            Automatización FFmpeg
          </a>
        </nav>

        {/* Zone 3: 2 Primary Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadDemoPreset(0)}
            className="h-10 px-3.5 text-xs font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cargar Demo 24:30
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-4 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Subir Video</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mp4,.mov,.webm,.mkv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
            }}
            className="hidden"
          />
        </div>
      </header>

      {/* Main Studio Container (1440px Desktop Baseline) */}
      <main
        id="top"
        className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-8 space-y-8"
      >
        {/* Studio Header & Summary Metrics */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-slate-800/80">
          <div className="max-w-2xl">
            <p className="text-xs font-mono tabular-nums text-amber-400 mb-2">
              ESTUDIO DE SEGMENTACIÓN AUTOMÁTICA · INTERVALO ESTÁNDAR 00:10:00
            </p>
            <h1
              className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-display"
              style={{ textWrap: 'balance' }}
            >
              Divisor de Videos en Fragmentos Exactos de 10 Minutos
            </h1>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Carga cualquier grabación larga y divídela automáticamente en bloques de 10 minutos (600 segundos) sin pérdida de calidad, con inspección de código de tiempo y descarga directa por lote.
            </p>
          </div>

          {/* Unboxed Tabular Summary Strip */}
          <div className="grid grid-cols-3 gap-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-slate-800/80 font-mono tabular-nums">
            <div>
              <div className="text-xs text-slate-400">Duración del Origen</div>
              <div className="text-lg font-semibold text-white mt-0.5">
                {formatTimecode(source.duration)}
              </div>
              <div className="text-[11px] text-slate-500">
                {formatBytes(source.sizeBytes)} · {source.ext.toUpperCase()}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Intervalo de Corte</div>
              <div className="text-lg font-semibold text-amber-400 mt-0.5">
                {targetMinutesDisplay} min
              </div>
              <div className="text-[11px] text-slate-500">
                {config.segmentDurationSec} seg · Solapamiento {config.overlapSec}s
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Fragmentos Resultantes</div>
              <div className="text-lg font-semibold text-emerald-400 mt-0.5">
                {fragments.length} {fragments.length === 1 ? 'bloque' : 'bloques'}
              </div>
              <div className="text-[11px] text-slate-500">
                {fragments.filter((f) => f.isFullBlock).length} completos +{' '}
                {fragments.filter((f) => !f.isFullBlock).length} cola
              </div>
            </div>
          </div>
        </div>

        {/* Status Feedback Banner */}
        {statusBanner && (
          <div className="px-4 py-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{statusBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-slate-400 hover:text-white text-xs font-medium cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Short Video Contextual Helper (When uploaded video is < 10 minutes) */}
        {source.duration < config.segmentDurationSec && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-amber-200/90 leading-relaxed">
              <span className="font-semibold text-amber-300">
                Nota sobre la duración ({formatDurationHuman(source.duration)}):
              </span>{' '}
              El video actual dura menos que el intervalo de{' '}
              {Math.round(config.segmentDurationSec / 60)} minutos, por lo que genera 1 único fragmento. Si deseas probar la división múltiple en este video corto, elige un intervalo menor o carga uno de los videos largos de prueba:
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  applyIntervalSec(Math.max(10, Math.floor(source.duration / 3)))
                }
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs whitespace-nowrap cursor-pointer"
              >
                Dividir en 3 partes ({Math.max(10, Math.floor(source.duration / 3))}s)
              </button>
              <button
                type="button"
                onClick={() => loadDemoPreset(0)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs whitespace-nowrap cursor-pointer"
              >
                Usar Demo de 24:30 min
              </button>
            </div>
          </div>
        )}

        {/* Section 01 & 02: Two-Column Studio Workspace (Source + Parameters on Left, Monitor on Right) */}
        <div
          id="parametros-corte"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* Left Column (5 cols): File Dropzone & 10-Minute Cut Configuration */}
          <div className="lg:col-span-5 space-y-6">
            {/* File Dropzone & Source Switcher */}
            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-slate-100">
                  01. Video de Origen
                </h2>
                <span className="text-xs text-slate-400 font-mono tabular-nums">
                  MP4 · MOV · WEBM · MKV
                </span>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileSelected(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-5 rounded-lg border border-dashed transition-colors cursor-pointer text-center ${
                  isDraggingOver
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-slate-700/90 bg-[#0B0F17]/70 hover:border-slate-500'
                }`}
              >
                <FolderOpen className="w-7 h-7 text-amber-400 mx-auto mb-2" />
                <div className="text-xs font-semibold text-slate-200">
                  {isLoadingFile
                    ? 'Analizando pista de video...'
                    : 'Haz clic para seleccionar tu video o arrástralo aquí'}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Procesamiento local inmediato en navegador + corte FFmpeg sin pérdida
                </p>
              </div>

              {/* Quick Demo Presets for Testing */}
              <div className="mt-4 pt-3 border-t border-slate-800/80">
                <div className="text-[11px] text-slate-400 mb-2">
                  ¿Quieres probar cómo corta videos largos ahora mismo? Carga un master de prueba:
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {DEMO_PRESETS.map((preset, idx) => {
                    const isActive =
                      source.isDemo && source.name === preset.name;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => loadDemoPreset(idx)}
                        className={`px-2.5 py-2 rounded-lg text-[11px] font-medium text-center transition-colors truncate cursor-pointer ${
                          isActive
                            ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300'
                            : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 10-Minute Cut Parameters Panel */}
            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  <span>Parámetros de Fragmentación</span>
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    applyIntervalSec(600);
                    setConfig({
                      segmentDurationSec: 600,
                      overlapSec: 0,
                      mergeShortTailSec: 0,
                      mode: 'copy',
                      namingPattern: 'standard',
                    });
                  }}
                  className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Restaurar 10 min</span>
                </button>
              </div>

              {/* Duration Selector (10 min standard + presets) */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">
                  Duración exacta por fragmento
                </label>
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                  {[
                    { label: '10 min (Estándar)', sec: 600 },
                    { label: '5 min', sec: 300 },
                    { label: '15 min', sec: 900 },
                    { label: '20 min', sec: 1200 },
                  ].map((item) => {
                    const active = config.segmentDurationSec === item.sec;
                    return (
                      <button
                        key={item.sec}
                        type="button"
                        onClick={() => applyIntervalSec(item.sec)}
                        className={`py-2 px-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap truncate cursor-pointer ${
                          active
                            ? 'bg-amber-500 text-slate-950 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Min:Sec Fine Input */}
                <form
                  onSubmit={handleApplyCustomTime}
                  className="mt-2.5 flex items-center gap-2"
                >
                  <span className="text-xs text-slate-400">
                    Duración personalizada (MM:SS):
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={customMinutesInput}
                    onChange={(e) => setCustomMinutesInput(e.target.value)}
                    aria-label="Minutos por fragmento"
                    className="w-16 h-8 px-2 bg-slate-950 border border-slate-800 rounded text-xs font-mono tabular-nums text-center text-white"
                  />
                  <span className="text-slate-500 font-mono">:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={customSecondsInput}
                    onChange={(e) => setCustomSecondsInput(e.target.value)}
                    aria-label="Segundos por fragmento"
                    className="w-14 h-8 px-2 bg-slate-950 border border-slate-800 rounded text-xs font-mono tabular-nums text-center text-white"
                  />
                  <button
                    type="submit"
                    className="h-8 px-3 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
                  >
                    Aplicar
                  </button>
                </form>
              </div>

              {/* Safety Overlap Between 10-Min Fragments */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-300">
                    Solapamiento entre fragmentos (Overlap)
                  </span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {config.overlapSec === 0
                      ? 'Corte exacto (0s)'
                      : `+${config.overlapSec}s repetidos al inicio`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">
                  Evita que una frase quede cortada a la mitad en el minuto 10:00 repitiendo unos segundos.
                </p>
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                  {[0, 2, 5, 10].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({ ...prev, overlapSec: sec }))
                      }
                      className={`py-1.5 rounded text-xs font-mono tabular-nums font-medium transition-colors cursor-pointer ${
                        config.overlapSec === sec
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sec === 0 ? '0s (Seco)' : `+${sec} seg`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tail Fragment Handling & Processing Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Motor de Corte
                  </label>
                  <select
                    value={config.mode}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        mode: e.target.value as 'copy' | 'reencode',
                      }))
                    }
                    className="w-full h-9 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="copy">
                      Copia Directa sin Pérdida (-c copy)
                    </option>
                    <option value="reencode">
                      Recodificación Precisa (H.264 MP4)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Cola Final Corta
                  </label>
                  <select
                    value={config.mergeShortTailSec}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        mergeShortTailSec: Number(e.target.value),
                      }))
                    }
                    className="w-full h-9 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value={0}>Crear fragmento separado siempre</option>
                    <option value={60}>Unir al anterior si dura &lt; 1 min</option>
                    <option value={120}>Unir al anterior si dura &lt; 2 min</option>
                  </select>
                </div>
              </div>

              {/* Primary CTA inside Left Panel */}
              <button
                type="button"
                onClick={handleCutBatch}
                disabled={isBatchProcessing || fragments.length === 0}
                className="w-full h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Scissors className="w-4 h-4" />
                <span>
                  {isBatchProcessing
                    ? `Procesando fragmento ${batchProgress.current} de ${batchProgress.total}...`
                    : `Cortar Video en ${
                        fragments.filter((f) => f.included).length
                      } Fragmentos de ${targetMinutesDisplay} Minutos`}
                </span>
              </button>
            </div>
          </div>

          {/* Right Column (7 cols): Interactive Studio Monitor & 10-Min Block Scrubber */}
          <div id="monitor-estudio" className="lg:col-span-7">
            <StudioMonitor
              source={source}
              fragments={fragments}
              activeFragmentId={activeFragmentId}
              onSelectFragment={(id) => handleSelectFragment(id, false)}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              isolateFragment={isolateFragment}
              onToggleIsolate={() => setIsolateFragment((prev) => !prev)}
              onCutSingleFragment={cutSingleFragment}
              videoRef={videoRef}
            />
          </div>
        </div>

        {/* Section 03: Full-Width 10-Minute Fragment Queue Table */}
        <FragmentQueue
          fragments={fragments}
          activeFragmentId={activeFragmentId}
          targetDurationSec={config.segmentDurationSec}
          isBatchProcessing={isBatchProcessing}
          batchProgress={batchProgress}
          onSelectFragment={handleSelectFragment}
          onToggleInclude={(id) =>
            setFragments((prev) =>
              prev.map((f) =>
                f.id === id ? { ...f, included: !f.included } : f
              )
            )
          }
          onToggleAllInclude={(inc) =>
            setFragments((prev) => prev.map((f) => ({ ...f, included: inc })))
          }
          onAdjustBoundary={handleAdjustBoundary}
          onCutSingle={cutSingleFragment}
          onCutBatch={handleCutBatch}
          onDownloadAllReady={handleDownloadAllReady}
        />

        {/* Section 04: FFmpeg Script & CSV EDL Export Panel */}
        <ExportAutomationPanel
          source={source}
          fragments={fragments}
          config={config}
        />
      </main>

      {/* Clean Quiet Footer */}
      <footer className="mt-12 border-t border-slate-800/80 py-6 px-6 text-xs text-slate-500">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            CorteDiez Studio — Segmentación de video en fragmentos de 10 minutos
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#parametros-corte"
              className="hover:text-slate-300 transition-colors"
            >
              Parámetros
            </a>
            <a
              href="#monitor-estudio"
              className="hover:text-slate-300 transition-colors"
            >
              Monitor
            </a>
            <a
              href="#cola-fragmentos"
              className="hover:text-slate-300 transition-colors"
            >
              Cola de Lotes
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
