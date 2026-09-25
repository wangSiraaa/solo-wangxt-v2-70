import type { Axis, RectangularROI, ScalarEncoding, VoxelIndex, VoxelMetadata } from '../types';
import { voxelOffset } from '../voxel/format';

export function createScalarView(
  data: ArrayBuffer,
  scalarType: ScalarEncoding,
): ArrayLike<number> {
  switch (scalarType) {
    case 'uint8':
      return new Uint8Array(data);
    case 'int16':
      return new Int16Array(data);
    case 'uint16':
      return new Uint16Array(data);
    case 'float32':
      return new Float32Array(data);
  }
}

export interface RoiStats {
  count: number;
  thresholdCount: number;
  fraction: number;
  mean: number;
  min: number;
  max: number;
  width: number;
  height: number;
  areaMm2: number;
}

const inPlaneAxes: Record<Axis, [number, number]> = {
  0: [1, 2],
  1: [0, 2],
  2: [0, 1],
};

export function normalizeRoiCorners(
  axis: Axis,
  slice: number,
  a: VoxelIndex,
  b: VoxelIndex,
  metadata: VoxelMetadata,
): RectangularROI {
  const axes = [0, 1, 2] as const;
  const min = [0, 0, 0] as VoxelIndex;
  const max = [0, 0, 0] as VoxelIndex;

  for (const currentAxis of axes) {
    if (currentAxis === axis) {
      min[currentAxis] = max[currentAxis] = Math.round(slice);
    } else {
      min[currentAxis] = Math.min(a[currentAxis], b[currentAxis]);
      max[currentAxis] = Math.max(a[currentAxis], b[currentAxis]);
    }
    min[currentAxis] = Math.max(0, Math.min(metadata.dimensions[currentAxis] - 1, min[currentAxis]));
    max[currentAxis] = Math.max(0, Math.min(metadata.dimensions[currentAxis] - 1, max[currentAxis]));
  }

  const now = Date.now();
  const span = metadata.max - metadata.min;
  const thresholdLow = metadata.min + span * 0.6;
  const thresholdHigh = metadata.max;
  return {
    id: `roi-${now}`,
    axis,
    slice,
    min,
    max,
    thresholdLow: metadata.scalarType === 'float32' ? thresholdLow : Math.round(thresholdLow),
    thresholdHigh: metadata.scalarType === 'float32' ? thresholdHigh : Math.round(thresholdHigh),
    createdAt: now,
    updatedAt: now,
  };
}

export function getRoiStats(
  roi: RectangularROI,
  metadata: VoxelMetadata,
  values: ArrayLike<number>,
): RoiStats {
  const [uAxis, vAxis] = inPlaneAxes[roi.axis];
  const width = roi.max[uAxis] - roi.min[uAxis] + 1;
  const height = roi.max[vAxis] - roi.min[vAxis] + 1;
  const count = width * height;
  let thresholdCount = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const index: VoxelIndex = [0, 0, 0];
  index[roi.axis] = roi.slice;

  for (let v = roi.min[vAxis]; v <= roi.max[vAxis]; v += 1) {
    index[vAxis] = v;
    for (let u = roi.min[uAxis]; u <= roi.max[uAxis]; u += 1) {
      index[uAxis] = u;
      const value = values[voxelOffset(index, metadata.dimensions)];
      sum += value;
      if (value < min) min = value;
      if (value > max) max = value;
      if (value >= roi.thresholdLow && value <= roi.thresholdHigh) {
        thresholdCount += 1;
      }
    }
  }

  return {
    count,
    thresholdCount,
    fraction: count === 0 ? 0 : thresholdCount / count,
    mean: count === 0 ? 0 : sum / count,
    min: count === 0 ? 0 : min,
    max: count === 0 ? 0 : max,
    width,
    height,
    areaMm2: width * metadata.spacing[uAxis] * height * metadata.spacing[vAxis],
  };
}
