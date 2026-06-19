'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useMeetingStore } from '@/store/meetingStore';
import { fetchMeetings, migrateLocalMeetings, mergeServer, upsertMeeting } from '@/lib/meetingsSync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, LogOut } from 'lucide-react';

const SYNC_DEBOUNCE_MS = 2500;

// 비로그인도 접근 가능한 공개 경로 (약관/개인정보)
const PUBLIC_PATHS = ['/terms', '/privacy'];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  // 런타임 동기화 구독/디바운스 정리용
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // onSignedIn 중복 실행 방지(같은 유저로 INITIAL_SESSION+SIGNED_IN 둘 다 올 수 있음)
  const syncedUserRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 세션 초기 로드 + 인증 상태 변화 구독
  useEffect(() => {
    let active = true;

    // ★ 안전망: getSession이 느리거나 hang하면 무한 스피너에 갇힌다(타임아웃 부재).
    //   8초 내 응답 없으면 일단 비로그인으로 간주해 화면을 보여준다(로그인 폼).
    //   이후 getSession/onAuthStateChange가 도착하면 정상 반영됨.
    const failsafe = setTimeout(() => {
      if (active) setLoadingSession(false);
    }, 8000);

    supabase.auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setLoadingSession(false);
        clearTimeout(failsafe);
      })
      .catch(() => {
        // 네트워크/인증서버 오류 → 스피너에 갇히지 않게 화면 표시
        if (active) {
          setLoadingSession(false);
          clearTimeout(failsafe);
        }
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setLoadingSession(false);
      clearTimeout(failsafe);

      // INITIAL_SESSION(저장된 세션으로 페이지 진입 — 다른 기기/새로고침), TOKEN_REFRESHED(만료 임박
      // 복원)도 SIGNED_IN과 동일하게 서버 데이터를 fetch해야 한다. 안 그러면 새 기기는 빈 로컬만 보여
      // "다른 기기 작업이 안 보임". 중복 호출(여러 이벤트가 같은 유저로 도착)은 syncedUserRef로 차단.
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && newSession) {
        if (syncedUserRef.current !== newSession.user.id) {
          syncedUserRef.current = newSession.user.id;
          void onSignedIn(newSession);
        }
      } else if (event === 'SIGNED_OUT') {
        syncedUserRef.current = null;
        onSignedOut();
      }
    });

    return () => {
      active = false;
      clearTimeout(failsafe);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SIGNED_IN: 서버 fetch + 1회 마이그레이션 + 머지 → store, 이후 변경 디바운스 upsert
  const onSignedIn = async (sess: Session) => {
    const store = useMeetingStore.getState();
    const local = store.meetings;

    const server = await fetchMeetings();
    await migrateLocalMeetings(sess.user.id, local, server);
    // 마이그레이션 후 최신 서버 상태로 다시 가져와 머지
    const serverAfter = await fetchMeetings();
    const merged = mergeServer(local, serverAfter);
    store.setMeetings(merged);

    // 런타임 변경 → 디바운스 upsert 등록 (중복 등록 방지)
    if (unsubscribeRef.current) unsubscribeRef.current();
    let prev = useMeetingStore.getState().meetings;
    unsubscribeRef.current = useMeetingStore.subscribe((state) => {
      const next = state.meetings;
      if (next === prev) return;
      // 변경/추가된 회의만 디바운스 upsert
      const prevById = new Map(prev.map((m) => [m.id, m]));
      for (const m of next) {
        if (prevById.get(m.id) !== m) scheduleUpsert(m);
      }
      prev = next;
    });
  };

  const scheduleUpsert = (meeting: { id: string }) => {
    const timers = debounceTimers.current;
    const existing = timers.get(meeting.id);
    if (existing) clearTimeout(existing);
    timers.set(
      meeting.id,
      setTimeout(() => {
        timers.delete(meeting.id);
        const fresh = useMeetingStore.getState().meetings.find((x) => x.id === meeting.id);
        if (fresh) void upsertMeeting(fresh);
      }, SYNC_DEBOUNCE_MS)
    );
  };

  // SIGNED_OUT: 순서 보장 — 생성 취소 → 구독/타이머 정리 → persist 클리어 → 메모리 리셋
  const onSignedOut = () => {
    const store = useMeetingStore.getState();
    store.cancelGeneration(); // in-flight 생성/좀비 차단 (먼저)

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    debounceTimers.current.forEach((t) => clearTimeout(t));
    debounceTimers.current.clear();

    try {
      useMeetingStore.persist.clearStorage();
    } catch {
      /* persist 미초기화 시 무시 */
    }
    store.resetForSignOut();
  };

  // hydration mismatch 방지 + 세션 로딩 중 스플래시
  // 약관/개인정보는 비로그인도 접근 가능 (가입 전 동의 링크용)
  if (mounted && PUBLIC_PATHS.some((p) => pathname?.startsWith(p))) {
    return <>{children}</>;
  }

  if (!mounted || loadingSession) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!session) {
    return <AuthForm />;
  }

  return (
    <>
      <div className="fixed top-3 right-3 z-50">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 bg-white/90 dark:bg-slate-800/90 backdrop-blur"
          onClick={() => supabase.auth.signOut()}
          title={session.user.email || '로그아웃'}
        >
          <LogOut className="w-3.5 h-3.5" />
          로그아웃
        </Button>
      </div>
      {children}
    </>
  );
}

// 이메일 + 비밀번호 로그인/회원가입 폼
function AuthForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (mode === 'signup' && !agreed) {
      setError('이용약관과 개인정보처리방침에 동의해야 가입할 수 있습니다.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // Confirm email이 켜져 있으면 session=null → 즉시 로그인 불가
        if (!data.session) {
          setNotice(
            '가입 요청됨. 이메일 확인이 필요하거나, 관리자 설정(Confirm email OFF)이 필요합니다. 설정 후 로그인하세요.'
          );
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '오류가 발생했습니다.';
      setError(translateError(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center min-h-screen px-4 bg-slate-50 dark:bg-slate-950">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'signin' ? '로그인' : '회원가입'}</CardTitle>
          <CardDescription>
            MeetingAutoDocs — 회의록을 기획 문서로. 내 문서는 내 계정에만 저장됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Input
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Input
              type="password"
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
            {mode === 'signup' && (
              <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 flex-shrink-0"
                />
                <span>
                  <a href="/terms" target="_blank" className="text-blue-600 dark:text-blue-400 underline">이용약관</a>
                  {' '}및{' '}
                  <a href="/privacy" target="_blank" className="text-blue-600 dark:text-blue-400 underline">개인정보처리방침</a>
                  에 동의합니다. (회의 녹취록이 외부 AI 서비스로 전송됨에 동의)
                </span>
              </label>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {notice && <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === 'signin' ? '로그인' : '가입하기'}
            </Button>
          </form>
          <button
            type="button"
            className="mt-3 w-full text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError('');
              setNotice('');
            }}
          >
            {mode === 'signin' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function translateError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/already registered|already exists/i.test(msg)) return '이미 가입된 이메일입니다.';
  if (/Password should be at least/i.test(msg)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/Email not confirmed/i.test(msg)) return '이메일 확인이 필요합니다. 관리자에게 문의하거나 설정을 확인하세요.';
  return msg;
}
