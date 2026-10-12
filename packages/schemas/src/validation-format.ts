export const formats = {
  "date-time": {
    type: "string" as const,
    validate: (value: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
  },
};
