import { describe, expect, it } from 'vitest';
import type { VoxelMetadata } from './types';
import {
  SAMPLE_DIMENSIONS,
  SAMPLE_SPACING,
  distanceMm,
  indexToPhysical,
  physicalToIndex,
} from './voxel/format';
import { parseVoxel } from './voxel/parser';
import { createSyntheticVoxelFile, syntheticVoxelValue } from './voxel/synthetic';
import { createScalarView, getRoiStats, normalizeRoiCorners } from './lib/volumeAccess';

const metadata: VoxelMetadata = {
  dimensions: SAMPLE_DIMENSIONS,
  spacing: SAMPLE_SPACING,
  origin: [0, 0, 0],
  scalarType: 'uint8',
  count: SAMPLE_DIMENSIONS[0] * SAMPLE_DIMENSIONS[1] * SAMPLE_DIMENSIONS[2],
  min: 0,
  max: 255,
};

describe('synthetic anisotropic core format', () => {
  it('parses explicit dimensions, anisotropic spacing and uint8 scalar type', () => {
    const decoded = parseVoxel(createSyntheticVoxelFile(), 'sample.vvol');

    expect(decoded.metadata.dimensions).toEqual([48, 64, 80]);
    expect(decoded.metadata.spacing).toEqual([0.25, 0.5, 0.75]);
    expect(decoded.metadata.scalarType).toBe('uint8');
    expect(decoded.metadata.count).toBe(48 * 64 * 80);
    expect(new Uint8Array(decoded.data)).toHaveLength(decoded.metadata.count);
  });

  it('converts coordinates with anisotropic physical spacing', () => {
    expect(indexToPhysical([10, 20, 30], metadata)).toEqual([2.5, 10, 22.5]);
    expect(physicalToIndex([2.5, 10, 22.5], metadata)).toEqual([10, 20, 30]);
  });

  it('measures voxel distance using per-axis spacing', () => {
    expect(distanceMm([0, 0, 0], [4, 2, 10], SAMPLE_SPACING))
      .toBeCloseTo(Math.sqrt(1 ** 2 + 1 ** 2 + 7.5 ** 2), 10);
  });

  it('counts ROI voxels and threshold preview on one slice', () => {
    const decoded = parseVoxel(createSyntheticVoxelFile(), 'sample.vvol');
    const values = createScalarView(decoded.data, 'uint8');
    const roi = normalizeRoiCorners(2, 30, [5, 10, 30], [9, 14, 30], metadata);

    expect(roi.min).toEqual([5, 10, 30]);
    expect(roi.max).toEqual([9, 14, 30]);

    roi.thresholdLow = 200;
    roi.thresholdHigh = 255;
    const stats = getRoiStats(roi, decoded.metadata, values);

    expect(stats.width).toBe(5);
    expect(stats.height).toBe(5);
    expect(stats.count).toBe(25);
    expect(stats.areaMm2).toBeCloseTo(5 * 0.25 * 5 * 0.5, 6);
    expect(stats.thresholdCount).toBeGreaterThanOrEqual(0);
    expect(stats.thresholdCount).toBeLessThanOrEqual(25);

    const centerValue = syntheticVoxelValue(7, 12, 30);
    expect(values[7 + 48 * (12 + 64 * 30)]).toBe(centerValue);
  });
});
