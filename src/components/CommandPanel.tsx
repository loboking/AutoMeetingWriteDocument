'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { Terminal, FileText, Copy, Check, FolderTree, ChevronRight, Code, Server, Database, TestTube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMeetingStore } from '@/store/meetingStore';

interface CommandCard {
  id: string;
  title: string;
  description: string;
  command: string;
  category: 'setup' | 'frontend' | 'backend' | 'database' | 'test';
  icon: React.ElementType;
}

// 기획 문서 기반 명령어 생성
function generateCommandsFromDocuments(meeting: { title?: string; prd?: string; featureList?: string; apiSpec?: string; database?: string; testPlan?: string; testCase?: string }): CommandCard[] {
  const commands: CommandCard[] = [];

  // 프로젝트 설정 명령어
  commands.push({
    id: 'init-project',
    title: '프로젝트 초기화',
    description: 'Next.js 프로젝트 시작',
    command: `npx create-next-app@latest ${(meeting.title || 'my-project').replace(/\s+/g, '-').toLowerCase()} --typescript --tailwind --app --no-src-dir --import-alias "@/*"`,
    category: 'setup',
    icon: FolderTree,
  });

  // PRD 기반 프론트엔드 명령어
  if (meeting.prd || meeting.featureList) {
    commands.push({
      id: 'create-component',
      title: '컴포넌트 생성',
      description: '새로운 React 컴포넌트 추가',
      command: 'mkdir -p src/components/new-feature && cat > src/components/new-feature/NewFeature.tsx << \'EOF\'\nexport function NewFeature() {\n  return <div>New Feature</div>;\n}\nEOF',
      category: 'frontend',
      icon: Code,
    });
  }

  // API 명세 기반 백엔드 명령어
  if (meeting.apiSpec) {
    commands.push({
      id: 'create-api-route',
      title: 'API 라우트 생성',
      description: 'Next.js App Router API 엔드포인트',
      command: 'mkdir -p src/app/api/v1/resource && cat > src/app/api/v1/resource/route.ts << \'EOF\'\nimport { NextRequest, NextResponse } from \'next/server\';\n\nexport async function GET(request: NextRequest) {\n  return NextResponse.json({ success: true, data: [] });\n}\n\nexport async function POST(request: NextRequest) {\n  const body = await request.json();\n  return NextResponse.json({ success: true, data: body });\n}\nEOF',
      category: 'backend',
      icon: Server,
    });
  }

  // DB 설계 기반 데이터베이스 명령어
  if (meeting.database) {
    commands.push({
      id: 'db-migration',
      title: 'DB 마이그레이션',
      description: 'Prisma 마이그레이션 생성',
      command: 'npx prisma migrate dev --name init_schema',
      category: 'database',
      icon: Database,
    });
  }

  // 테스트 계획 기반 테스트 명령어
  if (meeting.testPlan || meeting.testCase) {
    commands.push({
      id: 'run-tests',
      title: '테스트 실행',
      description: 'Jest 테스트 스위트 실행',
      command: 'npm test -- --coverage --watchAll=false',
      category: 'test',
      icon: TestTube,
    });
  }

  // 기타 유용한 명령어
  commands.push(
    {
      id: 'install-deps',
      title: '의존성 설치',
      description: '일반적으로 사용하는 패키지 설치',
      command: 'npm install zustand axios react-hook-form @tanstack/react-query zod',
      category: 'setup',
      icon: Terminal,
    },
    {
      id: 'dev-server',
      title: '개발 서버 시작',
      description: '로컬 개발 서버 실행',
      command: 'npm run dev',
      category: 'setup',
      icon: Server,
    },
    {
      id: 'build-prod',
      title: '프로덕션 빌드',
      description: '배포용 빌드 생성',
      command: 'npm run build',
      category: 'setup',
      icon: Terminal,
    }
  );

  return commands;
}

const CATEGORY_STYLES = {
  setup: { bg: 'bg-slate-500/10', text: 'text-slate-500', border: 'border-slate-500/20', label: '설정' },
  frontend: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20', label: '프론트엔드' },
  backend: { bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20', label: '백엔드' },
  database: { bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/20', label: '데이터베이스' },
  test: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/20', label: '테스트' },
};

// 개별 명령어 카드 (memo 적용)
interface CommandCardItemProps {
  cmd: CommandCard;
  isCopied: boolean;
  onCopy: (command: string, id: string) => void;
}

const CommandCardItem = memo(({ cmd, isCopied, onCopy }: CommandCardItemProps) => {
  const Icon = cmd.icon;
  const style = CATEGORY_STYLES[cmd.category];

  return (
    <Card
      className={`group hover:shadow-md transition-all cursor-pointer ${style.bg} ${style.border} border`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${style.bg} ${style.text}`}>
            <Icon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm text-slate-900 dark:text-slate-50">
                {cmd.title}
              </h4>
              <Badge variant="outline" className={`text-xs ${style.text} ${style.border}`}>
                {style.label}
              </Badge>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
              {cmd.description}
            </p>
            <code className="block text-xs bg-slate-900 text-slate-100 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
              {cmd.command}
            </code>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCopy(cmd.command, cmd.id)}
            className={`shrink-0 ${isCopied ? 'text-green-500' : ''}`}
            aria-label="명령어 복사"
          >
            {isCopied ? (
              <>
                <Check className="w-4 h-4 mr-1" aria-hidden="true" />
                복사됨
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" aria-hidden="true" />
                복사
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});

CommandCardItem.displayName = 'CommandCardItem';

export function CommandPanel() {
  const currentMeeting = useMeetingStore(s => s.currentMeeting);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // currentMeeting이 변경될 때 명령어 목록 계산
  const commands = useMemo(() => {
    return currentMeeting ? generateCommandsFromDocuments(currentMeeting) : [];
  }, [currentMeeting]);

  const handleCopy = async (command: string, id: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const filteredCommands = selectedCategory
    ? commands.filter((cmd) => cmd.category === selectedCategory)
    : commands;

  const categories = Array.from(new Set(commands.map((cmd) => cmd.category)));

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          빠른 명령어
        </h3>
        {currentMeeting && (
          <Badge variant="secondary" className="text-xs">
            {commands.length}개 명령어
          </Badge>
        )}
      </div>

      {/* 카테고리 필터 */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={selectedCategory === null ? 'default' : 'outline'}
          onClick={() => setSelectedCategory(null)}
          className="text-xs"
        >
          전체
        </Button>
        {categories.map((cat) => {
          const style = CATEGORY_STYLES[cat as keyof typeof CATEGORY_STYLES];
          return (
            <Button
              key={cat}
              size="sm"
              variant={selectedCategory === cat ? 'default' : 'outline'}
              onClick={() => setSelectedCategory(cat)}
              className="text-xs"
            >
              {style.label}
            </Button>
          );
        })}
      </div>

      {!currentMeeting ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-slate-500">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>기획 문서를 생성하면 관련 명령어가 표시됩니다.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredCommands.map((cmd) => (
            <CommandCardItem
              key={cmd.id}
              cmd={cmd}
              isCopied={copiedId === cmd.id}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}

      {/* 힌트 */}
      {currentMeeting && (
        <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
          <p>명령어 카드를 클릭하면 터미널에 입력됩니다</p>
          <p className="mt-1">
            <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">
              Ctrl
            </kbd>
            {' + '}
            <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">
              `
            </kbd>
            {' 로 터미널 토글'}
          </p>
        </div>
      )}
    </div>
  );
}
