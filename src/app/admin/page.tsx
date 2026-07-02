'use client';

import { useState, useEffect, useCallback } from 'react';
import { authedFetch } from '@/lib/authFetch';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, CreditCard, LayoutDashboard, ShieldAlert, RefreshCw, ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DOCUMENTS, docTypeToField } from '@/lib/documentUtils';

type Tab = 'dashboard' | 'users' | 'payments';

const won = (n: number) => `${(n ?? 0).toLocaleString()}원`;
const num = (n: number) => (n ?? 0).toLocaleString();
const date = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR') : '-');

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [denied, setDenied] = useState(false);

  return (
    <PageContainer width="default" className="py-6 sm:py-8">
      <header className="mb-6 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">관리자</h1>
      </header>

      {denied ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          관리자 권한이 없습니다. (화이트리스트에 등록된 계정으로 로그인하세요)
        </CardContent></Card>
      ) : (
        <>
          <div className="mb-4 flex gap-1 border-b border-border text-sm">
            {([['dashboard','대시보드',LayoutDashboard],['users','사용자',Users],['payments','결제',CreditCard]] as const).map(([k,label,Icon]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`flex items-center gap-1.5 px-3 py-2 font-medium ${tab===k?'border-b-2 border-primary text-foreground':'text-muted-foreground'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          {tab === 'dashboard' && <Dashboard onDenied={() => setDenied(true)} />}
          {tab === 'users' && <UsersTab onDenied={() => setDenied(true)} />}
          {tab === 'payments' && <PaymentsTab onDenied={() => setDenied(true)} />}
        </>
      )}
    </PageContainer>
  );
}

// 공통 fetch 헬퍼 — 403이면 onDenied
function useAdminFetch<T>(url: string, onDenied: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await authedFetch(url);
      if (res.status === 403) { onDenied(); return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '조회 실패'); }
      setData(await res.json());
    } catch (e) { setError(e instanceof Error ? e.message : '오류'); }
    finally { setLoading(false); }
  }, [url, onDenied]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}

interface DashboardData {
  totalUsers: number; paidSubscribers: number; mrr: number; planCounts: Record<string, number>;
  meetingsTotal: number; meetingsThisPeriod: number; revenueThisMonth: number; failedPayments: number;
  tokens: { input: number; output: number; total: number; calls: number }; period: string;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

function Dashboard({ onDenied }: { onDenied: () => void }) {
  const { data, loading, error, reload } = useAdminFetch<DashboardData>('/api/admin/dashboard', onDenied);
  if (loading) return <Spinner />;
  if (error) return <ErrBox msg={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshBtn onClick={reload} /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="총 가입자" value={num(data.totalUsers)} />
        <StatCard label="유료 구독자" value={num(data.paidSubscribers)} />
        <StatCard label="MRR (월 매출)" value={won(data.mrr)} />
        <StatCard label={`이번 달 매출 (${data.period})`} value={won(data.revenueThisMonth)} />
        <StatCard label="총 회의 수" value={num(data.meetingsTotal)} />
        <StatCard label="이번 달 회의 처리" value={num(data.meetingsThisPeriod)} sub="미터링 차감 기준" />
        <StatCard label="실패 결제" value={num(data.failedPayments)} />
        <StatCard label="이번 달 토큰" value={num(data.tokens.total)} sub={`${num(data.tokens.calls)}회 호출`} />
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">플랜 분포</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          {Object.entries(data.planCounts).map(([p, c]) => (
            <Badge key={p} variant="secondary">{p}: {c}</Badge>
          ))}
          {Object.keys(data.planCounts).length === 0 && <span className="text-xs text-muted-foreground">구독 없음</span>}
        </CardContent>
      </Card>
    </div>
  );
}

interface UserRow {
  id: string; email: string; createdAt: string; lastSignInAt: string | null;
  banned: boolean; meetingCount: number; plan: string; subStatus: string | null;
}

function UsersTab({ onDenied }: { onDenied: () => void }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<{ id: string; email: string } | null>(null);
  const { data, loading, error, reload } = useAdminFetch<{ users: UserRow[] }>(
    `/api/admin/users?perPage=200${q ? `&q=${encodeURIComponent(q)}` : ''}`, onDenied);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일 검색"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary" />
        <RefreshBtn onClick={reload} />
      </div>
      {loading ? <Spinner /> : error ? <ErrBox msg={error} onRetry={reload} /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-left">이메일</th>
                <th className="p-2 text-left">플랜</th>
                <th className="p-2 text-right">회의</th>
                <th className="p-2 text-left">가입일</th>
                <th className="p-2 text-left">최근 로그인</th>
                <th className="p-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id} onClick={() => setSelected({ id: u.id, email: u.email })}
                  className="cursor-pointer border-t border-border hover:bg-muted/40">
                  <td className="p-2 text-primary underline-offset-2 hover:underline">{u.email}</td>
                  <td className="p-2"><Badge variant={u.plan==='free'?'secondary':'default'} className="text-[10px]">{u.plan}</Badge></td>
                  <td className="p-2 text-right">{u.meetingCount}</td>
                  <td className="p-2">{date(u.createdAt)}</td>
                  <td className="p-2">{date(u.lastSignInAt)}</td>
                  <td className="p-2 text-center">{u.banned ? <Badge variant="destructive" className="text-[10px]">차단</Badge> : <span className="text-xs text-green-600">정상</span>}</td>
                </tr>
              ))}
              {(data?.users ?? []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">사용자 없음</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {selected && <UserDetail userId={selected.id} email={selected.email} onClose={() => setSelected(null)} onDenied={onDenied} onReload={reload} />}
    </div>
  );
}

interface UserDetailData {
  user: { id: string; email: string | null; createdAt: string; lastSignInAt: string | null; banned: boolean };
  subscription: { plan: string; status: string } | null;
  meetings: { client_id: string; title: string; created_at: string }[];
  usageByPeriod: Record<string, number>;
  tokens: { total: number; calls: number; byOp: Record<string, { calls: number; input: number; output: number }> };
}

// 사용자 상세 모달 — 구독/사용량/토큰 + 회의 목록. 회의 클릭 시 문서 뷰어.
function UserDetail({ userId, email, onClose, onDenied, onReload }: { userId: string; email: string; onClose: () => void; onDenied: () => void; onReload: () => void }) {
  const { data, loading, error } = useAdminFetch<UserDetailData>(`/api/admin/users/${userId}`, onDenied);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [banning, setBanning] = useState(false);

  const toggleBan = async () => {
    if (!data) return;
    if (!confirm(data.user.banned ? '차단을 해제할까요?' : '이 사용자를 차단할까요?')) return;
    setBanning(true);
    try {
      const res = await authedFetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban: !data.user.banned }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || '실패'); }
      else { onReload(); onClose(); }
    } finally { setBanning(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-[min(720px,100%)] overflow-y-auto rounded-2xl bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{email}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        {loading ? <Spinner /> : error ? <ErrBox msg={error} onRetry={() => {}} /> : data ? (
          meetingId ? (
            <MeetingViewer meetingId={meetingId} onBack={() => setMeetingId(null)} onDenied={onDenied} />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="플랜" value={data.subscription?.plan ?? 'free'} />
                <MiniStat label="구독상태" value={data.subscription?.status ?? '-'} />
                <MiniStat label="토큰 호출" value={num(data.tokens.calls)} />
                <MiniStat label="총 토큰" value={num(data.tokens.total)} />
              </div>
              {Object.keys(data.tokens.byOp).length > 0 && (
                <div className="rounded-lg border border-border p-2 text-xs">
                  <div className="mb-1 font-medium">작업별 토큰</div>
                  {Object.entries(data.tokens.byOp).map(([op, v]) => (
                    <div key={op} className="flex justify-between text-muted-foreground">
                      <span>{op}</span><span>{v.calls}회 · 입력 {num(v.input)} / 출력 {num(v.output)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">회의 {data.meetings.length}개</span>
                  <Button size="sm" variant={data.user.banned ? 'outline' : 'destructive'} onClick={toggleBan} disabled={banning}>
                    {banning ? '처리중' : data.user.banned ? '차단 해제' : '차단'}
                  </Button>
                </div>
                <div className="space-y-1">
                  {data.meetings.map((m) => (
                    <button key={m.client_id} onClick={() => setMeetingId(m.client_id)}
                      className="flex w-full items-center justify-between rounded-lg border border-border p-2 text-left hover:bg-muted/40">
                      <span className="truncate">{m.title || '(제목 없음)'}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">{date(m.created_at)}</span>
                    </button>
                  ))}
                  {data.meetings.length === 0 && <p className="text-center text-xs text-muted-foreground">회의 없음</p>}
                </div>
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border p-2">
    <div className="text-[10px] text-muted-foreground">{label}</div>
    <div className="mt-0.5 font-semibold">{value}</div>
  </div>
);

interface MeetingData {
  title: string;
  createdAt: string; updatedAt: string;
  data: Record<string, unknown>; // Meeting 본문 전체
}

// 회의 문서 뷰어 — 14종 문서 + 요약 + 전사록 + 원본 JSON. 테스트 단계라 전부 표시.
function MeetingViewer({ meetingId, onBack, onDenied }: { meetingId: string; onBack: () => void; onDenied: () => void }) {
  const { data, loading, error } = useAdminFetch<MeetingData>(`/api/admin/meetings/${meetingId}`, onDenied);
  const [view, setView] = useState<string>('summary'); // summary | transcript | <docType> | raw

  if (loading) return <Spinner />;
  if (error) return <ErrBox msg={error} onRetry={() => {}} />;
  if (!data) return null;
  const d = data.data || {};

  // 내용이 있는 문서만 탭으로
  const docTabs = DOCUMENTS.filter((doc) => {
    const v = d[docTypeToField(doc.key)];
    return typeof v === 'string' && v.trim();
  });
  const summary = d.summary as Record<string, unknown> | undefined;
  const transcript = (d.transcript as string) || '';

  const activeContent = (): string => {
    if (view === 'transcript') return transcript || '(전사록 없음)';
    if (view === 'raw') return '```json\n' + JSON.stringify(d, null, 2) + '\n```';
    if (view === 'summary') return '';
    const v = d[docTypeToField(view)];
    return typeof v === 'string' ? v : '(내용 없음)';
  };

  return (
    <div className="space-y-3 text-sm">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> 회의 목록으로
      </button>
      <div>
        <div className="font-semibold">{data.title || '(제목 없음)'}</div>
        <div className="text-xs text-muted-foreground">생성 {date(data.createdAt)} · 수정 {date(data.updatedAt)}</div>
      </div>

      {/* 탭: 요약 / 전사록 / 각 문서 / 원본 */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2 text-xs">
        <TabBtn active={view==='summary'} onClick={() => setView('summary')}>요약</TabBtn>
        {transcript && <TabBtn active={view==='transcript'} onClick={() => setView('transcript')}>전사록</TabBtn>}
        {docTabs.map((doc) => (
          <TabBtn key={doc.key} active={view===doc.key} onClick={() => setView(doc.key)}>{doc.icon} {doc.title}</TabBtn>
        ))}
        <TabBtn active={view==='raw'} onClick={() => setView('raw')}>원본 JSON</TabBtn>
      </div>

      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
        {view === 'summary' ? (
          summary ? (
            <div className="space-y-2 text-xs">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k}>
                  <div className="font-medium text-foreground">{k}</div>
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {Array.isArray(v) ? (v as unknown[]).map((x) => `• ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : String(v)}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">요약 없음</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none text-xs prose-pre:text-[10px]">
            <ReactMarkdown>{activeContent()}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

const TabBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className={`rounded px-2 py-1 ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{children}</button>
);

interface PaymentRow { email: string; paymentId: string; plan: string; amount: number; status: string; createdAt: string; }

function PaymentsTab({ onDenied }: { onDenied: () => void }) {
  const [filter, setFilter] = useState('');
  const { data, loading, error, reload } = useAdminFetch<{ payments: PaymentRow[] }>(
    `/api/admin/payments${filter ? `?status=${filter}` : ''}`, onDenied);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {['', 'paid', 'failed', 'canceled'].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs ${filter===f?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground'}`}>
            {f === '' ? '전체' : f}
          </button>
        ))}
        <div className="flex-1" /><RefreshBtn onClick={reload} />
      </div>
      {loading ? <Spinner /> : error ? <ErrBox msg={error} onRetry={reload} /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th className="p-2 text-left">이메일</th><th className="p-2 text-left">플랜</th><th className="p-2 text-right">금액</th><th className="p-2 text-center">상태</th><th className="p-2 text-left">일시</th></tr>
            </thead>
            <tbody>
              {(data?.payments ?? []).map((p) => (
                <tr key={p.paymentId} className="border-t border-border">
                  <td className="p-2">{p.email}</td>
                  <td className="p-2">{p.plan}</td>
                  <td className="p-2 text-right">{won(p.amount)}</td>
                  <td className="p-2 text-center">
                    <Badge variant={p.status==='paid'?'default':p.status==='failed'?'destructive':'secondary'} className="text-[10px]">{p.status}</Badge>
                  </td>
                  <td className="p-2">{date(p.createdAt)}</td>
                </tr>
              ))}
              {(data?.payments ?? []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">결제 내역 없음</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Spinner = () => <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
const ErrBox = ({ msg, onRetry }: { msg: string; onRetry: () => void }) => (
  <Card><CardContent className="py-8 text-center text-sm">
    <p className="mb-2 text-destructive">⚠️ {msg}</p>
    <Button size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>
  </CardContent></Card>
);
const RefreshBtn = ({ onClick }: { onClick: () => void }) => (
  <Button size="sm" variant="outline" onClick={onClick} className="gap-1"><RefreshCw className="h-3.5 w-3.5" /> 새로고침</Button>
);
