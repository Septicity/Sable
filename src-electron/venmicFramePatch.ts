export const VENMIC_FRAME_PATCH_SCRIPT = `
(() => {
  const w = window;

  if (!w.navigator?.mediaDevices?.getDisplayMedia) {
    return '[Venmic] skip:no-getDisplayMedia';
  }

  if (w.__venmicPatched) {
    return '[Venmic] skip:already-patched';
  }

  let desktopBridge = w.sableDesktop;
  if (!desktopBridge) {
    try {
      desktopBridge = w.top?.sableDesktop;
    } catch {
      desktopBridge = undefined;
    }
  }

  if (!desktopBridge?.promptAudio || !desktopBridge?.stopSystemAudio) {
    console.warn('[Venmic] Frame has no sableDesktop bridge; audio patch calls will be unavailable');
    return '[Venmic] skip:no-bridge';
  }

  const mediaDevices = w.navigator.mediaDevices;
  const originalGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);

  mediaDevices.getDisplayMedia = async (options) => {
    console.log('[Venmic] Intercepted getDisplayMedia call (frame injector)');

    const stream = await originalGetDisplayMedia(options);
    const captureStarted = await desktopBridge.promptAudio();
    console.log('[Venmic] Requested PipeWire audio patch: ' + (captureStarted ? 'enabled' : 'disabled'));

    if (!captureStarted) {
      return stream;
    }

    try {
      const devices = await mediaDevices.enumerateDevices();
      const venmicDevice = devices.find((d) => d.label === 'vencord-screen-share');

      if (venmicDevice) {
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

          const stopPatch = () => {
            audioTrack.stop();
            desktopBridge.stopSystemAudio();
          };

          stream.getVideoTracks().forEach((track) => {
            track.addEventListener('ended', stopPatch, { once: true });
          });
        }
      }
    } catch (error) {
      console.error('[Venmic] Failed to stitch audio track in frame injector:', error);
    }

    return stream;
  };

  w.__venmicPatched = true;
  console.log('[Venmic] getDisplayMedia interceptor installed in frame');
  return '[Venmic] patched';
})();
`;
