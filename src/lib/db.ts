import type { ProjectState, StoredProject, VoxelMetadata } from '../types';

const DB_NAME = 'core-ct-browser';
const DB_VERSION = 1;
const STORE = 'projects';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'project.id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB。'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败。'));
  });
}

export async function saveStoredProject(stored: StoredProject): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    await requestToPromise(transaction.objectStore(STORE).put(stored));
  } finally {
    database.close();
  }
}

export async function updateProjectState(project: ProjectState): Promise<void> {
  const database = await openDatabase();
  try {
    const store = database.transaction(STORE, 'readwrite').objectStore(STORE);
    const stored = await requestToPromise(store.get(project.id) as IDBRequest<StoredProject | undefined>);
    if (!stored) throw new Error('工程不存在，无法保存。');
    stored.project = project;
    await requestToPromise(store.put(stored));
  } finally {
    database.close();
  }
}

export async function listProjects(): Promise<
  Array<{ project: ProjectState; metadata: VoxelMetadata }>
> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readonly');
    const all = await requestToPromise(
      transaction.objectStore(STORE).getAll() as IDBRequest<StoredProject[]>,
    );
    return all
      .map(({ project, metadata }) => ({ project, metadata }))
      .sort((a, b) => b.project.updatedAt - a.project.updatedAt);
  } finally {
    database.close();
  }
}

export async function loadProject(id: string): Promise<StoredProject | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readonly');
    return requestToPromise(transaction.objectStore(STORE).get(id) as IDBRequest<StoredProject | undefined>);
  } finally {
    database.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    await requestToPromise(transaction.objectStore(STORE).delete(id));
  } finally {
    database.close();
  }
}
