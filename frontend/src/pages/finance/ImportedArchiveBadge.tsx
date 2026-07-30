import FinIcon from './FinIcon';

export const IMPORTED_ARCHIVE_HINT =
  'Импортировано из Notion как архивная запись и не изменяет текущий остаток';

export function isImportedArchive(row: any): boolean {
  return row?.imported === true || String(row?.source || '').toLowerCase() === 'notion';
}

export default function ImportedArchiveBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`fin-import-badge${compact ? ' compact' : ''}`}
      title={IMPORTED_ARCHIVE_HINT}
      aria-label="Notion · архив"
    >
      <FinIcon name="archive" size={compact ? 10 : 12} />
      Notion · архив
    </span>
  );
}
