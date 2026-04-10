'use client';

import { ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TreeNode {
  key: string;
  title: string;
  icon: string;
  description?: string;
  children?: TreeNode[];
  hasDoc?: boolean;
  canGenerate?: boolean;
}

interface TreeViewProps {
  nodes: TreeNode[];
  activeKey: string;
  documents: Record<string, string>;
  onNodeClick: (key: string) => void;
  className?: string;
}

export function TreeView({
  nodes,
  activeKey,
  documents,
  onNodeClick,
  className,
}: TreeViewProps) {
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set());

  const toggleNode = (key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderNode = (node: TreeNode, level: number = 0): React.ReactNode => {
    const hasDoc = !!documents[node.key];
    const canGenerate = node.canGenerate ?? false;
    const isActive = node.key === activeKey;
    const isDisabled = !hasDoc && !canGenerate;
    const isExpanded = expandedNodes.has(node.key);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.key} className="tree-node" data-level={level}>
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          aria-disabled={isDisabled}
          aria-label={`${node.title} ${hasDoc ? '완료' : canGenerate ? '생성 가능' : '대기 중'}`}
          tabIndex={isDisabled ? -1 : 0}
          data-state={isActive ? 'active' : 'inactive'}
          className={cn(
            'tree-node-trigger',
            isActive && 'data-[state=active]:bg-blue-50 dark:data-[state=active]:bg-blue-950/20',
            isDisabled && 'opacity-50 cursor-not-allowed'
          )}
          style={{ paddingLeft: `${level * 20 + 12}px` }}
          onClick={() => !isDisabled && onNodeClick(node.key)}
          disabled={isDisabled}
        >
          {/* Expand/Collapse Button */}
          {hasChildren && (
            <button
              type="button"
              aria-label={isExpanded ? '접기' : '펼치기'}
              aria-expanded={isExpanded}
              className="tree-expand-btn"
              data-expanded={isExpanded}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleNode(node.key);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Document Icon */}
          <span className="tree-node-icon">{node.icon}</span>

          {/* Document Title */}
          <span className="tree-node-title">{node.title}</span>

          {/* Status Badge */}
          <div className="ml-auto">
            {hasDoc ? (
              <div className="tree-status-badge completed">
                <span className="tree-status-dot" />
                <span className="hidden sm:inline">완료</span>
              </div>
            ) : canGenerate ? (
              <div className="tree-status-badge available">
                <span className="tree-status-dot" />
                <span className="hidden sm:inline">가능</span>
              </div>
            ) : (
              <div className="tree-status-badge pending">
                <span className="tree-status-dot" />
                <span className="hidden sm:inline">대기</span>
              </div>
            )}
          </div>
        </button>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="tree-children" data-expanded="true">
            {node.children!.map((child) => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('tree-nav', className)}>
      {nodes.map((node) => renderNode(node))}
    </div>
  );
}

import React from 'react';
