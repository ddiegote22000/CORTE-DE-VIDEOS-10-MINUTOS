import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

const PORT = 3000;
const TMP_DIR = path.join(os.tmpdir(), 'cortediez_studio');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Helper to format seconds into HH:MM:SS
function formatHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0'),
  ].join(':');
}

async function startServer() {
  const app = express();

  // Check FFmpeg availability on startup
  let ffmpegAvailable = false;
  let ffmpegVersion = 'No detectado';
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    ffmpegAvailable = true;
    ffmpegVersion = stdout.split('\n')[0] || 'FFmpeg 4.4+';
  } catch {
    ffmpegAvailable = false;
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      ffmpegAvailable,
      ffmpegVersion,
    });
  });

  // Upload a video file to temporary storage for server-side lossless FFmpeg cutting
  app.post(
    '/api/upload-source',
    express.raw({ type: '*/*', limit: '500mb' }),
    async (req: Request, res: Response) => {
      try {
        const rawExt = (req.query.ext as string) || 'mp4';
        const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'mp4';
        const fileId = crypto.randomBytes(8).toString('hex');
        const filePath = path.join(TMP_DIR, `src_${fileId}.${safeExt}`);

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: 'No se recibió contenido de video válido.' });
          return;
        }

        await fs.promises.writeFile(filePath, req.body);

        res.json({
          fileId,
          ext: safeExt,
          size: req.body.length,
        });
      } catch (err: any) {
        res.status(500).json({
          error: err?.message || 'Error al almacenar el archivo temporal en el servidor.',
        });
      }
    }
  );

  // Cut a specific fragment using FFmpeg lossless stream copy (-c copy) or fast re-encode
  app.post('/api/cut-segment', express.json(), async (req: Request, res: Response) => {
    try {
      const {
        fileId,
        ext = 'mp4',
        startTime = 0,
        endTime = 600,
        fragmentIndex = 1,
        mode = 'copy',
      } = req.body;

      const safeId = String(fileId || '').replace(/[^a-zA-Z0-9]/g, '');
      const safeExt = String(ext || 'mp4').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const inputPath = path.join(TMP_DIR, `src_${safeId}.${safeExt}`);

      if (!safeId || !fs.existsSync(inputPath)) {
        res.status(404).json({
          error: 'El archivo fuente no se encuentra en la sesión del servidor.',
        });
        return;
      }

      const startSec = Math.max(0, Number(startTime) || 0);
      const endSec = Math.max(startSec + 0.5, Number(endTime) || startSec + 600);
      const durationSec = endSec - startSec;

      const outExt = mode === 'reencode' ? 'mp4' : safeExt;
      const outFileName = `cut_${safeId}_part_${String(fragmentIndex).padStart(2, '0')}_${Date.now()}.${outExt}`;
      const outputPath = path.join(TMP_DIR, outFileName);

      const args: string[] = [
        '-y',
        '-ss',
        startSec.toFixed(3),
        '-i',
        inputPath,
        '-t',
        durationSec.toFixed(3),
      ];

      if (mode === 'reencode') {
        args.push(
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath
        );
      } else {
        // Lossless stream copy (-c copy) with timestamp reset
        args.push(
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          outputPath
        );
      }

      try {
        await execFileAsync('ffmpeg', args, { timeout: 60000 });
      } catch {
        // Fallback to fast re-encode if stream copy fails on an exotic container
        const fallbackArgs = [
          '-y',
          '-ss',
          startSec.toFixed(3),
          '-i',
          inputPath,
          '-t',
          durationSec.toFixed(3),
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath,
        ];
        await execFileAsync('ffmpeg', fallbackArgs, { timeout: 60000 });
      }

      const stat = await fs.promises.stat(outputPath);
      res.json({
        downloadUrl: `/api/download-segment/${outFileName}`,
        size: stat.size,
        ext: outExt,
      });
    } catch (err: any) {
      res.status(500).json({
        error: err?.message || 'Error al cortar el fragmento con FFmpeg.',
      });
    }
  });

  // Generate a real, playable MP4 clip for the built-in 24:30 Demo Video
  app.post('/api/demo-segment', express.json(), async (req: Request, res: Response) => {
    try {
      const {
        fragmentIndex = 1,
        startTime = 0,
        endTime = 600,
      } = req.body;

      const idx = Number(fragmentIndex) || 1;
      const startSec = Number(startTime) || 0;
      const endSec = Number(endTime) || 600;
      const clipDuration = Math.min(10, Math.max(3, endSec - startSec)); // 5s real playable studio preview clip representing the 10-min block
      const outFileName = `demo_fragmento_${String(idx).padStart(2, '0')}_${Date.now()}.mp4`;
      const outputPath = path.join(TMP_DIR, outFileName);

      // Generate a crisp 1280x720 studio test pattern with audio tone using FFmpeg
      const args = [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=5:size=1280x720:rate=30`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${330 + idx * 110}:duration=5`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        '-movflags',
        '+faststart',
        '-metadata',
        `title=Fragmento ${idx} (${formatHMS(startSec)} - ${formatHMS(endSec)})`,
        outputPath,
      ];

      await execFileAsync('ffmpeg', args, { timeout: 25000 });
      const stat = await fs.promises.stat(outputPath);

      res.json({
        downloadUrl: `/api/download-segment/${outFileName}`,
        size: stat.size,
        ext: 'mp4',
      });
    } catch (err: any) {
      res.status(500).json({
        error: err?.message || 'No se pudo generar el fragmento demo.',
      });
    }
  });

  // Download generated segment
  app.get('/api/download-segment/:fileName', (req: Request, res: Response) => {
    const rawName = String(req.params.fileName || '');
    const safeName = path.basename(rawName);
    const filePath = path.join(TMP_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      res.status(404).send('Archivo no encontrado');
      return;
    }

    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === '.webm'
        ? 'video/webm'
        : ext === '.mov'
        ? 'video/quicktime'
        : ext === '.mkv'
        ? 'video/x-matroska'
        : 'video/mp4';

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });

  // Mount Vite or static assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CorteDiez Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
