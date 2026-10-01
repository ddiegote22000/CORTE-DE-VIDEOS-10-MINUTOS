import React, { useState } from 'react';
import { Copy, Check, Download, Terminal, FileSpreadsheet } from 'lucide-react';
import {
  VideoFragment,
  VideoSourceMeta,
  CutConfig,
  generateFfmpegCliScript,
  formatTimecode,
} from '../utils/videoSegmenter';

interface ExportAutomationPanelProps {
  source: VideoSourceMeta;
  fragments: VideoFragment[];
  config: CutConfig;
}

export const ExportAutomationPanel: React.FC<ExportAutomationPanelProps> = ({
  source,
  fragments,
  config,
}) => {
  const [osPlatform, setOsPlatform] = useState<'unix' | 'windows'>('unix');
  const [copied, setCopied] = useState(false);

  const scriptContent = generateFfmpegCliScript(
    source,
    fragments,
    config,
    osPlatform
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy
    }
  };

  const handleDownloadScript = () => {
    const ext = osPlatform === 'unix' ? 'sh' : 'bat';
    const blob = new Blob([scriptContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cortar_10min_${source.baseName}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleDownloadCsv = () => {
    const headers = [
      'Fragmento',
      'Incluido',
      'Inicio_TC',
      'Fin_TC',
      'Inicio_Seg',
      'Fin_Seg',
      'Duracion_Seg',
      'Archivo_Salida',
    ];
    const rows = fragments.map((f) => [
      f.index,
      f.included ? 'SI' : 'NO',
      formatTimecode(f.startTime),
      formatTimecode(f.endTime),
      f.startTime.toFixed(2),
      f.endTime.toFixed(2),
      f.duration.toFixed(2),
      `"${f.outputFileName}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `escaleta_10min_${source.baseName}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <section
      id="exportacion-avanzada"
      className="bg-[#111827] border border-slate-800/90 rounded-xl p-5"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            04. Automatización Local y Escaleta de Tiempos (Opcional para Archivos 4K Masivos)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Además de cortar directamente en el navegador/servidor arriba, puedes exportar la tabla CSV de bloques de 10 minutos o el comando nativo sin recodificación.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* OS Switcher Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setOsPlatform('unix')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                osPlatform === 'unix'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              macOS / Linux (.sh)
            </button>
            <button
              type="button"
              onClick={() => setOsPlatform('windows')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                osPlatform === 'windows'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Windows (.bat)
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Exportar Escaleta CSV</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadScript}
            className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Descargar Script ({osPlatform === 'unix' ? '.sh' : '.bat'})</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="h-9 px-3 rounded-lg bg-slate-100 hover:bg-white text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Comandos</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <pre className="p-4 rounded-lg bg-[#090D14] border border-slate-800/80 text-xs font-mono tabular-nums text-slate-300 overflow-x-auto leading-relaxed">
          {scriptContent}
        </pre>
      </div>
    </section>
  );
};
