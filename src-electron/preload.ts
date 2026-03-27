import { contextBridge, ipcRenderer, webFrame } from 'electron';

const installMainWorldPatch = async () => {
  console.log('[Venmic] Preload bootstrap, installing main-world trap...');

  await webFrame.executeJavaScript(`
    (() => {
      const w = window;
      if (!w.navigator?.mediaDevices?.getDisplayMedia) {
        console.warn('[Venmic] mediaDevices.getDisplayMedia is unavailable in this frame');
        return;
      }

      if (w.__venmicPatched) {
        console.log('[Venmic] getDisplayMedia already patched for this frame');
        return;
      }

      const mediaDevices = w.navigator.mediaDevices;
      const originalGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);

      mediaDevices.getDisplayMedia = async (options) => {
        console.log('[Venmic] Intercepted getDisplayMedia call');

        const stream = await originalGetDisplayMedia(options);
        const videoTracks = stream.getVideoTracks();
        console.log('[Venmic] Display stream ready with ' + videoTracks.length + ' video track(s)');

        const captureStarted = await w.sableDesktop.promptAudio();
        console.log('[Venmic] Requested PipeWire audio patch: ' + (captureStarted ? 'enabled' : 'disabled'));

        if (!captureStarted) {
          return stream;
        }

        try {
          const devices = await mediaDevices.enumerateDevices();
          console.log('[Venmic] enumerateDevices returned ' + devices.length + ' device(s)');

          const venmicDevice = devices.find((d) => d.label === 'vencord-screen-share');

          if (venmicDevice) {
            console.log('[Venmic] Found virtual device vencord-screen-share, requesting audio track');

            const audioStream = await mediaDevices.getUserMedia({
              audio: {
                deviceId: { exact: venmicDevice.deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
            });

            const audioTrack = audioStream.getAudioTracks()[0];
            if (audioTrack) {
              stream.addTrack(audioTrack);
              console.log('[Venmic] Audio track stitched into display stream');

              const stopPatch = () => {
                console.log('[Venmic] Display stream ended, stopping Venmic patch');
                audioTrack.stop();
                w.sableDesktop.stopSystemAudio();
              };

              stream.getVideoTracks().forEach((track) => {
                track.addEventListener('ended', stopPatch, { once: true });
              });
            } else {
              console.warn('[Venmic] getUserMedia succeeded but no audio track was returned');
            }
          } else {
            console.warn('[Venmic] Virtual microphone vencord-screen-share was not found');
          }
        } catch (error) {
          console.error('[Venmic] Failed to stitch audio track:', error);
        }

        return stream;
      };

      w.__venmicPatched = true;
      console.log('[Venmic] getDisplayMedia interceptor installed in main world');
    })();
  `);
};

// Keep explicit bridge for renderer code paths that may call into desktop helpers directly.
contextBridge.exposeInMainWorld('sableDesktop', {
  promptAudio: () => ipcRenderer.invoke('venmic:prompt-audio'),
  startSystemAudio: () => ipcRenderer.invoke('venmic:system-audio'),
  stopSystemAudio: () => ipcRenderer.invoke('venmic:stop'),
});

installMainWorldPatch().catch((error) => {
  console.error('[Venmic] Failed to install main-world trap:', error);
});
