export interface TraceCursorPage {
  nextCursor: string | null;
  [key: string]: unknown;
}

export interface TraceCursorNavigation {
  pageNumber: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
}

export interface TraceCursorPageResult<Page extends TraceCursorPage> {
  page: Page;
  navigation: TraceCursorNavigation;
}

export function createCursorPager<Page extends TraceCursorPage>(
  loadPage: (cursor: string | null) => Promise<Page>,
): {
  firstPage(): Promise<TraceCursorPageResult<Page> | null>;
  nextPage(): Promise<TraceCursorPageResult<Page> | null>;
  previousPage(): Promise<TraceCursorPageResult<Page> | null>;
  navigation(): TraceCursorNavigation;
};
