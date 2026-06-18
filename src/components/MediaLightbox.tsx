'use client';

// 다이어그램/이미지 클릭 확대 + 다운로드 라이트박스(공통).
// 표시/레이아웃만 담당하고, 다운로드 동작은 호출부가 actions로 주입.
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export interface LightboxAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface LightboxState {
  title: string;
  body: ReactNode; // 확대 표시용 (mermaid 재렌더 / clone DOM / img)
  actions: LightboxAction[];
}

export function MediaLightbox({
  state,
  onClose,
}: {
  state: LightboxState | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton
        className="max-w-[95vw] w-auto sm:max-w-[90vw] max-h-[92vh] p-0 ring-0 gap-0 bg-white dark:bg-slate-900 overflow-hidden flex flex-col"
      >
        <DialogTitle className="sr-only">{state?.title ?? '확대 보기'}</DialogTitle>
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{state?.title}</span>
          {/* pr-8: 우상단 close 버튼과 겹침 방지 */}
          <div className="flex gap-2 pr-8 flex-shrink-0">
            {state?.actions.map((a) => (
              <Button key={a.label} size="sm" variant="outline" onClick={a.onClick} className="h-8">
                <Download className="w-4 h-4 mr-1" />
                {a.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-auto p-4 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          {state?.body}
        </div>
      </DialogContent>
    </Dialog>
  );
}
