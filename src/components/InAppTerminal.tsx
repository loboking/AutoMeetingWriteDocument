'use client';

import { useRef, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface InAppTerminalProps {
  commands?: string[];
  onCommandExecute?: (command: string) => void;
}

export function InAppTerminal({ commands = [], onCommandExecute }: InAppTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    // 터미널 인스턴스 생성
    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#eee',
        cursor: '#5af',
        black: '#000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    });

    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = terminal;

    // 초기 환영 메시지
    const welcomeMessage = [
      '\r\n\x1b[1;36m──────────────────────────────────────────────\x1b[0m',
      '\x1b[1;33m  MeetingAutoDocs 개발 터미널\x1b[0m',
      '\x1b[1;36m──────────────────────────────────────────────\x1b[0m',
      '\r\n\x1b[2m명령어를 입력하거나 오른쪽 패널에서 클릭하여 복사하세요.\x1b[0m',
      '\r\n',
    ];

    welcomeMessage.forEach((line) => terminal.writeln(line));
    terminal.write('\x1b[1;32m$\x1b[0m ');

    // 커맨드 처리
    let currentLine = '';

    const handleUserInput = (data: string) => {
      const char = data;

      if (char === '\r') {
        // Enter 키
        if (currentLine.trim()) {
          terminal.write('\r\n');
          onCommandExecute?.(currentLine.trim());
          terminal.writeln(`\x1b[2m실행: ${currentLine.trim()}\x1b[0m`);
          terminal.write('\x1b[1;32m$\x1b[0m ');
          currentLine = '';
        } else {
          terminal.write('\r\n\x1b[1;32m$\x1b[0m ');
        }
      } else if (char === '\u007f') {
        // Backspace
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          terminal.write('\b \b');
        }
      } else if (char >= ' ') {
        // 일반 문자
        currentLine += char;
        terminal.write(char);
      }
    };

    terminal.onData(handleUserInput);

    // 포커스 이벤트
    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    terminal.element?.addEventListener('focus', handleFocus);
    terminal.element?.addEventListener('blur', handleBlur);

    // 크기 조정
    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      terminal.element?.removeEventListener('focus', handleFocus);
      terminal.element?.removeEventListener('blur', handleBlur);
      terminal.dispose();
    };
  }, [onCommandExecute]);

  // 커맨드 입력 처리 (외부에서 호출)
  useEffect(() => {
    if (!terminalInstanceRef.current || commands.length === 0) return;

    const lastCommand = commands[commands.length - 1];
    if (lastCommand) {
      terminalInstanceRef.current.writeln(`\r\n\x1b[1;33m> ${lastCommand}\x1b[0m`);
      terminalInstanceRef.current.write('\x1b[1;32m$\x1b[0m ');
    }
  }, [commands]);

  // 터미널 포커스 처리
  const handleClick = () => {
    terminalInstanceRef.current?.focus();
  };

  return (
    <div
      className={`relative h-full w-full bg-slate-900 rounded-lg overflow-hidden ${
        isFocused ? 'ring-2 ring-blue-500' : ''
      }`}
      onClick={handleClick}
    >
      <div ref={terminalRef} className="h-full w-full" />
      {!isFocused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
          <span className="text-white/50 text-sm">클릭하여 터미널 활성화</span>
        </div>
      )}
    </div>
  );
}
