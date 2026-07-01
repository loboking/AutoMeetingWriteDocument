'use client';

import { useState, useEffect, useCallback } from 'react';
import { authedFetch } from '@/lib/authFetch';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, CreditCard, LayoutDashboard, ShieldAlert, RefreshCw } from 'lucide-react';

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
                <tr key={u.id} className="border-t border-border">
                  <td className="p-2">{u.email}</td>
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
    </div>
  );
}

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
