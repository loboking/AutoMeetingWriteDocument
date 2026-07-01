'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { MessageSquarePlus, X, Send, History, Loader2, Check, RotateCcw, Sparkles, GitBranch, Trash2 } from 'lucide-react';
import { useMeetingStore, type ChatMsg } from '@/store/meetingStore';
import { authedFetch } from '@/lib/authFetch';
import { docTypeToField, DOCUMENTS, getAllDependents } from '@/lib/documentUtils';
import { diffLines, diffStats, collapseUnchanged } from '@/lib/lineDiff';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DocType, DocVersionSource } from '@/types';

// 버튼/패널에 노출되는 도우미 이름 (한 곳에서만 수정)
const ASSISTANT_NAME = 'DocHelper';

const docTitle = (t: DocType) => DOCUMENTS.find((d) => d.key === t)?.title ?? t;

const SOURCE_LABEL: Record<DocVersionSource, string> = {
  generated: '생성/재생성',
  'manual-edit': '직접 수정',
  'ai-edit': '도우미 수정',
  restored: '복원',
};

export default function DocAssistant() {
  const currentMeeting = useMeetingStore((s) => s.currentMeeting);
  const activeDocType = useMeetingStore((s) => s.activeDocType);
  const updateCurrentMeeting = useMeetingStore((s) => s.updateCurrentMeeting);
  const recordDocVersion = useMeetingStore((s) => s.recordDocVersion);
  const getDocVersions = useMeetingStore((s) => s.getDocVersions);
  const restoreDocVersion = useMeetingStore((s) => s.restoreDocVersion);
  const setDocStatus = useMeetingStore((s) => s.setDocStatus);
  const regenerateDocs = useMeetingStore((s) => s.regenerateDocs);
  const isGenerating = useMeetingStore((s) => s.isGenerating);
  // 회의별 대화는 store에서 영속 관리 → 같은 프로젝트로 돌아오면 복원
  const chatMessages = useMeetingStore((s) => s.chatMessages);
  const appendChatMessage = useMeetingStore((s) => s.appendChatMessage);
  const clearChatMessages = useMeetingStore((s) => s.clearChatMessages);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 진행 단계 표시(경과 시간 기반) — 2분 걸려도 멈춘 느낌 안 들게
  const [progressMsg, setProgressMsg] = useState('생각하는 중...');
  // 제안된 수정본 (diff 미리보기 → 적용 대기). 휘발성 UI 상태라 영속 안 함.
  const [proposal, setProposal] = useState<{ docType: DocType; before: string; after: string; instruction: string } | null>(null);
  // 적용 후 "연관 문서도 갱신" 제안 (사용자 클릭 시 regenerateDocs). 휘발성.
  const [cascade, setCascade] = useState<{ from: DocType; targets: DocType[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 진행 중 요청 취소용(ESC). textarea 포커스 시에만 취소 허용.
  const abortRef = useRef<AbortController | null>(null);
  // 패널 크기(px) — 사용자가 좌상단 핸들로 리사이즈. 기본값은 기존 크기.
  const [panelSize, setPanelSize] = useState<{ w: number; h: number }>({ w: 420, h: 620 });
  const resizingRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const meetingId = currentMeeting?.id ?? null;
  // 현재 회의의 대화 기록 (store에서 영속). 회의 바꾸면 자동으로 그 회의 것으로 전환.
  const messages: ChatMsg[] = useMemo(
    () => (meetingId ? (chatMessages[meetingId] ?? []) : []),
    [meetingId, chatMessages]
  );
  const addMsg = (msg: ChatMsg) => { if (meetingId) appendChatMessage(meetingId, msg); };

  // 프로젝트(회의) 전환 시: 휘발성 UI 상태(제안/diff)만 초기화. 대화는 store가 회의별로 보존.
  useEffect(() => {
    setProposal(null);
    setCascade(null);
    setTab('chat');
    setInput('');
  }, [meetingId]);

  // 대상 문서: 사용자가 보고 있는 문서. 없으면 내용 있는 첫 문서.
  const targetDoc: DocType | null = useMemo(() => {
    if (!currentMeeting) return null;
    if (activeDocType) return activeDocType;
    const first = DOCUMENTS.find((d) => {
      const f = docTypeToField(d.key) as keyof typeof currentMeeting;
      return !!(currentMeeting[f] as string | undefined)?.trim();
    });
    return first?.key ?? null;
  }, [currentMeeting, activeDocType]);

  const targetContent: string = useMemo(() => {
    if (!currentMeeting || !targetDoc) return '';
    const f = docTypeToField(targetDoc) as keyof typeof currentMeeting;
    return ((currentMeeting[f] as string | undefined) ?? '').trim();
  }, [currentMeeting, targetDoc]);

  // currentMeeting.docVersions가 바뀌면 자동 재계산 (store 구독 기반)
  const versions = useMemo(() => {
    if (!currentMeeting || !targetDoc) return [];
    return getDocVersions(currentMeeting.id, targetDoc);
  }, [currentMeeting, targetDoc, getDocVersions]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, proposal]);

  // 문서가 하나도 없으면 도우미 자체를 숨김
  const hasAnyDoc = useMemo(() => {
    if (!currentMeeting) return false;
    return DOCUMENTS.some((d) => {
      const f = docTypeToField(d.key) as keyof typeof currentMeeting;
      return !!(currentMeeting[f] as string | undefined)?.trim();
    });
  }, [currentMeeting]);

  if (!currentMeeting || !hasAnyDoc) return null;

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || busy || !targetDoc) return;
    if (!targetContent) {
      addMsg({ role: 'assistant', text: '먼저 수정할 문서를 선택하거나 생성해주세요.' });
      return;
    }
    // 직전 대화 맥락 전송 (최근 12개) — "그걸 수정해줘"의 '그거'를 AI가 알도록
    const history = messages.slice(-12).map((m) => ({ role: m.role, text: m.text }));
    setInput('');
    addMsg({ role: 'user', text: instruction });
    setBusy(true);
    // 경과 시간 기반 단계 표시 (서버는 단일 응답이라 클라에서 안내). 길게 걸려도 멈춘 느낌 방지.
    setProgressMsg('생각하는 중... (ESC로 취소)');
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      if (s > 70) setProgressMsg('거의 다 됐어요... (ESC로 취소)');
      else if (s > 30) setProgressMsg('문서를 다듬는 중... (ESC로 취소)');
      else if (s > 8) setProgressMsg('자료를 찾아보는 중... (ESC로 취소)');
    }, 1000);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await authedFetch('/api/edit-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          docType: targetDoc,
          currentContent: targetContent,
          instruction,
          history,
          title: currentMeeting.title,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || '요청에 실패했습니다.');
      }
      const data = await res.json();

      // edit 모드: 수정안 → diff 제안
      if (data.mode === 'edit' && typeof data.content === 'string' && data.content.trim()) {
        const after: string = data.content;
        if (after.trim() === targetContent) {
          addMsg({ role: 'assistant', text: data.reply || '이미 반영돼 있어 바뀐 내용이 없어요.' });
          return;
        }
        setProposal({ docType: targetDoc, before: targetContent, after, instruction });
        addMsg({ role: 'assistant', text: data.reply || '수정안을 만들었어요. 아래 변경 내용을 확인하고 적용하세요.' });
        return;
      }

      // chat 모드(기본): 대화 답변만
      addMsg({ role: 'assistant', text: data.reply || '다시 한 번 말씀해 주세요.' });
    } catch (err) {
      // 사용자가 ESC로 취소한 경우 — 조용히 안내만
      if (err instanceof DOMException && err.name === 'AbortError') {
        addMsg({ role: 'assistant', text: '요청을 취소했어요.' });
      } else {
        const msg = err instanceof Error ? err.message : '오류가 발생했습니다.';
        addMsg({ role: 'assistant', text: `⚠️ ${msg}` });
      }
    } finally {
      clearInterval(ticker);
      abortRef.current = null;
      setBusy(false);
    }
  };

  // 진행 중 요청 취소(ESC). textarea 포커스 상태에서만 호출됨.
  const cancelRequest = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  // 패널 리사이즈: 좌상단 핸들 드래그. 패널이 우하단 고정이라 좌↑로 끌면 커진다.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { startX: e.clientX, startY: e.clientY, startW: panelSize.w, startH: panelSize.h };
    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      // 좌상단 핸들: 왼쪽/위로 끌수록(dx,dy 음수) 커진다 → 부호 반전
      const w = Math.min(Math.max(r.startW + (r.startX - ev.clientX), 320), Math.min(900, window.innerWidth - 40));
      const h = Math.min(Math.max(r.startH + (r.startY - ev.clientY), 360), window.innerHeight - 40);
      setPanelSize({ w, h });
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const applyProposal = () => {
    if (!proposal || !currentMeeting) return;
    const changed = proposal.docType;
    const field = docTypeToField(changed) as keyof typeof currentMeeting;
    // 적용 직전 현재(이전) 내용을 버전으로 보존
    recordDocVersion(currentMeeting.id, changed, proposal.before, 'ai-edit', proposal.instruction);
    updateCurrentMeeting({ [field]: proposal.after });
    setDocStatus(currentMeeting.id, changed, 'latest');
    addMsg({ role: 'assistant', text: '✅ 적용했어요. 이전 버전은 히스토리에서 복원할 수 있어요.' });
    setProposal(null);

    // 연관(하위) 문서 갱신 제안 — 본문이 실제로 있는 것만(빈 문서는 재생성 대상 아님).
    // summary 없으면 재생성 불가하므로 제안도 생략.
    if (currentMeeting.summary) {
      const dependents = getAllDependents(changed).filter((d) => {
        const f = docTypeToField(d) as keyof typeof currentMeeting;
        return !!(currentMeeting[f] as string | undefined)?.trim();
      });
      if (dependents.length > 0) {
        setCascade({ from: changed, targets: dependents });
      }
    }
  };

  const runCascade = async () => {
    if (!cascade || !currentMeeting || isGenerating) return;
    const targets = cascade.targets;
    setCascade(null);
    addMsg({
      role: 'assistant',
      text: `🔄 ${targets.map(docTitle).join(' · ')} ${targets.length}개를 의존 순서대로 갱신 중이에요...`,
    });
    try {
      await regenerateDocs(currentMeeting.id, targets);
      addMsg({ role: 'assistant', text: '✅ 연관 문서 갱신을 완료했어요. 각 문서의 이전 버전도 히스토리에 남아있어요.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '갱신 중 오류가 발생했습니다.';
      addMsg({ role: 'assistant', text: `⚠️ ${msg}` });
    }
  };

  const handleRestore = (versionId: string) => {
    if (!currentMeeting) return;
    restoreDocVersion(currentMeeting.id, versionId);
    addMsg({ role: 'assistant', text: '↩️ 선택한 버전으로 복원했어요.' });
    setTab('chat');
  };

  const diff = proposal ? diffLines(proposal.before, proposal.after) : [];
  const stats = proposal ? diffStats(diff) : { added: 0, removed: 0 };
  // 전체가 아니라 "바뀐 부분 + 앞뒤 2줄"만 (긴 unchanged는 접음)
  const hunks = proposal ? collapseUnchanged(diff, 2) : [];

  return (
    <>
      {/* 플로팅 버튼 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl"
          aria-label={`${ASSISTANT_NAME} 열기`}
        >
          <MessageSquarePlus className="h-5 w-5" />
          <span className="text-sm font-medium">{ASSISTANT_NAME}</span>
        </button>
      )}

      {/* 채팅 패널 */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] max-h-[calc(100vh-2.5rem)] flex-col rounded-2xl border border-border bg-background shadow-2xl"
          style={{ width: panelSize.w, height: panelSize.h }}
        >
          {/* 리사이즈 핸들(좌상단) — 좌↑로 끌면 커짐 */}
          <div
            onMouseDown={startResize}
            className="absolute -left-1 -top-1 z-10 h-4 w-4 cursor-nwse-resize rounded-tl-lg border-l-2 border-t-2 border-primary/40 hover:border-primary"
            title="드래그해서 크기 조절"
            aria-label="채팅창 크기 조절"
          />
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">{ASSISTANT_NAME}</span>
              {targetDoc && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {docTitle(targetDoc)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => { if (meetingId && confirm('이 프로젝트의 대화 기록을 모두 지울까요?')) clearChatMessages(meetingId); }}
                  aria-label="대화 비우기"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="대화 비우기"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="닫기" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex border-b border-border text-sm">
            <button
              onClick={() => setTab('chat')}
              className={cn('flex-1 py-2 font-medium', tab === 'chat' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground')}
            >
              대화 수정
            </button>
            <button
              onClick={() => setTab('history')}
              className={cn('flex flex-1 items-center justify-center gap-1 py-2 font-medium', tab === 'history' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground')}
            >
              <History className="h-3.5 w-3.5" /> 버전 ({versions.length})
            </button>
          </div>

          {/* 본문 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
            {tab === 'chat' ? (
              <div className="space-y-3">
                {messages.length === 0 && !proposal && (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    <p className="mb-1 font-medium text-foreground">{docTitle(targetDoc ?? 'prd')} 문서를 함께 논의하고 다듬어요.</p>
                    <p className="mb-1">먼저 편하게 물어보세요. 예: &quot;타깃 고객이 너무 넓지 않아?&quot;, &quot;이 기능 우선순위 어때?&quot;</p>
                    수정하려면: &quot;그럼 B2B 중소기업으로 바꿔줘&quot;, &quot;보안 요구사항 섹션 추가해줘&quot; — 수정안을 미리보기로 보여드려요.
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                      {m.text}
                    </div>
                  </div>
                ))}

                {/* diff 미리보기 */}
                {proposal && (
                  <div className="rounded-lg border border-border">
                    <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs">
                      <span className="font-medium">{docTitle(proposal.docType)} 변경 미리보기</span>
                      <span className="text-muted-foreground">
                        <span className="text-green-600">+{stats.added}</span>{' '}
                        <span className="text-red-600">−{stats.removed}</span>
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto bg-background p-2 font-mono text-[11px] leading-relaxed">
                      {hunks.map((l, i) =>
                        l.op === 'gap' ? (
                          <div key={i} className="select-none px-1 py-0.5 text-center text-[10px] text-muted-foreground/60">
                            {`⋯ 변경 없는 ${l.hidden}줄 ⋯`}
                          </div>
                        ) : (
                        <div key={i} className={cn('whitespace-pre-wrap px-1',
                          l.op === 'add' && 'bg-green-500/10 text-green-700 dark:text-green-400',
                          l.op === 'remove' && 'bg-red-500/10 text-red-700 dark:text-red-400 line-through',
                          l.op === 'equal' && 'text-muted-foreground')}>
                          <span className="select-none opacity-50">{l.op === 'add' ? '+ ' : l.op === 'remove' ? '− ' : '  '}</span>
                          {l.text || ' '}
                        </div>
                        )
                      )}
                    </div>
                    <div className="flex gap-2 border-t border-border p-2">
                      <Button size="sm" className="flex-1 gap-1" onClick={applyProposal}>
                        <Check className="h-3.5 w-3.5" /> 적용
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setProposal(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                )}

                {/* 연관 문서 갱신 제안 */}
                {cascade && (
                  <div className="rounded-lg border border-amber-400/40 bg-amber-50 p-3 dark:bg-amber-950/20">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <GitBranch className="h-3.5 w-3.5" />
                      {docTitle(cascade.from)} 변경으로 영향받는 문서 {cascade.targets.length}개
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {cascade.targets.map(docTitle).join(' · ')}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 gap-1" onClick={runCascade} disabled={isGenerating}>
                        {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        순서대로 모두 갱신
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setCascade(null)}>
                        나중에
                      </Button>
                    </div>
                  </div>
                )}

                {busy && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {progressMsg}
                  </div>
                )}
              </div>
            ) : (
              // 버전 히스토리
              <div className="space-y-2">
                {versions.length === 0 ? (
                  <p className="p-3 text-center text-xs text-muted-foreground">아직 저장된 버전이 없습니다.<br />문서를 수정하면 자동으로 기록됩니다.</p>
                ) : (
                  versions.map((v) => (
                    <div key={v.id} className="rounded-lg border border-border p-2.5 text-xs">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{SOURCE_LABEL[v.source]}</span>
                        <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString('ko-KR')}</span>
                      </div>
                      {v.note && <p className="mb-1.5 truncate text-muted-foreground" title={v.note}>📝 {v.note}</p>}
                      <p className="mb-2 line-clamp-2 text-muted-foreground">{v.content.slice(0, 120)}…</p>
                      <Button size="xs" variant="outline" className="gap-1" onClick={() => handleRestore(v.id)}>
                        <RotateCcw className="h-3 w-3" /> 이 버전으로 복원
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 입력 */}
          {tab === 'chat' && (
            <div className="border-t border-border p-2.5">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => { if (!busy) setInput(e.target.value); }}
                  onKeyDown={(e) => {
                    // ESC: 응답 대기 중이면 취소(textarea 포커스 상태에서만 이 핸들러가 실행됨)
                    if (e.key === 'Escape' && busy) {
                      e.preventDefault();
                      cancelRequest();
                      return;
                    }
                    if (busy) return; // 대기 중 다른 입력 무시
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={busy ? 'ESC를 누르면 취소돼요...' : `${docTitle(targetDoc ?? 'prd')}에 대해 묻거나 수정 요청... (Enter 전송, Shift+Enter 줄바꿈)`}
                  rows={2}
                  readOnly={busy}
                  className="flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
                <Button size="icon" onClick={send} disabled={busy || !input.trim()} aria-label="전송">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
