export interface VideoFragment {
  id: string;
  index: number;
  startTime: number; // seconds
  endTime: number; // seconds
  duration: number; // seconds
  isFullBlock: boolean; // true if matches target segment duration
  included: boolean;
  outputFileName: string;
  estimatedSizeBytes: number;
  actualSizeBytes?: number;
  thumbnailDataUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  downloadUrl?: string;
  errorMessage?: string;
  chapterTitle?: string;
}

export interface VideoSourceMeta {
  name: string;
  baseName: string;
  ext: string;
  duration: number; // seconds
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
  isDemo: boolean;
  objectUrl?: string;
  serverFileId?: string;
}

export interface CutConfig {
  segmentDurationSec: number; // default 600 (10 minutes)
  overlapSec: number; // default 0
  mergeShortTailSec: number; // 0 = disabled, e.g. 60 = merge tail if < 60s
  mode: 'copy' | 'reencode';
  namingPattern: 'standard' | 'timecode' | 'compact';
}

export function formatTimecode(seconds: number, includeHours = true): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (includeHours || hrs > 0) {
    return [
      hrs.toString().padStart(2, '0'),
      mins.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0'),
    ].join(':');
  }

  return [
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0'),
  ].join(':');
}

export function formatDurationHuman(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }
  return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
}

export function formatCompactRange(startSec: number, endSec: number): string {
  const sMin = Math.floor(startSec / 60);
  const sSec = Math.floor(startSec % 60);
  const eMin = Math.floor(endSec / 60);
  const eSec = Math.floor(endSec % 60);
  return `${sMin.toString().padStart(2, '0')}m${sSec.toString().padStart(2, '0')}s-${eMin.toString().padStart(2, '0')}m${eSec.toString().padStart(2, '0')}s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function buildOutputFileName(
  baseName: string,
  ext: string,
  index: number,
  startSec: number,
  endSec: number,
  pattern: CutConfig['namingPattern']
): string {
  const cleanBase = baseName
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '') || 'video';
  const num = index.toString().padStart(2, '0');
  const outExt = ext || 'mp4';

  if (pattern === 'compact') {
    return `${cleanBase}_parte_${num}.${outExt}`;
  }
  if (pattern === 'timecode') {
    return `${cleanBase}_seg_${num}_${formatCompactRange(startSec, endSec)}.${outExt}`;
  }
  // 'standard'
  const startMin = Math.floor(startSec / 60).toString().padStart(2, '0');
  const endMin = Math.ceil(endSec / 60).toString().padStart(2, '0');
  return `${cleanBase}_10min_parte_${num}_${startMin}m-${endMin}m.${outExt}`;
}

const DEMO_CHAPTERS = [
  'Apertura y Calibración de Señal',
  'Desarrollo Principal y Análisis de Caso',
  'Conclusiones y Resumen Ejecutivo',
  'Anexo Técnico de Cierre',
];

export function computeVideoFragments(
  source: VideoSourceMeta,
  config: CutConfig
): VideoFragment[] {
  const totalDuration = Math.max(1, source.duration);
  const step = Math.max(5, config.segmentDurationSec);
  const overlap = Math.max(0, Math.min(step - 1, config.overlapSec));
  const bytesPerSec = source.sizeBytes / totalDuration;

  const rawRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < totalDuration - 0.05) {
    const start = cursor;
    const end = Math.min(totalDuration, start + step);
    rawRanges.push({ start, end });
    if (end >= totalDuration - 0.05) {
      break;
    }
    cursor = end - overlap;
  }

  // Handle optional merging of a short final tail into the previous segment
  if (
    config.mergeShortTailSec > 0 &&
    rawRanges.length > 1
  ) {
    const last = rawRanges[rawRanges.length - 1];
    const lastDur = last.end - last.start;
    if (lastDur < config.mergeShortTailSec) {
      rawRanges[rawRanges.length - 2].end = last.end;
      rawRanges.pop();
    }
  }

  return rawRanges.map((range, i) => {
    const idx = i + 1;
    const duration = Math.max(0.1, range.end - range.start);
    const isFullBlock = Math.abs(duration - step) < 1.0;
    const estimatedSizeBytes = Math.round(duration * bytesPerSec);

    return {
      id: `frag-${idx}-${Math.round(range.start)}-${Math.round(range.end)}`,
      index: idx,
      startTime: Number(range.start.toFixed(2)),
      endTime: Number(range.end.toFixed(2)),
      duration: Number(duration.toFixed(2)),
      isFullBlock,
      included: true,
      outputFileName: buildOutputFileName(
        source.baseName,
        source.ext,
        idx,
        range.start,
        range.end,
        config.namingPattern
      ),
      estimatedSizeBytes,
      status: 'pending',
      chapterTitle: source.isDemo
        ? DEMO_CHAPTERS[i % DEMO_CHAPTERS.length]
        : `Bloque de Tiempo #${idx.toString().padStart(2, '0')}`,
    };
  });
}

/**
 * Generates a realistic high-contrast studio thumbnail on a canvas for either
 * the built-in Demo Video or as a fallback when a video frame is being decoded.
 */
export function renderStudioThumbnailDataUrl(
  fragmentIndex: number,
  startTimeSec: number,
  endTimeSec: number,
  totalDurationSec: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Studio dark slate gradient background with subtle hue shift per fragment
  const hues = [215, 200, 185, 228, 195, 210];
  const hue = hues[(fragmentIndex - 1) % hues.length];
  const grad = ctx.createLinearGradient(0, 0, 320, 180);
  grad.addColorStop(0, `hsl(${hue}, 38%, 11%)`);
  grad.addColorStop(1, `hsl(${hue + 15}, 45%, 18%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 180);

  // Subtle technical grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 32; x < 320; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 180);
    ctx.stroke();
  }
  for (let y = 30; y < 180; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(320, y);
    ctx.stroke();
  }

  // Audio waveform visualization bar in lower third
  ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
  for (let i = 0; i < 48; i++) {
    const seed = Math.sin(fragmentIndex * 13.7 + i * 0.65) * 0.5 + 0.5;
    const barH = 6 + seed * 28;
    ctx.fillRect(16 + i * 6, 132 - barH / 2, 3.5, barH);
  }

  // Timeline progress indicator at bottom
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, 174, 320, 6);
  const startRatio = Math.min(1, Math.max(0, startTimeSec / Math.max(1, totalDurationSec)));
  const endRatio = Math.min(1, Math.max(startRatio + 0.03, endTimeSec / Math.max(1, totalDurationSec)));
  ctx.fillStyle = '#F59E0B';
  ctx.fillRect(startRatio * 320, 174, (endRatio - startRatio) * 320, 6);

  // Fragment identifier and timecode burn-in
  ctx.fillStyle = 'rgba(11, 15, 23, 0.78)';
  ctx.fillRect(12, 12, 110, 26);
  ctx.fillStyle = '#F59E0B';
  ctx.font = '600 12px "JetBrains Mono", monospace';
  ctx.fillText(`CORTE #${fragmentIndex.toString().padStart(2, '0')}`, 20, 29);

  // Center timecode display
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillText(
    `${formatTimecode(startTimeSec)} → ${formatTimecode(endTimeSec)}`,
    16,
    86
  );

  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 11px "Plus Jakarta Sans", sans-serif';
  const durMin = ((endTimeSec - startTimeSec) / 60).toFixed(1);
  ctx.fillText(`Duración del bloque: ${durMin} min · 1080p Studio`, 16, 106);

  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Extracts real frame thumbnails from a local video ObjectURL for each fragment.
 */
export async function extractVideoThumbnails(
  objectUrl: string,
  fragments: VideoFragment[],
  totalDuration: number,
  onThumbnailReady: (fragmentId: string, dataUrl: string) => void
): Promise<void> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');

    let currentIdx = 0;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      resolve();
    };

    const captureNext = () => {
      if (currentIdx >= fragments.length) {
        cleanup();
        return;
      }
      const frag = fragments[currentIdx];
      // Seek 1.5 seconds into the fragment (or midpoint if very short) to avoid black fade-in frames
      const sampleTime = Math.min(
        frag.endTime - 0.1,
        frag.startTime + Math.min(2.0, frag.duration * 0.2)
      );
      try {
        video.currentTime = Math.max(0, sampleTime);
      } catch {
        currentIdx++;
        captureNext();
      }
    };

    video.addEventListener('loadeddata', () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = 320;
        canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth) || 180;
      }
      captureNext();
    });

    video.addEventListener('seeked', () => {
      const frag = fragments[currentIdx];
      if (ctx && frag) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          // Burn subtle bottom gradient + timecode stamp
          const grad = ctx.createLinearGradient(0, canvas.height - 36, 0, canvas.height);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, 'rgba(0,0,0,0.82)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, canvas.height - 36, canvas.width, 36);

          ctx.fillStyle = '#F8FAFC';
          ctx.font = '600 11px "JetBrains Mono", monospace';
          ctx.fillText(
            `#${frag.index.toString().padStart(2, '0')} · ${formatTimecode(frag.startTime)}`,
            8,
            canvas.height - 10
          );

          onThumbnailReady(frag.id, canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          onThumbnailReady(
            frag.id,
            renderStudioThumbnailDataUrl(frag.index, frag.startTime, frag.endTime, totalDuration)
          );
        }
      }
      currentIdx++;
      captureNext();
    });

    video.addEventListener('error', () => {
      cleanup();
    });
  });
}

/**
 * Generates FFmpeg CLI commands for users who want to run lossless cutting locally
 * on massive multi-gigabyte 4K files.
 */
export function generateFfmpegCliScript(
  source: VideoSourceMeta,
  fragments: VideoFragment[],
  config: CutConfig,
  osPlatform: 'unix' | 'windows'
): string {
  const included = fragments.filter((f) => f.included);
  const lines: string[] = [];

  if (osPlatform === 'unix') {
    lines.push('#!/usr/bin/env bash');
    lines.push(`# Script generado por CorteDiez Studio`);
    lines.push(`# Archivo origen: "${source.name}" (${formatTimecode(source.duration)})`);
    lines.push(`# Intervalo configurado: ${Math.round(config.segmentDurationSec / 60)} minutos (${config.segmentDurationSec}s)`);
    lines.push('');
    if (config.overlapSec === 0 && included.length === fragments.length) {
      lines.push('# Opción A: Segmentación automática ultrarrápida en un solo comando (-f segment)');
      lines.push(
        `ffmpeg -i "${source.name}" -c copy -map 0 -segment_time ${formatTimecode(
          config.segmentDurationSec
        )} -f segment -reset_timestamps 1 "${source.baseName}_10min_parte_%02d.${source.ext}"`
      );
      lines.push('');
    }
    lines.push('# Opción B: Corte individual exacto por cada fragmento seleccionado');
    for (const f of included) {
      const codecFlags =
        config.mode === 'copy'
          ? '-c copy -avoid_negative_ts make_zero'
          : '-c:v libx264 -preset fast -crf 20 -c:a aac';
      lines.push(
        `ffmpeg -y -ss ${formatTimecode(f.startTime)} -to ${formatTimecode(
          f.endTime
        )} -i "${source.name}" ${codecFlags} "${f.outputFileName}"`
      );
    }
  } else {
    lines.push('@echo off');
    lines.push(`REM Script generado por CorteDiez Studio para Windows`);
    lines.push(`REM Archivo origen: "${source.name}" (${formatTimecode(source.duration)})`);
    lines.push('');
    for (const f of included) {
      const codecFlags =
        config.mode === 'copy'
          ? '-c copy -avoid_negative_ts make_zero'
          : '-c:v libx264 -preset fast -crf 20 -c:a aac';
      lines.push(
        `ffmpeg -y -ss ${formatTimecode(f.startTime)} -to ${formatTimecode(
          f.endTime
        )} -i "${source.name}" ${codecFlags} "${f.outputFileName}"`
      );
    }
    lines.push('echo Corte de fragmentos de 10 minutos completado.');
    lines.push('pause');
  }

  return lines.join('\n');
}
