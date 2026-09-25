import type { DecodedVolume, ProjectState } from '../types';
import { clampIndex, createId } from '../voxel/format';

export function createInitialProject(volume: DecodedVolume): ProjectState {
  const now = Date.now();
  const center = clampIndex(
    volume.metadata.dimensions.map((dimension) => Math.floor(dimension / 2)) as [number, number, number],
    volume.metadata.dimensions,
  );
  return {
    id: createId('project'),
    name: volume.fileName.replace(/\.vvol$/i, ''),
    createdAt: now,
    updatedAt: now,
    cursor: center,
    activeAxis: 2,
    slices: [...center] as [number, number, number],
    annotations: [],
    roi: null,
  };
}
