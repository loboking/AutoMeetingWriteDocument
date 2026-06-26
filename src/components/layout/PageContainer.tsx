import { cn } from '@/lib/utils';

type ContainerWidth = 'narrow' | 'default' | 'wide';

interface PageContainerProps {
  width?: ContainerWidth;
  className?: string;
  children: React.ReactNode;
}

const WIDTH_MAP: Record<ContainerWidth, string> = {
  narrow: 'max-w-2xl',
  default: 'max-w-6xl',
  wide: 'max-w-7xl',
};

export function PageContainer({ width = 'default', className, children }: PageContainerProps) {
  return (
    <div className={cn('mx-auto w-full px-4 sm:px-6', WIDTH_MAP[width], className)}>
      {children}
    </div>
  );
}
