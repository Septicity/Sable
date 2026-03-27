import {
  app,
  ipcMain,
  BrowserWindow,
  session,
  desktopCapturer,
  webFrameMain,
  Menu,
} from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '@vencord/venmic';
import { VENMIC_FRAME_PATCH_SCRIPT } from './venmicFramePatch';
const { PatchBay } = pkg;

let patchbay: InstanceType<typeof PatchBay> | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');

let mainWindow: BrowserWindow | null = null;
let localServer: http.Server | null = null;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const resolveLocalPath = (urlPathname: string): string | undefined => {
  const decodedPath = decodeURIComponent(urlPathname);
  const requested = decodedPath === '/' ? '/index.html' : decodedPath;
  const normalized = path.normalize(requested).replace(/^([/\\])+/, '');
  const resolved = path.resolve(DIST_DIR, normalized);

  // Block directory traversal and keep serving scoped to dist only.
  if (!resolved.startsWith(DIST_DIR + path.sep) && resolved !== DIST_DIR) {
    return undefined;
  }

  return resolved;
};

const serveFile = (res: http.ServerResponse, filePath: string): void => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
};

const startLocalAppServer = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!fs.existsSync(INDEX_FILE)) {
      reject(new Error(`Missing app bundle: ${INDEX_FILE}`));
      return;
    }

    localServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const resolved = resolveLocalPath(reqUrl.pathname);

        if (!resolved) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }

        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          serveFile(res, resolved);
          return;
        }

        // Serve index.html only for app routes. Missing asset files should be 404.
        if (path.extname(reqUrl.pathname)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          return;
        }

        // SPA fallback for client-side routes.
        serveFile(res, INDEX_FILE);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      }
    });

    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer?.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve local server address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,

    autoHideMenuBar: true,

    icon: path.join(__dirname, '../../dist/logo/cinny-logo-512x512.png'),

    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,

      nodeIntegrationInSubFrames: true,
    },
  });

  const injectVenmicIntoFrame = async (
    frame: Electron.WebFrameMain,
    reason: string
  ): Promise<void> => {
    if (frame.detached) return;

    const frameUrl = frame.url;
    if (!frameUrl || frameUrl === 'about:blank' || !frameUrl.includes('element-call')) {
      return;
    }

    try {
      const result = await frame.executeJavaScript(VENMIC_FRAME_PATCH_SCRIPT, true);
      console.log(`[Venmic] Frame injection (${reason}): ${frameUrl} -> ${String(result)}`);
    } catch (error) {
      console.error(`[Venmic] Frame injection failed (${reason}) for ${frameUrl}:`, error);
    }
  };

  const injectVenmicIntoLoadedFrames = (reason: string): void => {
    if (!mainWindow) return;
    mainWindow.webContents.mainFrame.framesInSubtree.forEach((frame) => {
      void injectVenmicIntoFrame(frame, reason);
    });
  };

  mainWindow.webContents.on('did-finish-load', () => {
    injectVenmicIntoLoadedFrames('did-finish-load');
  });

  mainWindow.webContents.on(
    'did-frame-finish-load',
    (_event, isMainFrame, frameProcessId, frameRoutingId) => {
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (frame) {
        void injectVenmicIntoFrame(frame, 'did-frame-finish-load');
      }

      if (isMainFrame) {
        injectVenmicIntoLoadedFrames('main-frame-navigation');
      }
    }
  );

  // In development use local Vite server; in packaged mode load hosted web app.
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const localAppUrl = await startLocalAppServer();
    await mainWindow.loadURL(localAppUrl);
  }
}

function getRendererAudioServicePid(): number | null {
  const metrics = app.getAppMetrics();
  const audioProcess = metrics.find((proc) => proc.name === 'Audio Service');
  return audioProcess?.pid ?? null;
}

app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

type VenmicNodeInfo = {
  'application.name'?: string;
  'application.process.id'?: string;
  'media.class'?: string;
};

app.whenReady().then(() => {
  // Initialize Venmic
  if (PatchBay.hasPipeWire()) {
    try {
      patchbay = new PatchBay();
      console.log('[Venmic] Venmic initialized successfully');

      // console.log('Available audio sources:', patchbay.list());
      console.log('\n');
    } catch (err) {
      console.error('[Venmic] Failed to initialize Venmic:', err);
    }
  } else {
    console.warn('[Venmic] Venmic is not supported on this platform');
  }

  // Start IPC handlers for Venmic interactions

  // Prompt for system or per-app audio routing before stitch-in.
  ipcMain.handle('venmic:prompt-audio', async () => {
    if (!patchbay) return false;

    const nodes = patchbay.list([
      'application.name',
      'application.process.id',
      'media.class',
    ]) as VenmicNodeInfo[];
    const audioPid = getRendererAudioServicePid()?.toString();
    const mainPid = process.pid.toString();

    const outputApps = nodes.filter((node) => {
      const appName = node['application.name'];
      const pid = node['application.process.id'];
      const mediaClass = node['media.class'];
      return (
        !!appName &&
        !!pid &&
        pid !== audioPid &&
        pid !== mainPid &&
        mediaClass !== 'Stream/Input/Audio'
      );
    });

    const uniqueApps = new Map<string, string>();
    outputApps.forEach((app) => {
      const appName = app['application.name'];
      const pid = app['application.process.id'];
      if (appName && pid && !uniqueApps.has(appName)) {
        uniqueApps.set(appName, pid);
      }
    });

    return new Promise<boolean>((resolve) => {
      let selectionMade = false;

      const finish = (result: boolean): void => {
        if (selectionMade) return;
        selectionMade = true;
        resolve(result);
      };

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'Share System Audio',
          click: () => {
            const success = patchbay.link({
              include: [],
              exclude: audioPid ? [{ 'application.process.id': audioPid }] : [],
              only_speakers: true,
            });
            console.log(`[Venmic] System audio capture: ${success ? 'enabled' : 'failed'}`);
            finish(success);
          },
        },
        { type: 'separator' },
      ];

      uniqueApps.forEach((pid, appName) => {
        template.push({
          label: `Share ${appName}`,
          click: () => {
            const success = patchbay.link({
              include: [{ 'application.process.id': pid }],
              exclude: [],
              only_speakers: true,
            });
            console.log(
              `[Venmic] Hooked into ${appName} (PID: ${pid}) -> ${success ? 'enabled' : 'failed'}`
            );
            finish(success);
          },
        });
      });

      template.push({ type: 'separator' });
      template.push({
        label: 'No Audio (Video Only)',
        click: () => {
          patchbay.unlink();
          console.log('[Venmic] User opted for video only');
          finish(false);
        },
      });

      const menu = Menu.buildFromTemplate(template);
      menu.once('menu-will-close', () => {
        setTimeout(() => {
          if (!selectionMade) {
            patchbay?.unlink();
            console.log('[Venmic] Menu closed without selection; defaulting to video only');
            finish(false);
          }
        }, 10);
      });

      menu.popup(mainWindow ? { window: mainWindow } : undefined);
    });
  });

  // Full system audio
  ipcMain.handle('venmic:system-audio', () => {
    if (!patchbay) return false;
    const audioPid = getRendererAudioServicePid();
    if (!audioPid) {
      console.warn('[Venmic] Could not find Audio Service process');
      return false;
    }

    const success = patchbay.link({
      include: [], // Capture everything
      exclude: audioPid ? [{ 'application.process.id': audioPid.toString() }] : [], // Exclude renderer's audio service to avoid feedback
      only_speakers: true, // Only capture speaker output, not microphone input
    });

    console.log(
      `[Venmic] Venmic system audio capture ${success ? 'enabled' : 'failed'}! Excluding Audio Service PID: ${audioPid}`
    );
    return success;
  });

  // Stop capture
  ipcMain.handle('venmic:stop', () => {
    if (!patchbay) return false;
    patchbay.unlink();
    console.log('[Venmic] Venmic capture stopped');
    return true;
  });

  // Accept Desktop Capture permissions for WebRTC calls
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Get available sources (screens, windows)
    desktopCapturer
      // Should in theory open the XDG desktop capturer prompt
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        if (sources && sources.length > 0) {
          callback({ video: sources[0] });
        } else {
          // Either no sources available or user cancelled
          callback(null as any);
        }
      })
      .catch((err) => {
        console.error('[Venmic] Desktop capture failed:', err);
        callback(null as any); // Cleanly deny capture on error
      });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
