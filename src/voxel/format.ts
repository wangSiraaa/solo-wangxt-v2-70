import type {
  Axis,
  PhysicalPoint,
  ScalarEncoding,
  VoxelIndex,
  VoxelMetadata,
} from '../types';

export const VOXEL_MAGIC = 'VVOX';
export const VOXEL_VERSION = 1;
export const VOXEL_HEADER_SIZE = 64;

export const SCALAR_INFO: Record<
  ScalarEncoding,
  { code: number; bytes: number; dataType: string; littleEndian: boolean }
> = {
  uint8: { code: 1, bytes: 1, dataType: 'Uint8Array', littleEndian: true },
  int16: { code: 2, bytes: 2, dataType: 'Int16Array', littleEndian: true },
  uint16: { code: 3, bytes: 2, dataType: 'Uint16Array', littleEndian: true },
  float32: { code: 4, bytes: 4, dataType: 'Float32Array', littleEndian: true },
};

export const SCALAR_BY_CODE: Record<number, ScalarEncoding> = {
  1: 'uint8',
  2: 'int16',
  3: 'uint16',
  4: 'float32',
};

export const SAMPLE_DIMENSIONS: [number, number, number] = [48, 64, 80];
export const SAMPLE_SPACING: [number, number, number] = [0.25, 0.5, 0.75];

export function clampIndex(index: VoxelIndex, dimensions: VoxelIndex): VoxelIndex {
  return [
    Math.max(0, Math.min(dimensions[0] - 1, Math.round(index[0]))),
    Math.max(0, Math.min(dimensions[1] - 1, Math.round(index[1]))),
    Math.max(0, Math.min(dimensions[2] - 1, Math.round(index[2]))),
  ];
}

export function indexToPhysical(
  index: VoxelIndex,
  metadata: Pick<VoxelMetadata, 'origin' | 'spacing'>,
): PhysicalPoint {
  return [
    metadata.origin[0] + index[0] * metadata.spacing[0],
    metadata.origin[1] + index[1] * metadata.spacing[1],
    metadata.origin[2] + index[2] * metadata.spacing[2],
  ];
}

export function physicalToIndex(
  point: PhysicalPoint,
  metadata: Pick<VoxelMetadata, 'origin' | 'spacing' | 'dimensions'>,
): VoxelIndex {
  const raw: VoxelIndex = [
    (point[0] - metadata.origin[0]) / metadata.spacing[0],
    (point[1] - metadata.origin[1]) / metadata.spacing[1],
    (point[2] - metadata.origin[2]) / metadata.spacing[2],
  ];
  return clampIndex(raw, metadata.dimensions);
}

export function distanceMm(a: VoxelIndex, b: VoxelIndex, spacing: VoxelIndex): number {
  const dx = (a[0] - b[0]) * spacing[0];
  const dy = (a[1] - b[1]) * spacing[1];
  const dz = (a[2] - b[2]) * spacing[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function axisLabel(axis: Axis): string {
  return ['I / X', 'J / Y', 'K / Z'][axis];
}

export function formatMm(value: number): string {
  return `${value.toFixed(3)} mm`;
}

export function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function voxelOffset(index: VoxelIndex, dimensions: VoxelIndex): number {
  return index[0] + dimensions[0] * (index[1] + dimensions[1] * index[2]);
}
