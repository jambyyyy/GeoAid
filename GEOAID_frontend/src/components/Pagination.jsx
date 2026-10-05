import { useEffect, useState } from "react";
import "./Pagination.css";

export const PAGE_SIZE = 5;

/**
 * Wrap any table or list to show 5 rows per page.
 *
 *   <Paginated items={rows}>
 *     {(pageRows) => (
 *       <table>... {pageRows.map(...)} ...</table>
 *     )}
 *   </Paginated>
 *
 * Each <Paginated> keeps its own page number. Pass `resetKey` (e.g. the
 * selected filter) to jump back to page 1 when it changes. The Previous /
 * Next bar shows whenever the list has at least one row.
 */
export function Paginated({ items, pageSize = PAGE_SIZE, resetKey, children }) {
  const list = items || [];
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const start = (current - 1) * pageSize;
  const pageItems = list.slice(start, start + pageSize);

  return (
    <>
      {children(pageItems, start)}
      {list.length > 0 && (
        <div className="pg-bar">
          <button
            type="button"
            className="pg-btn"
            disabled={current === 1}
            onClick={(e) => {
              e.stopPropagation();
              setPage(current - 1);
            }}
          >
            Previous
          </button>
          <span className="pg-info">
            Page {current} of {totalPages} · {list.length} total
          </span>
          <button
            type="button"
            className="pg-btn"
            disabled={current === totalPages}
            onClick={(e) => {
              e.stopPropagation();
              setPage(current + 1);
            }}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}