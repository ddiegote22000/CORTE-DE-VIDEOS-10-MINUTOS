import React, { useState } from 'react';
import {
  Scissors,
  Download,
  Play,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Plus,
  Minus,
} from 'lucide-react';
import {
  VideoFragment,
  formatTimecode,
  formatDurationHuman,
  formatBytes,
} from '../utils/videoSegmenter';

interface FragmentQueueProps {
  fragments: VideoFragment[];
  activeFragmentId: string;
  targetDurationSec: number;
  isBatchProcessing: boolean;
  batchProgress: { current: number; total: number };
  onSelectFragment: (id: string, seekMonitor?: boolean) => void;
  onToggleInclude: (id: string) => void;
  onToggleAllInclude: (include: boolean) => void;
  onAdjustBoundary: (id: string, field: 'startTime' | 'endTime', deltaSec: number) => void;
  onCutSingle: (fragment: VideoFragment) => void;
  onCutBatch: () => void;
  onDownloadAllReady: () => void;
}

type FilterMode = 'all' | 'full' | 'tail' | 'completed';

export const FragmentQueue: React.FC<FragmentQueueProps> = ({
  fragments,
  activeFragmentId,
  targetDurationSec,
  isBatchProcessing,
  batchProgress,
  onSelectFragment,
  onToggleInclude,
  onToggleAllInclude,
  onAdjustBoundary,
  onCutSingle,
  onCutBatch,
  onDownloadAllReady,
}) => {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const targetMinutesLabel = Math.round(targetDurationSec / 60);

  const filteredFragments = fragments.filter((frag) => {
    if (filter === 'full' && !frag.isFullBlock) return false;
    if (filter === 'tail' && frag.isFullBlock) return false;
    if (filter === 'completed' && frag.status !== 'completed') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = frag.outputFileName.toLowerCase().includes(q);
      const matchChapter = (frag.chapterTitle || '').toLowerCase().includes(q);
      const matchTc =
        formatTimecode(frag.startTime).includes(q) ||
        formatTimecode(frag.endTime).includes(q);
      return matchName || matchChapter || matchTc;
    }
    return true;
  });

  const includedCount = fragments.filter((f) => f.included).length;
  const completedCount = fragments.filter((f) => f.status === 'completed').length;
  const allIncluded = fragments.length > 0 && includedCount === fragments.length;

  return (
    <section
      id="cola-fragmentos"
      className="bg-[#111827] border border-slate-800/90 rounded-xl overflow-hidden"
    >
      {/* Top Queue Header & Batch Actions */}
      <div className="p-5 border-b border-slate-800/80 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            03. Cola de Fragmentos ({fragments.length}{' '}
            {fragments.length === 1 ? 'bloque generado' : 'bloques generados'})
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>Intervalo base: {targetMinutesLabel} min ({targetDurationSec}s)</span>
            <span aria-hidden="true">·</span>
            <span>Seleccionados: {includedCount} de {fragments.length}</span>
            <span aria-hidden="true">·</span>
            <span>Listos para descarga: {completedCount}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {completedCount > 0 && (
            <button
              type="button"
              onClick={onDownloadAllReady}
              className="h-10 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Descargar Cortados ({completedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onCutBatch}
            disabled={isBatchProcessing || includedCount === 0}
            className="h-10 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {isBatchProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  Cortando Lote ({batchProgress.current}/{batchProgress.total})...
                </span>
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                <span>
                  Cortar {includedCount}{' '}
                  {includedCount === 1 ? 'Fragmento' : 'Fragmentos'} de {targetMinutesLabel} min
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filter Bar & Live Search */}
      <div className="px-5 py-3 bg-[#0E1422] border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Interactive Filter Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800/80 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'all'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Todos ({fragments.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('full')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'full'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Bloques Completos {targetMinutesLabel}m (
            {fragments.filter((f) => f.isFullBlock).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('tail')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'tail'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cola Restante ({fragments.filter((f) => !f.isFullBlock).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'completed'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cortados ({completedCount})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre o código 00:10:00..."
            className="w-full h-9 pl-8 pr-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* High-Density Data Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800/80 text-[11px] font-medium text-slate-400 bg-[#0B0F17]/60">
              <th className="py-3 pl-5 pr-2 w-10">
                <input
                  type="checkbox"
                  checked={allIncluded}
                  onChange={(e) => onToggleAllInclude(e.target.checked)}
                  aria-label="Seleccionar todos los fragmentos"
                  className="rounded border-slate-700 bg-slate-900 accent-amber-500 cursor-pointer"
                />
              </th>
              <th className="py-3 px-3">Vista Previa</th>
              <th className="py-3 px-3">Fragmento y Archivo de Salida</th>
              <th className="py-3 px-3">Rango de Tiempo (Inicio → Fin)</th>
              <th className="py-3 px-3 text-right">Duración</th>
              <th className="py-3 px-3 text-right">Tamaño Est.</th>
              <th className="py-3 px-3">Estado</th>
              <th className="py-3 pl-3 pr-5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-sm">
            {filteredFragments.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 px-6 text-center text-slate-400">
                  <p className="text-sm font-medium text-slate-300">
                    No hay fragmentos que coincidan con el filtro seleccionado.
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Cambia la pestaña de filtrado o limpia el cuadro de búsqueda para ver todos los cortes.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter('all');
                      setSearchQuery('');
                    }}
                    className="mt-3 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
                  >
                    Mostrar todos los fragmentos
                  </button>
                </td>
              </tr>
            ) : (
              filteredFragments.map((frag) => {
                const isSelected = frag.id === activeFragmentId;
                return (
                  <tr
                    key={frag.id}
                    onClick={() => onSelectFragment(frag.id, false)}
                    className={`transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/10 hover:bg-amber-500/15'
                        : 'hover:bg-slate-800/40'
                    } ${!frag.included ? 'opacity-50' : ''}`}
                  >
                    {/* Include Checkbox */}
                    <td
                      className="py-3 pl-5 pr-2 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={frag.included}
                        onChange={() => onToggleInclude(frag.id)}
                        aria-label={`Incluir fragmento #${frag.index}`}
                        className="rounded border-slate-700 bg-slate-900 accent-amber-500 cursor-pointer"
                      />
                    </td>

                    {/* Extracted Video Thumbnail with Zero-Broken-Image Fallback */}
                    <td className="py-3 px-3 align-middle w-32">
                      <div className="relative w-28 h-16 rounded-md overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
                        {frag.thumbnailDataUrl ? (
                          <img
                            src={frag.thumbnailDataUrl}
                            alt={`Miniatura del fragmento ${frag.index} en ${formatTimecode(
                              frag.startTime
                            )}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            #{frag.index.toString().padStart(2, '0')}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Fragment Info & Unboxed Metadata */}
                    <td className="py-3 px-3 align-middle min-w-[220px]">
                      <div className="font-mono tabular-nums text-xs font-semibold text-slate-100 truncate max-w-[280px]">
                        {frag.outputFileName}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                        <span>
                          Fragmento #{frag.index.toString().padStart(2, '0')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {frag.isFullBlock
                            ? `Bloque estándar (${targetMinutesLabel} min)`
                            : 'Cola final restante'}
                        </span>
                      </div>
                    </td>

                    {/* Timecode Range + Fine Nudge Controls */}
                    <td
                      className="py-3 px-3 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2 font-mono tabular-nums text-xs text-slate-200">
                        <span className="text-amber-300 font-medium">
                          {formatTimecode(frag.startTime)}
                        </span>
                        <span className="text-slate-500">→</span>
                        <span className="text-amber-300 font-medium">
                          {formatTimecode(frag.endTime)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>Ajuste fino fin:</span>
                        <button
                          type="button"
                          onClick={() => onAdjustBoundary(frag.id, 'endTime', -1)}
                          title="Restar 1 segundo al punto de salida"
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono tabular-nums flex items-center gap-0.5 cursor-pointer"
                        >
                          <Minus className="w-2.5 h-2.5" />
                          <span>1s</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdjustBoundary(frag.id, 'endTime', 1)}
                          title="Sumar 1 segundo al punto de salida"
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono tabular-nums flex items-center gap-0.5 cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          <span>1s</span>
                        </button>
                      </div>
                    </td>

                    {/* Duration */}
                    <td className="py-3 px-3 align-middle text-right font-mono tabular-nums text-xs text-slate-200 whitespace-nowrap">
                      <div>{formatDurationHuman(frag.duration)}</div>
                      <div className="text-[11px] text-slate-500">
                        {frag.duration.toFixed(1)} s
                      </div>
                    </td>

                    {/* Size */}
                    <td className="py-3 px-3 align-middle text-right font-mono tabular-nums text-xs text-slate-300 whitespace-nowrap">
                      {formatBytes(frag.actualSizeBytes || frag.estimatedSizeBytes)}
                    </td>

                    {/* Semantic Status (Icon + Unboxed Text, No Pill Badges) */}
                    <td className="py-3 px-3 align-middle whitespace-nowrap">
                      {frag.status === 'completed' ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Cortado · Listo</span>
                        </div>
                      ) : frag.status === 'processing' ? (
                        <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                          <span>Procesando...</span>
                        </div>
                      ) : frag.status === 'error' ? (
                        <div
                          className="flex items-center gap-1.5 text-xs text-rose-400 font-medium"
                          title={frag.errorMessage}
                        >
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>Reintentar</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                          <span>Pendiente de corte</span>
                        </div>
                      )}
                    </td>

                    {/* Row Actions */}
                    <td
                      className="py-3 pl-3 pr-5 align-middle text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectFragment(frag.id, true)}
                          title="Cargar este bloque de 10 min en el reproductor"
                          className="h-8 px-2.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Previsualizar</span>
                        </button>

                        {frag.status === 'completed' && frag.downloadUrl ? (
                          <a
                            href={frag.downloadUrl}
                            download={frag.outputFileName}
                            className="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Descargar</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onCutSingle(frag)}
                            disabled={frag.status === 'processing'}
                            className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-white text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Scissors className="w-3.5 h-3.5" />
                            <span>Cortar</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
