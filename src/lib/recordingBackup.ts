// 녹음 중 오디오 청크를 IndexedDB에 실시간 백업 — 브라우저 메모리(ref)에만 있던 걸 보완.
// 목적: 새로고침/탭 닫힘/컴포넌트 unmount로 녹음이 날아가는 사고 방지(2026-08 치명 버그 대응).
// 전사 성공 또는 사용자가 명시적으로 버리면 즉시 삭제 — 영구 저장소가 아니라 "위기용 임시 사본".
//
// 라이브러리 없이 네이티브 IndexedDB만 사용(ponytail: 이 정도 스키마엔 idb 래퍼가 과함).

const DB_NAME = 'recording-backup';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks'; // key: `${sessionId}:${seq}` — value: { sessionId, seq, blob, mimeType, ts }
const SESSIONS_STORE = 'sessions'; // key: sessionId — value: { sessionId, mimeType, startedAt }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 실패해도 라이브 녹음 자체를 막으면 안 되므로, 호출부는 항상 fire-and-forget으로 쓰고
// 에러는 콘솔 경고만 남긴다(백업은 안전망이지 필수 경로가 아님).
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export function startSession(sessionId: string, mimeType: string): void {
  withStore(SESSIONS_STORE, 'readwrite', (store) =>
    store.put({ sessionId, mimeType, startedAt: Date.now() })
  ).catch((e) => console.warn('[recordingBackup] 세션 시작 기록 실패:', e));
}

export function saveChunk(sessionId: string, seq: number, blob: Blob): void {
  withStore(CHUNKS_STORE, 'readwrite', (store) =>
    store.put({ key: `${sessionId}:${seq}`, sessionId, seq, blob, ts: Date.now() })
  ).catch((e) => console.warn('[recordingBackup] 청크 백업 실패:', e));
}

export interface RecoveredSession {
  sessionId: string;
  mimeType: string;
  startedAt: number;
  blob: Blob;
}

// 복구 대상 세션 목록(현재 진행 중인 세션은 호출부에서 제외하고 넘길 것).
export async function listSessions(): Promise<{ sessionId: string; mimeType: string; startedAt: number }[]> {
  try {
    const all = await withStore<{ sessionId: string; mimeType: string; startedAt: number }[]>(
      SESSIONS_STORE,
      'readonly',
      (store) => store.getAll()
    );
    return all;
  } catch (e) {
    console.warn('[recordingBackup] 세션 목록 조회 실패:', e);
    return [];
  }
}

// 세션의 청크들을 순서대로 이어붙여 하나의 Blob으로 복원.
export async function recoverSession(sessionId: string): Promise<RecoveredSession | null> {
  try {
    const [sessionMeta, chunks] = await Promise.all([
      withStore<{ sessionId: string; mimeType: string; startedAt: number } | undefined>(
        SESSIONS_STORE,
        'readonly',
        (store) => store.get(sessionId)
      ),
      withStore<{ seq: number; blob: Blob }[]>(CHUNKS_STORE, 'readonly', (store) => store.getAll()),
    ]);
    if (!sessionMeta) return null;
    const ownChunks = chunks
      .filter((c) => (c as unknown as { sessionId: string }).sessionId === sessionId)
      .sort((a, b) => a.seq - b.seq);
    if (ownChunks.length === 0) return null;
    const blob = new Blob(ownChunks.map((c) => c.blob), { type: sessionMeta.mimeType });
    return { ...sessionMeta, blob };
  } catch (e) {
    console.warn('[recordingBackup] 세션 복구 실패:', e);
    return null;
  }
}

// 전사 성공 또는 사용자가 명시적으로 버릴 때 호출 — 청크+세션 메타 정리.
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const chunks = await withStore<{ key: string; sessionId: string }[]>(CHUNKS_STORE, 'readonly', (store) =>
      store.getAll()
    );
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS_STORE, SESSIONS_STORE], 'readwrite');
      const chunkStore = tx.objectStore(CHUNKS_STORE);
      chunks.filter((c) => c.sessionId === sessionId).forEach((c) => chunkStore.delete(c.key));
      tx.objectStore(SESSIONS_STORE).delete(sessionId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[recordingBackup] 세션 삭제 실패(다음 정리 때 재시도됨):', e);
  }
}
