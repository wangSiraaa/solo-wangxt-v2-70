import { useEffect, useMemo, useState } from 'react';
import type { DecodedVolume } from '../types';
import type { DecodeRequest, DecodeResponse } from '../voxel/decoder.worker';

export function useDecoderWorker() {
  const worker = useMemo(
    () => new Worker(new URL('../voxel/decoder.worker.ts', import.meta.url), { type: 'module' }),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => worker.terminate(), [worker]);

  function request(decodeRequest: DecodeRequest): Promise<DecodedVolume> {
    setBusy(true);
    setError(null);
    return new Promise((resolve, reject) => {
      const cleanup = () => worker.removeEventListener('message', onMessage);
      const onMessage = (event: MessageEvent<DecodeResponse>) => {
        cleanup();
        setBusy(false);
        if (event.data.type === 'decoded') {
          resolve(event.data.volume);
        } else {
          setError(event.data.message);
          reject(new Error(event.data.message));
        }
      };
      worker.addEventListener('message', onMessage, { once: false });
      worker.postMessage(decodeRequest);
    });
  }

  return {
    busy,
    error,
    decodeFile: (file: File) => request({ type: 'decodeFile', file }),
    loadSample: () => request({ type: 'sample' }),
  };
}
