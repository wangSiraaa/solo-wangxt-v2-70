export type Axis = 0 | 1 | 2;

export type ScalarEncoding =
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'float32';

export interface VoxelMetadata {
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  scalarType: ScalarEncoding;
  count: number;
  min: number;
  max: number;
}

export interface DecodedVolume {
  metadata: VoxelMetadata;
  data: ArrayBuffer;
  fileName: string;
}

export type VoxelIndex = [number, number, number];
export type PhysicalPoint = [number, number, number];

export interface PointAnnotation {
  id: string;
  kind: 'point';
  index: VoxelIndex;
  label: string;
  createdAt: number;
}

export interface DistanceAnnotation {
  id: string;
  kind: 'distance';
  start: VoxelIndex;
  end: VoxelIndex;
  label: string;
  createdAt: number;
}

export type Annotation = PointAnnotation | DistanceAnnotation;

export interface RectangularROI {
  id: string;
  axis: Axis;
  slice: number;
  /** Inclusive lower voxel indices. */
  min: VoxelIndex;
  /** Inclusive upper voxel indices. */
  max: VoxelIndex;
  thresholdLow: number;
  thresholdHigh: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectState {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  cursor: VoxelIndex;
  activeAxis: Axis;
  slices: [number, number, number];
  annotations: Annotation[];
  roi: RectangularROI | null;
}

export interface StoredProject {
  project: ProjectState;
  metadata: VoxelMetadata;
  volume: ArrayBuffer;
}

export type ToolMode = 'navigate' | 'point' | 'distance' | 'roi';
