'use client';

import { useEffect, useState } from 'react';

interface DateFormatProps {
  date: Date | string;
  format?: 'date' | 'datetime';
}

export function DateFormat({ date, format = 'datetime' }: DateFormatProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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
