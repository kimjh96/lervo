export function createCursorPager(loadPage) {
  let cursors = [null];
  let index = 0;
  let nextCursor = null;
  let loading = false;

  function navigation() {
    return {
      pageNumber: index + 1,
      hasPrevious: index > 0,
      hasNext: nextCursor !== null,
      loading,
    };
  }

  async function load(cursor) {
    if (loading) return null;
    loading = true;
    try {
      const page = await loadPage(cursor);
      if (typeof page !== "object" || page === null || !("nextCursor" in page)) {
        throw new Error("The page response format is invalid.");
      }
      if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
        throw new Error("The next-page cursor format is invalid.");
      }
      return page;
    } finally {
      loading = false;
    }
  }

  return {
    async firstPage() {
      const page = await load(null);
      if (page === null) return null;
      cursors = [null];
      index = 0;
      nextCursor = page.nextCursor;
      return { page, navigation: navigation() };
    },
    async nextPage() {
      if (nextCursor === null) return null;
      const cursor = nextCursor;
      const page = await load(cursor);
      if (page === null) return null;
      cursors = cursors.slice(0, index + 1);
      cursors.push(cursor);
      index += 1;
      nextCursor = page.nextCursor;
      return { page, navigation: navigation() };
    },
    async previousPage() {
      if (index === 0) return null;
      const targetIndex = index - 1;
      const page = await load(cursors[targetIndex]);
      if (page === null) return null;
      index = targetIndex;
      nextCursor = page.nextCursor;
      return { page, navigation: navigation() };
    },
    navigation,
  };
}
