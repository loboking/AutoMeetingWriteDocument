# Quick Start: Copy-Paste Code

## 1. Update globals.css

Add this import at the top of `/Users/ws/자동회의기록및기획문서화/meeting-auto-docs/src/app/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "../styles/tree-view.css";  /* ← ADD THIS LINE */
```

## 2. Update PrdViewer.tsx - Import Section

Add these imports to `/Users/ws/자동회의기록및기획문서화/meeting-auto-docs/src/components/PrdViewer.tsx`:

```tsx
// Add after line 21
import { TreeView } from '@/components/ui/tree-view';
import { DocumentProgress } from '@/components/ui/document-progress';
```

## 3. Update PrdViewer.tsx - Component State

No state changes needed! The existing `expandedNodes` state works.

## 4. Update PrdViewer.tsx - Render Section

Replace the document status card section (around line 940-970):

```tsx
// REPLACE lines 940-970 with:
export default function PrdViewer() {
  // ... existing code ...

  return (
    <div className="space-y-6">
      {/* 전체 생성 버튼 영역 */}
      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Progress Indicator - NEW */}
          <DocumentProgress
            current={generatedCount}
            total={totalCount}
          />

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">문서 생성 현황</h3>
              <p className="text-sm text-slate-500 mt-1">
                {generatedCount} / {totalCount}개 문서 생성됨
              </p>
            </div>
            <Button
              onClick={handleGenerateAll}
              disabled={isGenerating || !currentMeeting?.summary}
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  생성 중...
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 mr-2" />
                  전체 문서 생성
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 문서 선택 (트리 구조) */}
      <Card>
        <CardContent className="pt-6">
          <TreeView
            nodes={DOCUMENT_TREE.map(node => ({
              ...node,
              hasDoc: !!documents[node.key],
              canGenerate: canGenerateDoc(node.key, documents).canGenerate,
              children: node.children.map(child => ({
                ...child,
                hasDoc: !!documents[child.key],
                canGenerate: canGenerateDoc(child.key, documents).canGenerate,
                children: child.children.map(grandchild => ({
                  ...grandchild,
                  hasDoc: !!documents[grandchild.key],
                  canGenerate: canGenerateDoc(grandchild.key, documents).canGenerate,
                })),
              })),
            }))}
            activeKey={activeDoc}
            documents={documents}
            onNodeClick={(key) => setActiveDoc(key as DocType)}
          />
        </CardContent>
      </Card>

      {/* 문서 내용 영역 - Keep existing Tabs implementation */}
      <Tabs value={activeDoc} onValueChange={(v) => setActiveDoc(v as DocType)}>
        {/* ... existing tabs content ... */}
      </Tabs>
    </div>
  );
}
```

## 5. Optional: Enhanced Document Cards

Replace the document card styling in the tabs content section (around line 1031-1142):

```tsx
<Card className={`
  group relative overflow-hidden transition-all duration-200
  ${docHasContent
    ? 'border-green-200 dark:border-green-900 bg-gradient-to-br from-green-50/50 to-transparent dark:from-green-950/20 hover:border-green-300 dark:hover:border-green-800 hover:shadow-md'
    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50'
  }
`}>
  {/* Shine effect on hover */}
  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 pointer-events-none" />

  <CardHeader>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <CardTitle className="flex items-center gap-2">
          <span className="text-2xl flex-shrink-0">{doc.icon}</span>
          <span className="truncate">{doc.title}</span>
        </CardTitle>
        <p className="text-sm text-slate-500 mt-1">{doc.description}</p>
      </div>

      {/* Status Badge - Enhanced */}
      <div className="flex-shrink-0">
        {docHasContent ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium border border-green-200 dark:border-green-800">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span>완료</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm font-medium border border-slate-200 dark:border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>미생성</span>
          </div>
        )}
      </div>
    </div>
  </CardHeader>

  <CardContent>
    {/* Rest of existing card content */}
  </CardContent>
</Card>
```

## 6. Test the Changes

```bash
# Run dev server
cd /Users/ws/자동회의기록및기획문서화/meeting-auto-docs
npm run dev

# Open browser
open http://localhost:3000
```

## 7. Verify Improvements

Check these improvements:

- ✅ Status badges are now large (12px) with text labels
- ✅ Tree hierarchy is clear with connection lines
- ✅ Hover effects on all interactive elements
- ✅ Expand/collapse buttons are easy to click (24x24px)
- ✅ Progress bar shows completion status
- ✅ Smooth animations throughout
- ✅ Better color contrast in dark mode

## 8. Troubleshooting

### Issue: Styles not loading
**Solution**: Make sure `@import "../styles/tree-view.css";` is the last import in globals.css

### Issue: TypeScript errors
**Solution**: Restart TypeScript server in VS Code: `Cmd+Shift+P` → "TypeScript: Restart TS Server"

### Issue: Component not found
**Solution**: Verify files exist:
```bash
ls -la src/components/ui/tree-view.tsx
ls -la src/components/ui/document-progress.tsx
ls -la src/styles/tree-view.css
```

### Issue: Tree not expanding/collapsing
**Solution**: Check that `expandedNodes` state is properly managed. The TreeView component handles this internally.

## 9. Customization

### Change Colors

Edit `/Users/ws/자동회의기록및기획문서화/meeting-auto-docs/src/styles/tree-view.css`:

```css
:root {
  /* Modify these values */
  --status-completed-bg: oklch(0.92 0.05 145);  /* Green background */
  --status-completed-fg: oklch(0.45 0.15 145);  /* Green text */
  --status-available-bg: oklch(0.92 0.05 250);  /* Blue background */
  --status-available-fg: oklch(0.55 0.20 250);  /* Blue text */
}
```

### Adjust Spacing

```css
:root {
  /* Modify these values (8px base unit) */
  --tree-spacing-xs: 4px;
  --tree-spacing-sm: 8px;
  --tree-spacing-md: 12px;
  --tree-spacing-lg: 16px;
  --tree-spacing-xl: 24px;
}
```

### Disable Animations

```css
/* Add to globals.css */
* {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}
```

## 10. Rollback (If Needed)

If you need to revert:

```bash
# Remove imports from globals.css
# Remove imports from PrdViewer.tsx
# Restore original code from git
git checkout src/components/PrdViewer.tsx

# Delete new files
rm src/components/ui/tree-view.tsx
rm src/components/ui/document-progress.tsx
rm src/styles/tree-view.css
```

## 11. Performance Check

After implementation, verify performance:

```javascript
// Add to browser console
performance.mark('start');
// Interact with tree
performance.mark('end');
performance.measure('tree-interaction', 'start', 'end');
console.log(performance.getEntriesByName('tree-interaction')[0].duration);
// Should be < 100ms for smooth interactions
```

## 12. Accessibility Audit

Run accessibility audit:

```bash
# Install axe-core
npm install --save-dev @axe-core/react

# Add to PrdViewer.tsx
import Axe from '@axe-core/react';

<Axe> {/* Wrap your component */}

// Check console for accessibility issues
```

## Success Checklist

- [ ] CSS imports correctly
- [ ] Components render without errors
- [ ] Tree navigation works
- [ ] Status badges visible
- [ ] Hover effects smooth
- [ ] Keyboard navigation works
- [ ] Mobile responsive
- [ ] Dark mode looks good
- [ ] No console errors
- [ ] Performance acceptable (< 100ms interactions)

## Need Help?

1. Check `INTEGRATION_GUIDE.md` for detailed implementation
2. Review `BEFORE_AFTER.md` for visual comparisons
3. See `DESIGN_IMPROVEMENTS.md` for design rationale

---

**Estimated Time**: 15-30 minutes
**Difficulty**: Easy
**Rollback**: Simple (git revert)
