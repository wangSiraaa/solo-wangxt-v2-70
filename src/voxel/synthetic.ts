import {
  SAMPLE_DIMENSIONS,
  SAMPLE_SPACING,
  SCALAR_INFO,
  VOXEL_HEADER_SIZE,
  VOXEL_MAGIC,
  VOXEL_VERSION,
} from './format';

const PORE_CENTERS: Array<[number, number, number]> = [
  [11, 18, 16],
  [31, 22, 22],
  [20, 43, 37],
  [36, 48, 55],
  [14, 31, 61],
];

export function syntheticVoxelValue(i: number, j: number, k: number): number {
  const [nx, ny, nz] = SAMPLE_DIMENSIONS;
  const [sx, sy, sz] = SAMPLE_SPACING;
  const dx = (i - (nx - 1) / 2) * sx;
  const dy = (j - (ny - 1) / 2) * sy;
  const dz = (k - (nz - 1) / 2) * sz;
  const radius = Math.sqrt(dx * dx + dy * dy);

  let value = 18;
  if (radius <= 4.2) {
    const angular = Math.atan2(dy, dx) + dz * 1.25;
    value = 210
      + Math.sin(radius * 2.3 + angular * 1.45) * 22
      + Math.sin(dz * 3.05) * 17;
  }

  for (const [ci, cj, ck] of PORE_CENTERS) {
    const px = (i - ci) * sx;
    const py = (j - cj) * sy;
    const pz = (k - ck) * sz;
    const distance = Math.sqrt(px * px + py * py + pz * pz);
    value = Math.min(value, 70 + distance * 85);
  }

  return Math.max(0, Math.min(255, Math.round(value)));
}

export function createSyntheticVoxelFile(): ArrayBuffer {
  const dimensions = SAMPLE_DIMENSIONS;
  const spacing = SAMPLE_SPACING;
  const origin: [number, number, number] = [0, 0, 0];
  const count = dimensions[0] * dimensions[1] * dimensions[2];
  const buffer = new ArrayBuffer(VOXEL_HEADER_SIZE + count * SCALAR_INFO.uint8.bytes);
  const view = new DataView(buffer);
  const magic = new TextEncoder().encode(VOXEL_MAGIC);
  new Uint8Array(buffer, 0, 4).set(magic);
  view.setUint16(4, VOXEL_VERSION, true);
  view.setUint16(6, SCALAR_INFO.uint8.code, true);
  view.setUint32(8, dimensions[0], true);
  view.setUint32(12, dimensions[1], true);
  view.setUint32(16, dimensions[2], true);
  view.setFloat32(20, spacing[0], true);
  view.setFloat32(24, spacing[1], true);
  view.setFloat32(28, spacing[2], true);
  view.setFloat32(32, origin[0], true);
  view.setFloat32(36, origin[1], true);
  view.setFloat32(40, origin[2], true);

  const bytes = new Uint8Array(buffer, VOXEL_HEADER_SIZE);
  for (let k = 0; k < dimensions[2]; k += 1) {
    for (let j = 0; j < dimensions[1]; j += 1) {
      for (let i = 0; i < dimensions[0]; i += 1) {
        const offset = i + dimensions[0] * (j + dimensions[1] * k);
        bytes[offset] = syntheticVoxelValue(i, j, k);
      }
    }
  }
  return buffer;
}
