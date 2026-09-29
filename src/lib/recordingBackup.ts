// 녹음 중 오디오 청크를 IndexedDB에 실시간 백업 — 브라우저 메모리(ref)에만 있던 걸 보완.
// 목적: 새로고침/탭 닫힘/컴포넌트 unmount로 녹음이 날아가는 사고 방지(2026-08 치명 버그 대응).
// 전사 성공 또는 사용자가 명시적으로 버리면 즉시 삭제 — 영구 저장소가 아니라 "위기용 임시 사본".
//
// 파트(part): "이어서 녹음"/복구 후 재개마다 MediaRecorder가 새로 만들어져 webm 헤더가 다시 나온다.
// 한 Blob으로 이어붙이면 디코더/STT가 뒷부분을 버리므로 파트별로 따로 보관·전사한다.
// (예전엔 seq만 있어 복구 후 이어서 녹음하면 seq 1부터 기존 청크를 덮어써 백업이 오염됐음.)
//
// 라이브러리 없이 네이티브 IndexedDB만 사용(ponytail: 이 정도 스키마엔 idb 래퍼가 과함).

const DB_NAME = 'recording-backup';
const DB_VERSION = 2; // v2: chunks.sessionId 인덱스(세션 단위 조회 — 장시간 녹음에서 전체 getAll 금지)
const CHUNKS_STORE = 'chunks'; // key: `${sessionId}:${part}:${seq}` — value: { sessionId, part, seq, blob, ts }
const SESSIONS_STORE = 'sessions'; // key: sessionId — value: { sessionId, mimeType, startedAt }
const SESSION_INDEX = 'sessionId';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      const chunks = db.objectStoreNames.contains(CHUNKS_STORE)
        ? tx.objectStore(CHUNKS_STORE)
        : db.createObjectStore(CHUNKS_STORE, { keyPath: 'key' });
      if (!chunks.indexNames.contains(SESSION_INDEX)) chunks.createIndex(SESSION_INDEX, 'sessionId');
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
  // 영구 저장 요청: 승인되면 저장공간 부족 시 브라우저가 이 DB를 임의로 지우지 않는다. 거부돼도 동작엔 영향 없음.
  navigator.storage?.persist?.().catch(() => {});
  withStore(SESSIONS_STORE, 'readwrite', (store) =>
    store.put({ sessionId, mimeType, startedAt: Date.now() })
  ).catch((e) => console.warn('[recordingBackup] 세션 시작 기록 실패:', e));
}

export function saveChunk(sessionId: string, part: number, seq: number, blob: Blob): void {
  withStore(CHUNKS_STORE, 'readwrite', (store) =>
    store.put({ key: `${sessionId}:${part}:${seq}`, sessionId, part, seq, blob, ts: Date.now() })
  ).catch((e) => console.warn('[recordingBackup] 청크 백업 실패:', e));
}

export interface ChunkRecord {
  part?: number; // v1 레코드엔 없음 → 0으로 취급
  seq: number;
  blob: Blob;
}

// 청크를 파트별로 묶어 순서대로 반환(순수 함수 — 테스트 대상).
export function groupIntoParts(records: ChunkRecord[]): Blob[][] {
  const byPart = new Map<number, ChunkRecord[]>();
  for (const r of records) {
    const p = r.part ?? 0;
    if (!byPart.has(p)) byPart.set(p, []);
    byPart.get(p)!.push(r);
  }
  return [...byPart.keys()]
    .sort((a, b) => a - b)
    .map((p) => byPart.get(p)!.sort((a, b) => a.seq - b.seq).map((r) => r.blob));
}

export interface RecoveredSession {
  sessionId: string;
  mimeType: string;
  startedAt: number;
  parts: Blob[]; // 파트별 Blob(각각 완전한 webm). 전사는 이 단위로.
  blob: Blob; // 전체 이어붙임(재생용 — 첫 파트만 재생될 수 있음).
}

// 복구 대상 세션 목록(현재 진행 중인 세션은 호출부에서 제외하고 넘길 것).
export async function listSessions(): Promise<{ sessionId: string; mimeType: string; startedAt: number }[]> {
  try {
    return await withStore<{ sessionId: string; mimeType: string; startedAt: number }[]>(
      SESSIONS_STORE,
      'readonly',
      (store) => store.getAll()
    );
  } catch (e) {
    console.warn('[recordingBackup] 세션 목록 조회 실패:', e);
    return [];
  }
}

// 세션의 청크들을 파트별로 이어붙여 복원.
export async function recoverSession(sessionId: string): Promise<RecoveredSession | null> {
  try {
    const [sessionMeta, chunks] = await Promise.all([
      withStore<{ sessionId: string; mimeType: string; startedAt: number } | undefined>(
        SESSIONS_STORE,
        'readonly',
        (store) => store.get(sessionId)
      ),
      withStore<ChunkRecord[]>(CHUNKS_STORE, 'readonly', (store) => store.index(SESSION_INDEX).getAll(sessionId)),
    ]);
    if (!sessionMeta) return null;
    const groups = groupIntoParts(chunks);
    if (groups.length === 0) return null;
    const parts = groups.map((g) => new Blob(g, { type: sessionMeta.mimeType }));
    return { ...sessionMeta, parts, blob: new Blob(parts, { type: sessionMeta.mimeType }) };
  } catch (e) {
    console.warn('[recordingBackup] 세션 복구 실패:', e);
    return null;
  }
}

// 전사 성공 또는 사용자가 명시적으로 버릴 때 호출 — 청크+세션 메타 정리.
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const keys = await withStore<IDBValidKey[]>(CHUNKS_STORE, 'readonly', (store) =>
      store.index(SESSION_INDEX).getAllKeys(sessionId)
    );
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS_STORE, SESSIONS_STORE], 'readwrite');
      const chunkStore = tx.objectStore(CHUNKS_STORE);
      keys.forEach((k) => chunkStore.delete(k));
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
