import { useEffect, useMemo, useRef } from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import type { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { vtkOpenGLRenderWindow } from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import type {
  Annotation,
  Axis,
  PhysicalPoint,
  RectangularROI,
  ToolMode,
  VoxelIndex,
  VoxelMetadata,
} from '../types';
import { axisLabel, distanceMm, formatMm, indexToPhysical, voxelOffset } from '../voxel/format';
import { normalizeRoiCorners } from '../lib/volumeAccess';

interface SliceViewProps {
  axis: Axis;
  imageData: vtkImageData;
  metadata: VoxelMetadata;
  slice: number;
  cursor: VoxelIndex;
  active: boolean;
  toolMode: ToolMode;
  annotations: Annotation[];
  roi: RectangularROI | null;
  values: ArrayLike<number>;
  onActivate: () => void;
  onCursorChange: (index: VoxelIndex, commit: boolean) => void;
  onSliceChange: (axis: Axis, slice: number) => void;
  onAddPoint: (index: VoxelIndex) => void;
  onAddDistance: (index: VoxelIndex) => void;
  onRoiChange: (roi: RectangularROI) => void;
}

type VtkImageData = vtkImageData;

interface AxisConfig {
  inPlane: [number, number];
  right: PhysicalPoint;
  viewUp: PhysicalPoint;
}

const AXES: Record<Axis, AxisConfig> = {
  0: {
    inPlane: [1, 2],
    right: [0, 1, 0],
    viewUp: [0, 0, 1],
  },
  1: {
    inPlane: [0, 2],
    right: [1, 0, 0],
    viewUp: [0, 0, 1],
  },
  2: {
    inPlane: [0, 1],
    right: [1, 0, 0],
    viewUp: [0, 1, 0],
  },
};

function asVector3(point: PhysicalPoint): [number, number, number] {
  return [point[0], point[1], point[2]];
}

function openGlWindow(grw: ReturnType<typeof vtkGenericRenderWindow.newInstance>): vtkOpenGLRenderWindow {
  return grw.getApiSpecificRenderWindow() as vtkOpenGLRenderWindow;
}

export function SliceView(props: SliceViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<{
    grw: ReturnType<typeof vtkGenericRenderWindow.newInstance>;
    mapper: ReturnType<typeof vtkImageMapper.newInstance>;
    imageData: VtkImageData;
  } | null>(null);
  const dragRef = useRef<{
    start: VoxelIndex;
    moved: boolean;
  } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const title = useMemo(() => axisLabel(props.axis), [props.axis]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const grw = vtkGenericRenderWindow.newInstance({ background: [0.02, 0.03, 0.05] });
    grw.setContainer(container);
    const renderer = grw.getRenderer();
    const renderWindow = grw.getRenderWindow();

    const mapper = vtkImageMapper.newInstance();
    mapper.setInputData(props.imageData);
    if (props.axis === 0) mapper.setISlice(props.slice);
    if (props.axis === 1) mapper.setJSlice(props.slice);
    if (props.axis === 2) mapper.setKSlice(props.slice);

    const actor = vtkImageSlice.newInstance();
    actor.setMapper(mapper);
    actor.getProperty().setInterpolationTypeToNearest();
    const windowWidth = Math.max(1, props.metadata.max - props.metadata.min);
    actor.getProperty().setColorWindow(windowWidth);
    actor.getProperty().setColorLevel((props.metadata.max + props.metadata.min) / 2);
    renderer.addActor(actor);
    renderer.setLayer(0);

    const center = props.imageData.getCenter() as PhysicalPoint;
    const normal: PhysicalPoint = [0, 0, 0];
    normal[props.axis] = 1;
    const position = center.map((value, index) =>
      index === props.axis ? value + Math.max(props.metadata.spacing[props.axis] * props.metadata.dimensions[props.axis], 10) : value,
    ) as PhysicalPoint;
    const camera = renderer.getActiveCamera();
    camera.setParallelProjection(true);
    camera.setPosition(...asVector3(position));
    camera.setFocalPoint(...asVector3(center));
    camera.setViewUp(...AXES[props.axis].viewUp);
    renderer.resetCamera();
    camera.setParallelProjection(true);

    const interactor = grw.getInteractor();
    const interactionStyle = vtkInteractorStyleImage.newInstance();
    interactionStyle.handleLeftButtonPress = () => {};
    interactionStyle.handleLeftButtonRelease = () => {};
    interactionStyle.handleStartMouseWheel = () => {};
    interactionStyle.handleEndMouseWheel = () => {};
    interactionStyle.handleMouseWheel = () => {};
    interactor.setInteractorStyle(interactionStyle);
    interactor.onMouseMove(() => renderOverlay());
    const resize = () => {
      grw.resize();
      renderOverlay();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    contextRef.current = { grw, mapper, imageData: props.imageData };
    renderWindow.render();
    requestAnimationFrame(renderOverlay);

    return () => {
      observer.disconnect();
      interactor.delete();
      renderer.removeActor(actor);
      actor.delete();
      mapper.delete();
      grw.delete();
      contextRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.imageData, props.axis]);

  useEffect(() => {
    const mapper = contextRef.current?.mapper;
    if (!mapper) return;
    if (props.axis === 0) mapper.setISlice(props.slice);
    if (props.axis === 1) mapper.setJSlice(props.slice);
    if (props.axis === 2) mapper.setKSlice(props.slice);
    contextRef.current?.grw.getRenderWindow().render();
    renderOverlay();
  }, [props.axis, props.slice]);

  useEffect(() => {
    renderOverlay();
  }, [props.cursor, props.annotations, props.roi, props.toolMode, props.active, props.values]);

  function pickIndex(displayX: number, displayY: number): VoxelIndex {
    const ctx = contextRef.current;
    if (!ctx) return propsRef.current.cursor;
    const renderer = ctx.grw.getRenderer();
    const world = openGlWindow(ctx.grw)
      .displayToWorld(displayX, displayY, 0, renderer) as PhysicalPoint;
    const fixedIndex = propsRef.current.slice;
    world[props.axis] =
      propsRef.current.metadata.origin[props.axis] + fixedIndex * propsRef.current.metadata.spacing[props.axis];
    const picked = world.map((coordinate, index) =>
      Math.round((coordinate - propsRef.current.metadata.origin[index]) / propsRef.current.metadata.spacing[index]),
    ) as VoxelIndex;
    return picked.map((value, index) =>
      Math.max(0, Math.min(propsRef.current.metadata.dimensions[index] - 1, value)),
    ) as VoxelIndex;
  }

  function eventDisplayPosition(event: React.PointerEvent<HTMLDivElement>) {
    const canvas = contextRef.current ? openGlWindow(contextRef.current.grw).getCanvas() : undefined;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (event.clientX - rect.left) * dpr,
      y: (rect.height - (event.clientY - rect.top)) * dpr,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    props.onActivate();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    const position = eventDisplayPosition(event);
    const index = pickIndex(position.x, position.y);
    dragRef.current = { start: index, moved: false };
    props.onCursorChange(index, true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const position = eventDisplayPosition(event);
    const index = pickIndex(position.x, position.y);
    props.onCursorChange(index, false);
    if (dragRef.current && props.toolMode === 'roi') {
      dragRef.current.moved = true;
      const roi = normalizeRoiCorners(
        props.axis,
        props.slice,
        dragRef.current.start,
        index,
        props.metadata,
      );
      props.onRoiChange(roi);
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const position = eventDisplayPosition(event);
    const index = pickIndex(position.x, position.y);
    dragRef.current = null;
    if (!drag) return;

    if (props.toolMode === 'point') {
      props.onAddPoint(index);
    } else if (props.toolMode === 'distance') {
      props.onAddDistance(index);
    } else if (props.toolMode === 'roi') {
      const roi = normalizeRoiCorners(props.axis, props.slice, drag.start, index, props.metadata);
      props.onRoiChange(roi);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!props.active) props.onActivate();
    const delta = event.deltaY > 0 ? 1 : -1;
    const next = Math.max(0, Math.min(props.metadata.dimensions[props.axis] - 1, props.slice + delta));
    props.onSliceChange(props.axis, next);
  }

  function worldToCanvas(point: PhysicalPoint) {
    const ctx = contextRef.current;
    const canvas = overlayRef.current;
    if (!ctx || !canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const display = openGlWindow(ctx.grw)
      .worldToDisplay(point[0], point[1], point[2], ctx.grw.getRenderer()) as [
        number,
        number,
        number,
      ];
    return { x: display[0] / dpr, y: rect.height - display[1] / dpr };
  }

  function renderOverlay() {
    const canvas = overlayRef.current;
    const container = containerRef.current;
    const ctx = contextRef.current;
    if (!canvas || !container || !ctx) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    const current = propsRef.current;
    const { cursor, annotations, roi } = current;

    if (roi) {
      if (roi.axis === current.axis && roi.slice === current.slice) {
        drawThresholdPreview(context, roi);
        drawRoi(context, roi);
      } else if (current.slice >= roi.min[current.axis] && current.slice <= roi.max[current.axis]) {
        drawRoiProjection(context, roi);
      }
    }
    drawAnnotations(context, annotations);
    drawCrosshair(context, cursor);
  }

  function drawCrosshair(context: CanvasRenderingContext2D, cursor: VoxelIndex) {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const p = indexToPhysical(cursor, props.metadata);
    const center = worldToCanvas(p);
    context.save();
    context.strokeStyle = '#ffdd55';
    context.lineWidth = 1;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(0, center.y);
    context.lineTo(canvas.clientWidth, center.y);
    context.moveTo(center.x, 0);
    context.lineTo(center.x, canvas.clientHeight);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#ffdd55';
    context.beginPath();
    context.arc(center.x, center.y, 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawAnnotations(context: CanvasRenderingContext2D, annotations: Annotation[]) {
    const visiblePoints = annotations.filter((annotation) => {
      if (annotation.kind === 'point') return annotation.index[props.axis] === props.slice;
      return true;
    });

    for (const annotation of visiblePoints) {
      if (annotation.kind === 'point') {
        const point = worldToCanvas(indexToPhysical(annotation.index, props.metadata));
        context.save();
        context.fillStyle = '#61e8ff';
        context.beginPath();
        context.arc(point.x, point.y, 4, 0, Math.PI * 2);
        context.fill();
        context.font = '12px sans-serif';
        context.fillStyle = '#dff9ff';
        context.fillText(annotation.label, point.x + 7, point.y - 7);
        context.restore();
      } else {
        const startIndex = [...annotation.start] as VoxelIndex;
        const endIndex = [...annotation.end] as VoxelIndex;
        startIndex[props.axis] = props.slice;
        endIndex[props.axis] = props.slice;
        const start = worldToCanvas(indexToPhysical(startIndex, props.metadata));
        const end = worldToCanvas(indexToPhysical(endIndex, props.metadata));
        const onSlice =
          annotation.start[props.axis] === props.slice && annotation.end[props.axis] === props.slice;
        context.save();
        context.strokeStyle = onSlice ? '#ff7ac8' : 'rgba(255, 122, 200, 0.45)';
        context.lineWidth = onSlice ? 2 : 1;
        context.setLineDash(onSlice ? [] : [5, 4]);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        for (const point of [start, end]) {
          context.fillStyle = '#ff7ac8';
          context.beginPath();
          context.arc(point.x, point.y, 4, 0, Math.PI * 2);
          context.fill();
        }
        const length = distanceMm(annotation.start, annotation.end, props.metadata.spacing);
        const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        context.font = '12px sans-serif';
        context.fillStyle = '#ffe5f3';
        context.fillText(`${annotation.label}: ${formatMm(length)}`, midpoint.x + 6, midpoint.y - 6);
        context.restore();
      }
    }
  }

  function drawThresholdPreview(context: CanvasRenderingContext2D, roi: RectangularROI) {
    const [uAxis, vAxis] = AXES[props.axis].inPlane;
    const index: VoxelIndex = [0, 0, 0];
    index[props.axis] = roi.slice;
    context.save();
    context.fillStyle = 'rgba(255, 190, 60, 0.48)';
    for (let v = roi.min[vAxis]; v <= roi.max[vAxis]; v += 1) {
      index[vAxis] = v;
      for (let u = roi.min[uAxis]; u <= roi.max[uAxis]; u += 1) {
        index[uAxis] = u;
        const value = props.values[voxelOffset(index, props.metadata.dimensions)];
        if (value < roi.thresholdLow || value > roi.thresholdHigh) continue;

        const low: PhysicalPoint = indexToPhysical(index, props.metadata);
        const high: PhysicalPoint = indexToPhysical(index, props.metadata);
        low[uAxis] -= props.metadata.spacing[uAxis] / 2;
        low[vAxis] -= props.metadata.spacing[vAxis] / 2;
        high[uAxis] += props.metadata.spacing[uAxis] / 2;
        high[vAxis] += props.metadata.spacing[vAxis] / 2;
        const a = worldToCanvas(low);
        const b = worldToCanvas(high);
        context.fillRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y),
        );
      }
    }
    context.restore();
  }

  function drawRoiProjection(context: CanvasRenderingContext2D, roi: RectangularROI) {
    const [uAxis, vAxis] = AXES[props.axis].inPlane;
    if (roi.axis !== uAxis && roi.axis !== vAxis) return;
    const extentAxis = roi.axis === uAxis ? vAxis : uAxis;
    const minIndex = [...roi.min] as VoxelIndex;
    const maxIndex = [...roi.max] as VoxelIndex;
    minIndex[props.axis] = props.slice;
    maxIndex[props.axis] = props.slice;
    minIndex[extentAxis] = roi.min[extentAxis];
    maxIndex[extentAxis] = roi.max[extentAxis];
    const minPoint = indexToPhysical(minIndex, props.metadata);
    const maxPoint = indexToPhysical(maxIndex, props.metadata);
    minPoint[extentAxis] -= props.metadata.spacing[extentAxis] / 2;
    maxPoint[extentAxis] += props.metadata.spacing[extentAxis] / 2;
    const a = worldToCanvas(minPoint);
    const b = worldToCanvas(maxPoint);

    context.save();
    context.strokeStyle = 'rgba(90, 210, 255, 0.65)';
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
  }

  function drawRoi(context: CanvasRenderingContext2D, roi: RectangularROI) {
    const [uAxis, vAxis] = AXES[props.axis].inPlane;
    const minIndex = [...roi.min] as VoxelIndex;
    const maxIndex = [...roi.max] as VoxelIndex;
    const minCorner: PhysicalPoint = indexToPhysical(minIndex, props.metadata);
    const maxCorner: PhysicalPoint = indexToPhysical(maxIndex, props.metadata);
    // Rectangle bounds enclose the selected voxel cells.
    minCorner[uAxis] -= props.metadata.spacing[uAxis] / 2;
    minCorner[vAxis] -= props.metadata.spacing[vAxis] / 2;
    maxCorner[uAxis] += props.metadata.spacing[uAxis] / 2;
    maxCorner[vAxis] += props.metadata.spacing[vAxis] / 2;
    const a = worldToCanvas(minCorner);
    const b = worldToCanvas(maxCorner);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);

    context.save();
    context.fillStyle = 'rgba(90, 210, 255, 0.16)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = '#5ad2ff';
    context.lineWidth = 1.5;
    context.strokeRect(x, y, width, height);
    context.restore();
  }

  return (
    <section className={`slice-view ${props.active ? 'active' : ''}`}>
      <header>
        <strong>{title}</strong>
        <span>
          切片 {props.slice + 1}/{props.metadata.dimensions[props.axis]} · 物理位置{' '}
          {(props.slice * props.metadata.spacing[props.axis]).toFixed(2)} mm
        </span>
      </header>
      <div
        ref={containerRef}
        className="vtk-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <canvas ref={overlayRef} className="overlay" />
      </div>
    </section>
  );
}
