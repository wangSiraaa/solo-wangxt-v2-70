import type { DecodedVolume, ScalarEncoding } from '../types';
import {
  SCALAR_BY_CODE,
  SCALAR_INFO,
  VOXEL_HEADER_SIZE,
  VOXEL_MAGIC,
  VOXEL_VERSION,
} from './format';

function decodeMagic(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return String.fromCharCode(...bytes);
}

function readScalars(
  buffer: ArrayBuffer,
  type: ScalarEncoding,
  count: number,
): { values: ArrayLike<number>; data: ArrayBuffer } {
  const info = SCALAR_INFO[type];
  const expectedBytes = count * info.bytes;
  if (buffer.byteLength < VOXEL_HEADER_SIZE + expectedBytes) {
    throw new Error(
      `体素数据不完整：需要 ${expectedBytes} 字节，实际只有 ${buffer.byteLength - VOXEL_HEADER_SIZE} 字节。`,
    );
  }

  const data = buffer.slice(VOXEL_HEADER_SIZE, VOXEL_HEADER_SIZE + expectedBytes);
  switch (type) {
    case 'uint8':
      return { values: new Uint8Array(data), data };
    case 'int16':
      return { values: new Int16Array(data), data };
    case 'uint16':
      return { values: new Uint16Array(data), data };
    case 'float32':
      return { values: new Float32Array(data), data };
  }
}

export function parseVoxel(buffer: ArrayBuffer, fileName: string): DecodedVolume {
  if (buffer.byteLength < VOXEL_HEADER_SIZE) {
    throw new Error(`文件过小：${VOXEL_HEADER_SIZE} 字节的文件头缺失。`);
  }
  if (decodeMagic(buffer) !== VOXEL_MAGIC) {
    throw new Error(`不是约定的 ${VOXEL_MAGIC} 体素文件。`);
  }

  const view = new DataView(buffer);
  const version = view.getUint16(4, true);
  if (version !== VOXEL_VERSION) {
    throw new Error(`暂不支持体素文件版本 ${version}，当前仅支持版本 ${VOXEL_VERSION}。`);
  }

  const scalarCode = view.getUint16(6, true);
  const scalarType = SCALAR_BY_CODE[scalarCode];
  if (!scalarType) {
    throw new Error(`未知数值类型代码：${scalarCode}。`);
  }

  const dimensions = [
    view.getUint32(8, true),
    view.getUint32(12, true),
    view.getUint32(16, true),
  ] as [number, number, number];
  if (dimensions.some((dimension) => dimension <= 0)) {
    throw new Error('文件头中的维度必须均为正数。');
  }

  const spacing = [
    view.getFloat32(20, true),
    view.getFloat32(24, true),
    view.getFloat32(28, true),
  ] as [number, number, number];
  if (spacing.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('体素物理间距必须为有限正数。');
  }

  const origin = [
    view.getFloat32(32, true),
    view.getFloat32(36, true),
    view.getFloat32(40, true),
  ] as [number, number, number];
  if (origin.some((value) => !Number.isFinite(value))) {
    throw new Error('体素原点必须为有限数值。');
  }

  const count = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(count)) {
    throw new Error('样例体积过大，首版仅支持小体积数据。');
  }

  const { values, data } = readScalars(buffer, scalarType, count);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return {
    metadata: { dimensions, spacing, origin, scalarType, count, min, max },
    data,
    fileName,
  };
}
