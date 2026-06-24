// Minimal read-only renderer for the CMS content-block JSON shape used by
// CourseModule.contentBlocks. This intentionally supports only the block types
// the seeded onboarding course uses (header / paragraph / list / quote /
// divider / image). For richer authoring we'd point at the full
// RichContentEditor in read-only mode, but this keeps the OnboardingGate's
// dependency graph small and predictable.

interface BlockBase {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

function isBlock(x: unknown): x is BlockBase {
  return typeof x === 'object' && x !== null && typeof (x as any).type === 'string';
}

export function ContentBlockRenderer({ blocks }: { blocks: unknown }) {
  if (!Array.isArray(blocks)) return null;
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      {blocks.filter(isBlock).map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: BlockBase }) {
  const data = (block.data ?? {}) as Record<string, any>;
  switch (block.type) {
    case 'header': {
      const level = Math.max(1, Math.min(6, Number(data.level) || 2));
      const Tag = (`h${level}`) as keyof JSX.IntrinsicElements;
      return <Tag className="font-semibold tracking-tight text-gray-900 dark:text-gray-100">{String(data.text ?? '')}</Tag>;
    }
    case 'paragraph':
      return <p className="text-gray-700 dark:text-gray-200 leading-relaxed">{String(data.text ?? '')}</p>;
    case 'list': {
      const items = Array.isArray(data.items) ? data.items : [];
      const ordered = data.style === 'ordered';
      const ItemsList = ordered ? 'ol' : 'ul';
      return (
        <ItemsList className={ordered ? 'list-decimal pl-6' : 'list-disc pl-6'}>
          {items.map((it: unknown, i: number) => (
            <li key={i} className="text-gray-700 dark:text-gray-200">{String(it)}</li>
          ))}
        </ItemsList>
      );
    }
    case 'quote':
      return (
        <blockquote className="border-l-4 border-indigo-300 pl-4 italic text-gray-700 dark:text-gray-300">
          {String(data.text ?? '')}
        </blockquote>
      );
    case 'divider':
      return <hr className="my-6 border-gray-200 dark:border-gray-700" />;
    case 'image':
      return data.url ? <img src={String(data.url)} alt={String(data.alt ?? '')} className="rounded-lg" /> : null;
    default:
      // Unknown block type — render nothing rather than surface a stack trace.
      return null;
  }
}
