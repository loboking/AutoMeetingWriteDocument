'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PrdViewer } from '@/components/PrdViewer';
import { useMeetingStore } from '@/store/meetingStore';
import { Loader2, AlertCircle } from 'lucide-react';

export default function SharedPage() {
  const params = useParams();
  const router = useRouter();
  const { setCurrentMeeting } = useMeetingStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSharedDocument() {
      try {
        const response = await fetch(`/api/share?id=${params.id}`);
        if (!response.ok) throw new Error('문서를 찾을 수 없습니다');
        const { meeting } = await response.json();
        setCurrentMeeting(meeting);
      } catch (err) {
        setError(err instanceof Error ? err.message : '알 수 없는 오류');
      } finally {
        setLoading(false);
      }
    }
    loadSharedDocument();
  }, [params.id, setCurrentMeeting]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-slate-600" />
          <p className="text-slate-600">문서를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">문서를 찾을 수 없습니다</h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            홈으로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="text-amber-800 text-sm">
            🔗 공유 문서 보기 모드
          </span>
          <button
            onClick={() => router.push('/')}
            className="text-amber-700 text-sm hover:underline"
          >
            새 문서 만들기 →
          </button>
        </div>
      </div>
      <PrdViewer />
    </div>
  );
}
