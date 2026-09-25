import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Annotation,
  Axis,
  DecodedVolume,
  ProjectState,
  RectangularROI,
  StoredProject,
  ToolMode,
  VoxelIndex,
} from './types';
import {
  axisLabel,
  clampIndex,
  createId,
  distanceMm,
  formatMm,
  indexToPhysical,
} from './voxel/format';
import { createScalarView, getRoiStats } from './lib/volumeAccess';
import { createVtkImage } from './lib/vtkVolume';
import {
  deleteProject,
  listProjects,
  loadProject,
  saveStoredProject,
  updateProjectState,
} from './lib/db';
import { createInitialProject } from './lib/project';
import { useDecoderWorker } from './hooks/useDecoderWorker';
import { SliceView } from './components/SliceView';

interface ProjectListItem {
  project: ProjectState;
  metadata: DecodedVolume['metadata'];
}

interface LoadedWorkspace {
  volume: DecodedVolume;
  project: ProjectState;
}

const TOOLS: Array<{ mode: ToolMode; label: string; hint: string }> = [
  { mode: 'navigate', label: '导航 / 同步坐标', hint: '移动鼠标同步十字，点击提交三个切面的切片位置。' },
  { mode: 'point', label: '点标注', hint: '在任一切面点击，记录一个三维体素坐标。' },
  { mode: 'distance', label: '距离', hint: '连续点击两次，使用各轴物理间距计算三维距离。' },
  { mode: 'roi', label: '矩形 ROI', hint: '拖拽一个矩形，查看体素数量并预览阈值范围。' },
];

export default function App() {
  const decoder = useDecoderWorker();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [workspace, setWorkspace] = useState<LoadedWorkspace | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('navigate');
  const [message, setMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const distanceStart = useRef<VoxelIndex | null>(null);
  const saveTimer = useRef<number | null>(null);

  const refreshProjectList = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => {
    refreshProjectList().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [refreshProjectList]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
  }, []);

  const persistProject = useCallback((project: ProjectState) => {
    if (!workspace) return;
    setSaveState('saving');
    updateProjectState(project)
      .then(() => {
        setSaveState('saved');
        refreshProjectList();
      })
      .catch((error) => {
        setSaveState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, [refreshProjectList, workspace]);

  const schedulePersist = useCallback((project: ProjectState) => {
    setSaveState('saving');
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persistProject(project), 350);
  }, [persistProject]);

  const updateProject = useCallback((updater: (current: ProjectState) => ProjectState, immediate = false) => {
    setWorkspace((current) => {
      if (!current) return current;
      const nextProject = { ...updater(current.project), updatedAt: Date.now() };
      if (immediate) persistProject(nextProject);
      else schedulePersist(nextProject);
      return { ...current, project: nextProject };
    });
  }, [persistProject, schedulePersist]);

  const openVolume = useCallback(async (volume: DecodedVolume) => {
    distanceStart.current = null;
    const project = createInitialProject(volume);
    const stored: StoredProject = { project, metadata: volume.metadata, volume: volume.data };
    await saveStoredProject(stored);
    setWorkspace({ volume, project });
    setToolMode('navigate');
    await refreshProjectList();
  }, [refreshProjectList]);

  const handleSample = async () => {
    try {
      setMessage(null);
      await openVolume(await decoder.loadSample());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setMessage(null);
      await openVolume(await decoder.decodeFile(file));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenStored = async (id: string) => {
    try {
      const stored = await loadProject(id);
      if (!stored) throw new Error('没有找到该工程。');
      setWorkspace({
        volume: {
          metadata: stored.metadata,
          data: stored.volume,
          fileName: `${stored.project.name}.vvol`,
        },
        project: stored.project,
      });
      distanceStart.current = null;
      setToolMode('navigate');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!window.confirm('删除该工程、体素数据和全部标注？此操作不可撤销。')) return;
    await deleteProject(id);
    if (workspace?.project.id === id) setWorkspace(null);
    await refreshProjectList();
  };

  const imageData = useMemo(
    () => (workspace ? createVtkImage(workspace.volume) : null),
    [workspace?.volume],
  );
  const values = useMemo(
    () => (workspace ? createScalarView(workspace.volume.data, workspace.volume.metadata.scalarType) : null),
    [workspace?.volume],
  );

  const handleCursorChange = useCallback((index: VoxelIndex, commit: boolean) => {
    updateProject((project) => {
      const cursor = clampIndex(index, workspace!.volume.metadata.dimensions);
      return {
        ...project,
        cursor,
        slices: commit ? ([...cursor] as [number, number, number]) : project.slices,
      };
    });
  }, [updateProject, workspace]);

  const handleSliceChange = useCallback((axis: Axis, slice: number) => {
    updateProject((project) => {
      const cursor = [...project.cursor] as VoxelIndex;
      const slices = [...project.slices] as [number, number, number];
      cursor[axis] = slice;
      slices[axis] = slice;
      return { ...project, cursor, slices };
    });
  }, [updateProject]);

  const handleActivate = useCallback((axis: Axis) => {
    updateProject((project) => ({ ...project, activeAxis: axis }));
  }, [updateProject]);

  const handleAddPoint = useCallback((index: VoxelIndex) => {
    updateProject((project) => {
      const number = project.annotations.filter((item) => item.kind === 'point').length + 1;
      const annotation: Annotation = {
        id: createId('point'),
        kind: 'point',
        index,
        label: `点 ${number}`,
        createdAt: Date.now(),
      };
      return { ...project, annotations: [...project.annotations, annotation] };
    }, true);
  }, [updateProject]);

  const handleAddDistance = useCallback((index: VoxelIndex) => {
    if (!distanceStart.current) {
      distanceStart.current = index;
      setMessage('已记录距离测量起点，请点击终点。');
      return;
    }
    const start = distanceStart.current;
    distanceStart.current = null;
    setMessage(null);
    updateProject((project) => {
      const number = project.annotations.filter((item) => item.kind === 'distance').length + 1;
      const annotation: Annotation = {
        id: createId('distance'),
        kind: 'distance',
        start,
        end: index,
        label: `距离 ${number}`,
        createdAt: Date.now(),
      };
      return { ...project, annotations: [...project.annotations, annotation] };
    }, true);
  }, [updateProject]);

  const handleRoiChange = useCallback((roi: RectangularROI) => {
    updateProject((project) => ({ ...project, roi }));
  }, [updateProject]);

  const updateRoiThreshold = (low: number, high: number) => {
    updateProject((project) => project.roi
      ? {
        ...project,
        roi: {
          ...project.roi,
          thresholdLow: Math.min(low, high),
          thresholdHigh: Math.max(low, high),
          updatedAt: Date.now(),
        },
      }
      : project);
  };

  const removeAnnotation = (id: string) => {
    updateProject((project) => ({
      ...project,
      annotations: project.annotations.filter((annotation) => annotation.id !== id),
    }), true);
  };

  if (!workspace || !imageData || !values) {
    return <Landing
      projects={projects}
      busy={decoder.busy}
      error={decoder.error ?? message}
      onSample={handleSample}
      onFile={handleFile}
      onOpen={handleOpenStored}
      onDelete={handleDeleteProject}
    />;
  }

  const { project, volume } = workspace;
  const { metadata } = volume;
  const roiStats = project.roi ? getRoiStats(project.roi, metadata, values) : null;
  const physicalCursor = indexToPhysical(project.cursor, metadata);
  const value = values[project.cursor[0] + metadata.dimensions[0] * (project.cursor[1] + metadata.dimensions[1] * project.cursor[2])];

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div>
          <h1>岩芯 CT 浏览器</h1>
          <p className="privacy">本地解码 · 不网络上传 · IndexedDB 自动保存</p>
          {message && <div className="inline-message">{message}</div>}
        </div>

        <section className="panel">
          <h2>{project.name}</h2>
          <dl className="metadata-grid">
            <dt>维度 I×J×K</dt>
            <dd>{metadata.dimensions.join(' × ')}</dd>
            <dt>物理间距</dt>
            <dd>{metadata.spacing.map((item) => `${item} mm`).join(' × ')}</dd>
            <dt>数值类型</dt>
            <dd>{metadata.scalarType}</dd>
            <dt>数值范围</dt>
            <dd>{metadata.min} – {metadata.max}</dd>
          </dl>
          <div className="save-state">保存状态：{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : '空闲'}</div>
        </section>

        <section className="panel">
          <h2>工具</h2>
          <div className="tool-list">
            {TOOLS.map((tool) => (
              <button
                key={tool.mode}
                className={toolMode === tool.mode ? 'selected' : ''}
                onClick={() => {
                  setToolMode(tool.mode);
                  distanceStart.current = null;
                }}
              >
                {tool.label}
              </button>
            ))}
          </div>
          <p className="hint">{TOOLS.find((tool) => tool.mode === toolMode)?.hint}</p>
        </section>

        <section className="panel">
          <h2>当前坐标</h2>
          <div className="coordinate">IJK: ({project.cursor.join(', ')})</div>
          <div className="coordinate">物理: ({physicalCursor.map((item) => item.toFixed(3)).join(', ')}) mm</div>
          <div className="coordinate">值: {value}</div>
        </section>

        {project.roi && roiStats && (
          <section className="panel">
            <h2>矩形 ROI</h2>
            <RoiPanel
              roi={project.roi}
              stats={roiStats}
              min={metadata.min}
              max={metadata.max}
              onThreshold={updateRoiThreshold}
            />
          </section>
        )}

        <section className="panel annotation-panel">
          <h2>标注 ({project.annotations.length})</h2>
          {project.annotations.length === 0 && <p className="hint">尚无标注。</p>}
          {project.annotations.map((annotation) => (
            <AnnotationRow
              key={annotation.id}
              annotation={annotation}
              spacing={metadata.spacing}
              onRemove={removeAnnotation}
            />
          ))}
        </section>

        <button className="secondary" onClick={() => setWorkspace(null)}>返回工程列表</button>
      </aside>

      <section className="views">
        {([0, 1, 2] as Axis[]).map((axis) => (
          <SliceView
            key={axis}
            axis={axis}
            imageData={imageData}
            metadata={metadata}
            slice={project.slices[axis]}
            cursor={project.cursor}
            active={project.activeAxis === axis}
            toolMode={toolMode}
            annotations={project.annotations}
            roi={project.roi}
            values={values}
            onActivate={() => handleActivate(axis)}
            onCursorChange={handleCursorChange}
            onSliceChange={handleSliceChange}
            onAddPoint={handleAddPoint}
            onAddDistance={handleAddDistance}
            onRoiChange={handleRoiChange}
          />
        ))}
      </section>
    </main>
  );
}

function RoiPanel(props: {
  roi: RectangularROI;
  stats: ReturnType<typeof getRoiStats>;
  min: number;
  max: number;
  onThreshold: (low: number, high: number) => void;
}) {
  const { roi, stats, min, max } = props;
  return (
    <div className="roi-panel">
      <div>切面：{axisLabel(roi.axis)} #{roi.slice + 1}</div>
      <div>范围：IJK {roi.min.join(', ')} → {roi.max.join(', ')}</div>
      <div>尺寸：{stats.width} × {stats.height} 体素</div>
      <div>体素数量：<strong>{stats.count}</strong></div>
      <div>面积：{stats.areaMm2.toFixed(3)} mm²</div>
      <div>均值 / 最小 / 最大：{stats.mean.toFixed(2)} / {stats.min} / {stats.max}</div>
      <label>
        低阈值
        <input
          type="number"
          value={roi.thresholdLow}
          min={min}
          max={max}
          onChange={(event) => props.onThreshold(Number(event.target.value), roi.thresholdHigh)}
        />
      </label>
      <label>
        高阈值
        <input
          type="number"
          value={roi.thresholdHigh}
          min={min}
          max={max}
          onChange={(event) => props.onThreshold(roi.thresholdLow, Number(event.target.value))}
        />
      </label>
      <div>阈值内：<strong>{stats.thresholdCount}</strong> / {stats.count} ({(stats.fraction * 100).toFixed(1)}%)</div>
    </div>
  );
}

function AnnotationRow(props: {
  annotation: Annotation;
  spacing: VoxelIndex;
  onRemove: (id: string) => void;
}) {
  const { annotation } = props;
  return (
    <div className="annotation-row">
      <div>
        <strong>{annotation.label}</strong>
        {annotation.kind === 'point' ? (
          <div>IJK ({annotation.index.join(', ')})</div>
        ) : (
          <>
            <div>({annotation.start.join(', ')}) → ({annotation.end.join(', ')})</div>
            <div>{formatMm(distanceMm(annotation.start, annotation.end, props.spacing))}</div>
          </>
        )}
      </div>
      <button onClick={() => props.onRemove(annotation.id)}>删除</button>
    </div>
  );
}

function Landing(props: {
  projects: ProjectListItem[];
  busy: boolean;
  error: string | null;
  onSample: () => void;
  onFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <main className="landing">
      <section className="hero">
        <h1>岩芯 CT 纯浏览器查看器</h1>
        <p>
          React + TypeScript + vtk.js。体素文件由 Web Worker 在本机解码，工程、体数据、选区和标注均保存到 IndexedDB。
        </p>
        {props.error && <div className="error">{props.error}</div>}
        <div className="actions">
          <button onClick={props.onSample} disabled={props.busy}>{props.busy ? 'Worker 处理中…' : '载入随项目合成各向异性样例'}</button>
          <label className="file-button">
            打开 .vvol 小体积文件
            <input type="file" accept=".vvol" onChange={props.onFile} disabled={props.busy} />
          </label>
        </div>
      </section>

      <section className="format panel">
        <h2>首版 VVOX v1 格式（小端，64 字节文件头）</h2>
        <pre>{`offset  field
0       "VVOX"
4       uint16 version = 1
6       uint16 scalarType: 1 uint8, 2 int16, 3 uint16, 4 float32
8       uint32 dimX
12      uint32 dimY
16      uint32 dimZ
20      float32 spacingX mm
24      float32 spacingY mm
28      float32 spacingZ mm
32      float32 originX
36      float32 originY
40      float32 originZ
44..63  保留，写 0
64..    Fortran-order voxel data: index = i + dimX*(j + dimY*k)`}</pre>
      </section>

      <section className="project-list panel">
        <h2>本机工程</h2>
        {props.projects.length === 0 && <p className="hint">暂无工程。载入样例后刷新页面可验证持久化。</p>}
        {props.projects.map(({ project, metadata }) => (
          <div key={project.id} className="project-row">
            <div>
              <strong>{project.name}</strong>
              <div>{metadata.dimensions.join('×')} · 间距 {metadata.spacing.join(' / ')} mm</div>
              <div>{new Date(project.updatedAt).toLocaleString()} · {project.annotations.length} 标注{project.roi ? ' · ROI' : ''}</div>
            </div>
            <button onClick={() => props.onOpen(project.id)}>打开</button>
            <button className="danger" onClick={() => props.onDelete(project.id)}>删除</button>
          </div>
        ))}
      </section>
    </main>
  );
}
