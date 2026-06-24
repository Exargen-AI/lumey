import type { DiffSegment } from '@/api/adminCourses';
import { cn } from '@/lib/cn';

// Renders a line-level redline. Removed lines: red, strikethrough.
// Added lines: green. Unchanged lines: muted gray.
//
// Each segment may contain multiple lines (the backend coalesces consecutive
// runs of the same type) — we split on \n for line-by-line rendering so long
// runs wrap nicely.
export function DiffViewer({
  segments,
  className,
}: {
  segments: DiffSegment[];
  className?: string;
}) {
  if (segments.length === 0) {
    return (
      <p className={cn('text-sm text-gray-500 italic', className)}>
        No differences found between these versions.
      </p>
    );
  }

  // Detect whether there are any actual changes; if not, mention it.
  const hasChanges = segments.some((s) => s.type !== 'unchanged');

  return (
    <div className={cn('rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40', className)}>
      {!hasChanges && (
        <p className="px-4 py-2 text-xs text-gray-500 italic border-b border-gray-200 dark:border-gray-700">
          Texts are identical except for whitespace.
        </p>
      )}
      <pre className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap p-4">
        {segments.map((s, i) => (
          <SegmentLines key={i} segment={s} />
        ))}
      </pre>
    </div>
  );
}

function SegmentLines({ segment }: { segment: DiffSegment }) {
  const lines = segment.text.split('\n');
  const cls =
    segment.type === 'added'
      ? 'bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-200 border-l-2 border-green-400 pl-2'
      : segment.type === 'removed'
        ? 'bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 border-l-2 border-red-400 pl-2 line-through decoration-red-400/60'
        : 'text-gray-600 dark:text-gray-400 pl-2';
  const prefix = segment.type === 'added' ? '+ ' : segment.type === 'removed' ? '− ' : '  ';
  return (
    <span className={cn('block', cls)}>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {prefix}{line || ' '}
        </span>
      ))}
    </span>
  );
}
