/// <reference lib="webworker" />
import type { DecodedVolume } from '../types';
import { parseVoxel } from './parser';
import { createSyntheticVoxelFile } from './synthetic';

export type DecodeRequest =
  | { type: 'decodeFile'; file: File }
  | { type: 'sample' };

export type DecodeResponse =
  | { type: 'decoded'; volume: DecodedVolume }
  | { type: 'error'; message: string };

const workerScope = self as DedicatedWorkerGlobalScope;

function postDecoded(volume: DecodedVolume) {
  workerScope.postMessage(
    { type: 'decoded', volume } satisfies DecodeResponse,
    [volume.data],
  );
}

workerScope.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  try {
    const request = event.data;
    if (request.type === 'sample') {
      const file = createSyntheticVoxelFile();
      postDecoded(parseVoxel(file, 'synthetic-anisotropic-core.vvol'));
      return;
    }

    const buffer = await request.file.arrayBuffer();
    postDecoded(parseVoxel(buffer, request.file.name));
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '解码失败。',
    } satisfies DecodeResponse);
  }
};
