'use client';

import { useEffect, useState } from 'react';

interface DateFormatProps {
  date: Date | string;
  format?: 'date' | 'datetime';
}

export function DateFormat({ date, format = 'datetime' }: DateFormatProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Hydration mismatch 방지를 위해 다음 틱에 상태 설정
    const timeoutId = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeoutId);
  }, []);

  if (!mounted) {
    return <span>&nbsp;</span>;
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const formatted = format === 'date'
    ? dateObj.toLocaleDateString('ko-KR')
    : dateObj.toLocaleString('ko-KR');

  return <span>{formatted}</span>;
}
