import { useState, useRef, useCallback, useEffect } from 'react';
import { useObjectUrl } from './useObjectUrl';

interface UseRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioUrl: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  getAudioBlob: () => Blob | null;
  reset: () => void;
}

export function useRecorder(): UseRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { createObjectUrl, revokeObjectUrl, getObjectUrl } = useObjectUrl();

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

  // 녹음 시작
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: 'audio/webm',
        });
        // Safely create object URL with automatic cleanup
        const url = createObjectUrl(audioBlob);
        setAudioUrl(url);
      };

      mediaRecorder.start(100); // 100ms chunks
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);
      startTimer();
    } catch (error) {
      console.error('마이크 접근 오류:', error);
      throw new Error('마이크 접근이 거부되었습니다.');
    }
  }, [startTimer, createObjectUrl]);

  // 녹음 정지
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      stopTimer();

      // 스트림 정리
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }
  }, [stopTimer]);

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

  // 오디오 Blob 가져오기
  const getAudioBlob = useCallback((): Blob | null => {
    if (audioChunksRef.current.length === 0) return null;
    return new Blob(audioChunksRef.current, { type: 'audio/webm' });
  }, []);

  // 초기화
  const reset = useCallback(() => {
    setIsRecording(false);
    setIsPaused(false);
    setDuration(0);
    setAudioUrl(null);
    audioChunksRef.current = [];

    // Safely revoke object URL
    revokeObjectUrl();
  }, [revokeObjectUrl]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      stopTimer();
      // Safely revoke object URL (useObjectUrl handles cleanup)
      revokeObjectUrl();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stopTimer, revokeObjectUrl]);

  return {
    isRecording,
    isPaused,
    duration,
    audioUrl,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getAudioBlob,
    reset,
  };
}
