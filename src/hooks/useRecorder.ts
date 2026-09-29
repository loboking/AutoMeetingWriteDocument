import { useState, useRef, useCallback, useEffect } from 'react';
import { useObjectUrl } from './useObjectUrl';
import * as recordingBackup from '@/lib/recordingBackup';

export interface RecoverableSession {
  sessionId: string;
  mimeType: string;
  startedAt: number;
}

interface UseRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioUrl: string | null;
  // 마이크 끊김/녹음기 오류로 캡처가 강제 중단됐을 때의 안내문. continueRecording/reset 시 해제.
  captureInterrupted: string | null;
  startRecording: () => Promise<void>;
  // 녹음이 끊긴 뒤(에러/모바일 백그라운드/복구된 세션) 처음부터 다시 하지 않고 이어서 캡처.
  // 기존 파트·세션ID·경과시간을 그대로 유지한 채 새 파트로 마이크를 붙인다.
  continueRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  // 재생용 전체 Blob(파트 이어붙임 — 2파트 이상이면 첫 파트만 재생될 수 있음).
  getAudioBlob: () => Blob | null;
  // 전사용. 파트마다 완전한 webm이므로 파트별로 전사해 텍스트를 이어야 뒷부분이 안 잘린다.
  getAudioParts: () => Blob[];
  reset: () => void;
  // 전사 성공 등으로 백업이 더 이상 필요 없을 때 호출 — IndexedDB 임시 사본 정리.
  // reset()과 분리한 이유: 실패 후 "다시 시도"는 백업을 지우면 안 되고, 성공/명시적 폐기 때만 지워야 함.
  clearBackup: () => void;
  // 새로고침/크래시로 남은 세션 목록(현재 세션 제외) — 복구 배너용.
  listRecoverableSessions: () => Promise<RecoverableSession[]>;
  // 복구 세션을 현재 훅 상태로 불러온다. 이후 이어서 녹음하거나 바로 전사 가능.
  recoverSession: (sessionId: string) => Promise<boolean>;
  discardRecoverableSession: (sessionId: string) => void;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [captureInterrupted, setCaptureInterrupted] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // 현재 파트의 청크. 이어서 녹음하면 Blob으로 봉인해 completedPartsRef로 옮긴다.
  const audioChunksRef = useRef<Blob[]>([]);
  const completedPartsRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // 실제 인코딩 포맷. Safari 등 opus 미지원 브라우저는 기본값(보통 mp4)으로 폴백되는데,
  // 예전엔 Blob type을 'audio/webm'으로 하드코딩해서 실제론 mp4인데 webm이라 속여 보내던
  // 버그가 있었음(2026-08 확인) — Gemini가 mp4 컨테이너 자체를 처리 못 해 전사 실패로 이어짐.
  const mimeTypeRef = useRef<string>('audio/webm');
  // IndexedDB 백업용. 파트는 이어서 녹음마다 증가, seq는 파트 안에서 0부터.
  const sessionIdRef = useRef<string>('');
  const partRef = useRef(0);
  const seqRef = useRef(0);
  const { createObjectUrl, revokeObjectUrl } = useObjectUrl();

  // 타이머 시작
  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);
  }, []);

  // 타이머 정지
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // 현재 파트 청크를 Blob으로 봉인. 이어서 녹음 전에 호출 — 새 MediaRecorder의 헤더와 섞이지 않게.
  const sealCurrentPart = useCallback(() => {
    if (audioChunksRef.current.length > 0) {
      completedPartsRef.current.push(new Blob(audioChunksRef.current, { type: mimeTypeRef.current }));
      audioChunksRef.current = [];
    }
  }, []);

  // 마이크 캡처 시작(신규/이어서 공용). isNewSession=false면 기존 파트·세션ID·경과시간 보존.
  const beginCapture = useCallback(
    async (isNewSession: boolean) => {
      try {
        if (isNewSession) {
          audioChunksRef.current = [];
          completedPartsRef.current = [];
          partRef.current = 0;
          seqRef.current = 0;
          sessionIdRef.current = crypto.randomUUID();
        } else {
          sealCurrentPart();
          partRef.current += 1;
          seqRef.current = 0;
        }
        setCaptureInterrupted(null);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        // 회의 음성용 저비트레이트(opus 32kbps): 1시간 ~14MB -> Whisper 25MB 한계 안에 70분 수용.
        // codecs=opus 미지원 브라우저면 기본값으로 폴백.
        const preferred = 'audio/webm;codecs=opus';
        const mediaRecorder = MediaRecorder.isTypeSupported?.(preferred)
          ? new MediaRecorder(stream, { mimeType: preferred, audioBitsPerSecond: 32000 })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        // mediaRecorder.mimeType은 생성자가 실제로 채택한 포맷(브라우저 기본값 폴백 포함)을 반영.
        mimeTypeRef.current = mediaRecorder.mimeType || 'audio/webm';

        if (isNewSession) recordingBackup.startSession(sessionIdRef.current, mimeTypeRef.current);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            // 백업은 안전망일 뿐 라이브 녹음을 막으면 안 됨 — 실패해도 콘솔 경고만(내부에서 처리).
            recordingBackup.saveChunk(sessionIdRef.current, partRef.current, seqRef.current++, event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob([...completedPartsRef.current, ...audioChunksRef.current], {
            type: mimeTypeRef.current,
          });
          // Safely create object URL with automatic cleanup
          const url = createObjectUrl(audioBlob);
          setAudioUrl(url);
        };

        // 마이크 뽑힘·권한 회수·OS가 트랙을 끊음 → 조용히 무음이 녹음되지 않게 즉시 중단하고 알린다.
        // (예전엔 감지가 없어 타이머와 "녹음 중" 배지만 계속 돌았음.)
        const interrupt = (message: string) => {
          if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
          stopTimer();
          stopTracks();
          setIsRecording(false);
          setIsPaused(false);
          setCaptureInterrupted(message);
        };
        stream.getAudioTracks().forEach((track) => {
          track.onended = () => interrupt('마이크 연결이 끊겼습니다. 지금까지 녹음은 보존됐어요 — 이어서 녹음하거나 바로 변환할 수 있습니다.');
        });
        mediaRecorder.onerror = () => interrupt('녹음 중 오류가 발생했습니다. 지금까지 녹음은 보존됐어요 — 이어서 녹음하거나 바로 변환할 수 있습니다.');

        // 1초 청크: 0.1초는 3시간 녹음에 IndexedDB 레코드 10만 개 → 복구 시 폰 메모리 초과. 1초면 1만 개.
        mediaRecorder.start(1000);
        setIsRecording(true);
        setIsPaused(false);
        if (isNewSession) setDuration(0);
        startTimer();
      } catch (error) {
        console.error('마이크 접근 오류:', error);
        throw new Error('마이크 접근이 거부되었습니다.');
      }
    },
    [startTimer, stopTimer, stopTracks, sealCurrentPart, createObjectUrl]
  );

  const startRecording = useCallback(() => beginCapture(true), [beginCapture]);

  // 이어서 녹음: 기존 파트/세션 유지, 새 파트로 스트림만 붙임. audioUrl(이전 "완료" 상태)은 무효화.
  const continueRecording = useCallback(async () => {
    revokeObjectUrl();
    setAudioUrl(null);
    await beginCapture(false);
  }, [beginCapture, revokeObjectUrl]);

  // 녹음 정지
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      stopTimer();
      stopTracks();
    }
  }, [stopTimer, stopTracks]);

  // 일시정지
  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      stopTimer();
    }
  }, [stopTimer]);

  // 재개
  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      startTimer();
    }
  }, [startTimer]);

  const getAudioParts = useCallback((): Blob[] => {
    const parts = [...completedPartsRef.current];
    if (audioChunksRef.current.length > 0) {
      parts.push(new Blob(audioChunksRef.current, { type: mimeTypeRef.current }));
    }
    return parts;
  }, []);

  // 오디오 Blob 가져오기(재생용 전체)
  const getAudioBlob = useCallback((): Blob | null => {
    const parts = getAudioParts();
    if (parts.length === 0) return null;
    return new Blob(parts, { type: mimeTypeRef.current });
  }, [getAudioParts]);

  const clearBackup = useCallback(() => {
    if (sessionIdRef.current) void recordingBackup.deleteSession(sessionIdRef.current);
  }, []);

  // 초기화(명시적 폐기) — 백업도 같이 지운다. 실패 후 재시도는 이 함수를 타지 않는다.
  const reset = useCallback(() => {
    clearBackup();
    setIsRecording(false);
    setIsPaused(false);
    setDuration(0);
    setAudioUrl(null);
    setCaptureInterrupted(null);
    audioChunksRef.current = [];
    completedPartsRef.current = [];
    sessionIdRef.current = '';
    partRef.current = 0;
    seqRef.current = 0;

    // Safely revoke object URL
    revokeObjectUrl();
  }, [revokeObjectUrl, clearBackup]);

  const listRecoverableSessions = useCallback(async (): Promise<RecoverableSession[]> => {
    const all = await recordingBackup.listSessions();
    // 지금 진행 중인 세션은 복구 대상에서 제외.
    return all.filter((s) => s.sessionId !== sessionIdRef.current);
  }, []);

  // 복구 세션을 현재 훅 상태로 로드. 이후 이어서 녹음하거나(continueRecording) 바로 전사 가능.
  const recoverSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const recovered = await recordingBackup.recoverSession(sessionId);
      if (!recovered) return false;

      sessionIdRef.current = recovered.sessionId;
      mimeTypeRef.current = recovered.mimeType;
      // 복구된 파트들은 봉인 완료 상태. 이어서 녹음하면 그 다음 파트 번호로 새 청크가 쌓인다(덮어쓰기 없음).
      completedPartsRef.current = recovered.parts;
      audioChunksRef.current = [];
      partRef.current = recovered.parts.length - 1;
      seqRef.current = 0;
      setDuration(Math.round((Date.now() - recovered.startedAt) / 1000));
      const url = createObjectUrl(recovered.blob);
      setAudioUrl(url);
      return true;
    },
    [createObjectUrl]
  );

  const discardRecoverableSession = useCallback((sessionId: string) => {
    void recordingBackup.deleteSession(sessionId);
  }, []);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      stopTimer();
      // Safely revoke object URL (useObjectUrl handles cleanup)
      revokeObjectUrl();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      // 주의: 여기서 IndexedDB 백업을 지우지 않는다 — unmount(새로고침/페이지 이동 포함)로
      // 잃은 녹음을 다음 방문 때 복구하는 게 이 백업의 존재 이유(clearBackup은 성공/명시적 폐기 시에만).
    };
  }, [stopTimer, revokeObjectUrl]);

  return {
    isRecording,
    isPaused,
    duration,
    audioUrl,
    captureInterrupted,
    startRecording,
    continueRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getAudioBlob,
    getAudioParts,
    reset,
    clearBackup,
    listRecoverableSessions,
    recoverSession,
    discardRecoverableSession,
  };
}
